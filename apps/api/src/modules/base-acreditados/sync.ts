import type { RowDataPacket } from "mysql2/promise";
import { EventPersonStatus, EventStatus } from "../../prisma-exports";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import {
  attendanceFlagsForEventPerson,
  shouldIncludeEventPersonInBaseSync
} from "./policy";
import {
  baseExecute,
  dotacionDatabaseName,
  isBaseAcreditadosConfigured,
  openMysqlServerConnection
} from "./mysql";
import {
  bulkUpsertAttendances,
  isInDotacion,
  loadDotacionIndex,
  type AttendanceCandidate,
  type DotacionIndex,
  type PersonCandidate
} from "./service";

function extraValue(extra: unknown, ...keys: string[]): unknown {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const record = extra as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

type EventPersonRow = {
  id: string;
  source: string;
  status: string;
  accreditedAt: Date | null;
  person: {
    cuilNormalized: string;
    dni: string | null;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    position: string | null;
    address: string | null;
  };
  extraData: unknown;
};

function appPersonCandidate(row: EventPersonRow, source: string): PersonCandidate {
  return {
    cuil: row.person.cuilNormalized,
    dni: row.person.dni,
    firstName: row.person.firstName,
    lastName: row.person.lastName,
    phone: row.person.phone,
    emailForm: row.person.email,
    personalAddress: row.person.address ?? extraValue(row.extraData, "direccion", "Dirección"),
    areaForm: row.person.company ?? extraValue(row.extraData, "empresa", "ministerio", "escuela"),
    roleForm: row.person.position ?? extraValue(row.extraData, "cargo", "rol", "oferta"),
    fallbackSeed: `${source}:${row.id}`,
    source
  };
}

function buildAppAttendanceCandidates(
  event: {
    id: string;
    name: string;
    kind: string;
    startAt: Date;
    googleSheetName: string | null;
    eventPeople: EventPersonRow[];
  },
  dotacion: DotacionIndex
): {
  candidates: AttendanceCandidate[];
  importedSent: number;
  manualSent: number;
  manualSkippedNoDotacion: number;
} {
  const source = `app:event:${event.id}`;
  let importedSent = 0;
  let manualSent = 0;
  let manualSkippedNoDotacion = 0;
  const candidates: AttendanceCandidate[] = [];

  for (const row of event.eventPeople) {
    const person = appPersonCandidate(row, source);
    const inDotacion = isInDotacion(person, dotacion);
    if (!shouldIncludeEventPersonInBaseSync(row, inDotacion)) {
      if (row.source === "manual" && row.status === EventPersonStatus.accredited && !inDotacion) {
        manualSkippedNoDotacion += 1;
      }
      continue;
    }
    const flags = attendanceFlagsForEventPerson(row);
    if (row.source === "imported") importedSent += 1;
    if (row.source === "manual") manualSent += 1;
    candidates.push({
      person,
      eventName: event.name,
      eventType: event.kind,
      eventDate: event.startAt,
      appEventId: event.id,
      mysqlTableName: event.googleSheetName,
      registered: flags.registered,
      attended: flags.attended,
      outOfBase: flags.outOfBase,
      status: flags.status,
      accreditedAt: row.accreditedAt,
      source
    });
  }

  return { candidates, importedSent, manualSent, manualSkippedNoDotacion };
}

const eventPeopleSelect = {
  id: true,
  source: true,
  status: true,
  accreditedAt: true,
  extraData: true,
  person: true
} as const;

export async function syncClosedEventToBase(
  eventId: string,
  dotacionIndex?: DotacionIndex
): Promise<{ eventId: string; rows: number }> {
  if (!isBaseAcreditadosConfigured()) throw new Error("BASE_ACREDITADOS no está configurada");
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      startAt: true,
      googleSheetName: true,
      eventPeople: { select: eventPeopleSelect }
    }
  });
  if (event.status !== EventStatus.closed && event.status !== EventStatus.archived) {
    return { eventId, rows: 0 };
  }
  const dotacion = dotacionIndex ?? (await loadDotacionIndex());
  try {
    const { candidates, importedSent, manualSent, manualSkippedNoDotacion } = buildAppAttendanceCandidates(
      event,
      dotacion
    );
    await bulkUpsertAttendances(candidates, dotacion);
    await baseExecute(
      `INSERT INTO event_sync (event_id, event_status, row_count, last_error, synced_at)
       VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE event_status = VALUES(event_status), row_count = VALUES(row_count),
       last_error = NULL, synced_at = CURRENT_TIMESTAMP`,
      [event.id, event.status, candidates.length]
    );
    logger.info(
      {
        eventId: event.id,
        name: event.name,
        rows: candidates.length,
        importedSent,
        manualSent,
        manualSkippedNoDotacion
      },
      "Evento cerrado sincronizado a BASE_ACREDITADOS (inscritos + fuera de base en dotación)"
    );
    return { eventId, rows: candidates.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await baseExecute(
      `INSERT INTO event_sync (event_id, event_status, row_count, last_error)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE event_status = VALUES(event_status), last_error = VALUES(last_error)`,
      [event.id, event.status, message.slice(0, 2000)]
    ).catch(() => undefined);
    throw err;
  }
}

