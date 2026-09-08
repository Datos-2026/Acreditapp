import { EventStatus } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  ACREDITADOS_MYSQL_MARKER,
  dropEventAcreditadosTable,
  dumpEventPeopleToMysql,
  ensureEventAcreditadosTable,
  formatMysqlError,
  isAcreditadosMysqlConfigured,
  isValidAcreditadosTableName,
  listAcreditadosTableNames,
  mysqlTableNameForEvent,
  syncEventToAcreditadosMysql
} from "./acreditados-mysql";

export class ArchiveEventToSheetsError extends Error {
  code: "NOT_FOUND" | "ALREADY_ARCHIVED" | "SHEETS_UNAVAILABLE";

  constructor(message: string, code: ArchiveEventToSheetsError["code"]) {
    super(message);
    this.name = "ArchiveEventToSheetsError";
    this.code = code;
  }
}

export function isArchiveEventToSheetsError(err: unknown): err is ArchiveEventToSheetsError {
  return (
    err instanceof ArchiveEventToSheetsError ||
    (typeof err === "object" &&
      err !== null &&
      (err as Error).name === "ArchiveEventToSheetsError" &&
      ["NOT_FOUND", "ALREADY_ARCHIVED", "SHEETS_UNAVAILABLE"].includes(String((err as { code?: string }).code)))
  );
}

export const ARCHIVE_CLOSED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function isEventDueForSheetsArchive(
  event: {
    status: EventStatus | string;
    closedAt: Date | null;
    archivedToSheetsAt: Date | null;
  },
  now: Date = new Date()
): boolean {
  if (event.archivedToSheetsAt) return false;
  if (event.status !== EventStatus.closed && event.status !== "closed") return false;
  if (!event.closedAt) return false;
  return now.getTime() - event.closedAt.getTime() >= ARCHIVE_CLOSED_AFTER_MS;
}

/** Volcar / descargar MySQL: cerrado hace 30 días, o ya archivado. */
export function isEligibleForAcreditadosMysqlDump(
  event: {
    status: EventStatus | string;
    closedAt: Date | string | null;
    archivedToSheetsAt?: Date | string | null;
  },
  now: Date = new Date()
): boolean {
  const status = String(event.status);
  if (status === EventStatus.archived || status === "archived" || event.archivedToSheetsAt) {
    return true;
  }
  if (status !== EventStatus.closed && status !== "closed") return false;
  if (!event.closedAt) return false;
  const closedAt = event.closedAt instanceof Date ? event.closedAt : new Date(event.closedAt);
  if (Number.isNaN(closedAt.getTime())) return false;
  return now.getTime() - closedAt.getTime() >= ARCHIVE_CLOSED_AFTER_MS;
}

async function dumpEventBase(event: {
  id: string;
  name: string;
  slug: string;
  googleSheetName: string | null;
  googleSpreadsheetId: string | null;
}): Promise<{ spreadsheetId: string; sheetName: string }> {
  if (!isAcreditadosMysqlConfigured()) {
    throw new ArchiveEventToSheetsError(
      "MySQL ACREDITADOS no está configurado: no se puede volcar ni borrar la nómina.",
      "SHEETS_UNAVAILABLE"
    );
  }
  let ref;
  try {
    ref = await ensureEventAcreditadosTable(event);
  } catch (err) {
    throw new ArchiveEventToSheetsError(formatMysqlError(err), "SHEETS_UNAVAILABLE");
  }
  const people = await prisma.eventPerson.findMany({
    where: { eventId: event.id },
    include: { person: true, accreditedByUser: { select: { id: true, name: true } } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
  });
  try {
    await dumpEventPeopleToMysql(ref.tableName, people);
  } catch (err) {
    throw new ArchiveEventToSheetsError(formatMysqlError(err), "SHEETS_UNAVAILABLE");
  }
  return { spreadsheetId: ref.spreadsheetId, sheetName: ref.tableName };
}

async function purgeEventOperationalData(eventId: string, now: Date, sheetName: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.eventPerson.updateMany({
        where: { eventId },
        data: { referenteId: null }
      });
      await tx.eventReferente.updateMany({
        where: { eventId },
        data: { eventPersonId: null }
      });
      await tx.eventReferente.deleteMany({ where: { eventId } });
      await tx.eventPerson.deleteMany({ where: { eventId } });
      await tx.importBatch.deleteMany({ where: { eventId } });
      await tx.eventReportAiCache.deleteMany({ where: { eventId } });
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.archived,
          archivedToSheetsAt: now,
          googleSheetName: sheetName,
          googleSpreadsheetId: ACREDITADOS_MYSQL_MARKER
        }
      });
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
}

export async function archiveEventToSheets(
  eventId: string,
  now: Date = new Date()
): Promise<{ spreadsheetId: string; googleSheetUrl: string | null; tableName: string }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      slug: true,
      googleSheetName: true,
      googleSpreadsheetId: true,
      archivedToSheetsAt: true
    }
  });
  if (!event) {
    throw new ArchiveEventToSheetsError("Evento no encontrado", "NOT_FOUND");
  }
  if (event.archivedToSheetsAt) {
    throw new ArchiveEventToSheetsError(
      "Este evento ya fue volcado a MySQL ACREDITADOS y la nómina operativa se borró.",
      "ALREADY_ARCHIVED"
    );
  }
  const ref = await dumpEventBase(event);
  try {
    await prisma.event.update({
      where: { id: event.id },
      data: { googleSpreadsheetId: ref.spreadsheetId, googleSheetName: ref.sheetName }
    });
    await purgeEventOperationalData(event.id, now, ref.sheetName);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ArchiveEventToSheetsError(
      `La nómina se volcó a MySQL ACREDITADOS, pero no se pudo borrar de la app: ${detail.slice(0, 400)}`,
      "SHEETS_UNAVAILABLE"
    );
  }
  logger.info({ eventId: event.id, tableName: ref.sheetName }, "Evento archivado a MySQL ACREDITADOS");
  return {
    spreadsheetId: ref.spreadsheetId,
    googleSheetUrl: null,
    tableName: ref.sheetName
  };
}

export async function archiveClosedEventsDue(now: Date = new Date()): Promise<{ archived: number; failed: number }> {
  const cutoff = new Date(now.getTime() - ARCHIVE_CLOSED_AFTER_MS);
  const events = await prisma.event.findMany({
    where: {
      status: EventStatus.closed,
      archivedToSheetsAt: null,
      closedAt: { lte: cutoff }
    },
    select: { id: true }
  });

  let archived = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await archiveEventToSheets(event.id, now);
      archived += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, eventId: event.id }, "No se pudo archivar el evento a MySQL ACREDITADOS");
    }
  }
  return { archived, failed };
}

export async function reconcileAcreditadosMysql(): Promise<{
  synced: number;
  dropped: number;
  failed: number;
}> {
  if (!isAcreditadosMysqlConfigured()) {
    return { synced: 0, dropped: 0, failed: 0 };
  }
  const events = await prisma.event.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      closedAt: true,
      archivedToSheetsAt: true,
      googleSheetName: true,
      googleSpreadsheetId: true
    }
  });
  let synced = 0;
  let dropped = 0;
  let failed = 0;
  for (const event of events) {
    try {
      if (isEligibleForAcreditadosMysqlDump(event)) {
        await syncEventToAcreditadosMysql(event);
        synced += 1;
        continue;
      }
      const namesToDrop = new Set<string>();
      if (isValidAcreditadosTableName(event.googleSheetName)) {
        namesToDrop.add(event.googleSheetName!.trim());
      }
      const computed = mysqlTableNameForEvent(event.slug || event.name, event.id);
      if (isValidAcreditadosTableName(computed)) {
        namesToDrop.add(computed);
      }
      for (const tableName of namesToDrop) {
        await dropEventAcreditadosTable(tableName);
      }
      if (namesToDrop.size > 0 || event.googleSheetName || event.googleSpreadsheetId === ACREDITADOS_MYSQL_MARKER) {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            googleSheetName: null,
            googleSpreadsheetId:
              event.googleSpreadsheetId === ACREDITADOS_MYSQL_MARKER ? null : event.googleSpreadsheetId
          }
        });
        dropped += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error({ err, eventId: event.id, name: event.name }, "No se pudo reconciliar MySQL ACREDITADOS");
    }
  }
  const keep = new Set<string>();
  for (const event of events) {
    if (!isEligibleForAcreditadosMysqlDump(event)) continue;
    if (isValidAcreditadosTableName(event.googleSheetName)) {
      keep.add(event.googleSheetName!.trim());
    }
    const computed = mysqlTableNameForEvent(event.slug || event.name, event.id);
    if (isValidAcreditadosTableName(computed)) keep.add(computed);
  }
  try {
    for (const tableName of await listAcreditadosTableNames()) {
      if (keep.has(tableName)) continue;
      await dropEventAcreditadosTable(tableName);
      dropped += 1;
    }
  } catch (err) {
    failed += 1;
    logger.error({ err }, "No se pudieron limpiar tablas huérfanas de MySQL ACREDITADOS");
  }
  logger.info({ synced, dropped, failed, total: events.length }, "Reconciliación MySQL ACREDITADOS terminada");
  return { synced, dropped, failed };
}