export async function reconcileClosedEventsToBase(): Promise<{ synced: number; rows: number; failed: number }> {
  if (!isBaseAcreditadosConfigured()) return { synced: 0, rows: 0, failed: 0 };
  const dotacion = await loadDotacionIndex();
  const events = await prisma.event.findMany({
    where: { status: { in: [EventStatus.closed, EventStatus.archived] } },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      startAt: true,
      googleSheetName: true,
      eventPeople: { select: eventPeopleSelect }
    }
  });
  let importedSent = 0;
  let manualSent = 0;
  let manualSkippedNoDotacion = 0;
  const candidates = events.flatMap((event) => {
    const built = buildAppAttendanceCandidates(event, dotacion);
    importedSent += built.importedSent;
    manualSent += built.manualSent;
    manualSkippedNoDotacion += built.manualSkippedNoDotacion;
    return built.candidates;
  });
  try {
    await bulkUpsertAttendances(candidates, dotacion);
    for (const event of events) {
      const rowCount = candidates.filter((candidate) => candidate.appEventId === event.id).length;
      await baseExecute(
        `INSERT INTO event_sync (event_id, event_status, row_count, last_error, synced_at)
         VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE event_status = VALUES(event_status), row_count = VALUES(row_count),
         last_error = NULL, synced_at = CURRENT_TIMESTAMP`,
        [event.id, event.status, rowCount]
      );
    }
    logger.info(
      {
        synced: events.length,
        rows: candidates.length,
        importedSent,
        manualSent,
        manualSkippedNoDotacion
      },
      "Reconciliación de inscritos a BASE_ACREDITADOS terminada"
    );
    return { synced: events.length, rows: candidates.length, failed: 0 };
  } catch (err) {
    logger.error({ err }, "Falló reconciliación de eventos cerrados con BASE_ACREDITADOS");
    return { synced: 0, rows: 0, failed: events.length };
  }
}

function mysqlPerson(row: Record<string, unknown>, source: string, fallback: string): PersonCandidate {
  return {
    cuil: row.cuil,
    dni: row.dni,
    firstName: row.nombre,
    lastName: row.apellido,
    phone: row.telefono,
    emailForm: row.email,
    personalAddress: row.direccion,
    areaForm: row.empresa,
    roleForm: row.cargo,
    fallbackSeed: `${source}:${row.event_person_id ?? fallback}`,
    source
  };
}

export async function importExistingAcreditadosTables(
  dotacionIndex?: DotacionIndex
): Promise<{ tables: number; rows: number }> {
  const database = env.ACREDITADOS_MYSQL_DATABASE.trim();
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("Nombre de base ACREDITADOS inválido");
  const dotacion = dotacionIndex ?? (await loadDotacionIndex());
  const events = await prisma.event.findMany({
    where: { status: { in: [EventStatus.closed, EventStatus.archived] } },
    select: { id: true, name: true, kind: true, startAt: true, googleSheetName: true }
  });
  const byTable = new Map(events.filter((event) => event.googleSheetName).map((event) => [event.googleSheetName!, event]));
  const connection = await openMysqlServerConnection();
  let importedTables = 0;
  const candidates: AttendanceCandidate[] = [];
  try {
    const [tableRows] = await connection.query(`SHOW TABLES FROM \`${database}\``);
    for (const tableRow of tableRows as Array<Record<string, unknown>>) {
      const table = String(Object.values(tableRow)[0]);
      if (!/^e_[a-z0-9_]{1,61}$/.test(table)) continue;
      const event = byTable.get(table);
      const [rows] = await connection.query(`SELECT * FROM \`${database}\`.\`${table}\``);
      for (const [index, raw] of (rows as RowDataPacket[]).entries()) {
        const row = raw as Record<string, unknown>;
        const estado = String(row.estado ?? "").trim().toLowerCase();
        if (estado && estado !== "acreditado" && estado !== "accredited") continue;
        const source = `mysql:${database}.${table}`;
        candidates.push({
          person: mysqlPerson(row, source, String(index)),
          eventName: event?.name ?? table,
          eventType: event?.kind ?? "desconocido",
          eventDate: event?.startAt ?? row.acreditado_el,
          appEventId: event?.id ?? null,
          mysqlTableName: table,
          attended: true,
          outOfBase: String(row.origen ?? "").toLowerCase().includes("fuera"),
          status: row.estado,
          accreditedAt: typeof row.acreditado_el === "string" ? row.acreditado_el : null,
          source
        });
      }
      importedTables += 1;
    }
  } finally {
    await connection.end();
  }
  const importedRows = await bulkUpsertAttendances(candidates, dotacion);
  logger.info(
    { tables: importedTables, rows: importedRows, dotacion: `${dotacionDatabaseName()}.${dotacion.table}` },
    "Tablas ACREDITADOS incorporadas a BASE_ACREDITADOS"
  );
  return { tables: importedTables, rows: importedRows };
}
