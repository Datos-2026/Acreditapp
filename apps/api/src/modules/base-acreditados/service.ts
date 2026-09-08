import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2/promise";
import { logger } from "../../lib/logger";
import {
  isValidCuil,
  normalizeDni,
  normalizeEmail,
  normalizeEventFingerprint,
  normalizePhone,
  normalizeText,
  resolveIdentity
} from "./identity";
import {
  baseExecute,
  baseQuery,
  completeCarga,
  createCarga,
  dotacionDatabaseName,
  dotacionTableName,
  insertRawRows,
  openMysqlServerConnection,
  prepareRawTable
} from "./mysql";

export type PersonCandidate = {
  cuil?: unknown;
  dni?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  emailForm?: unknown;
  emailPersonal?: unknown;
  emailMia?: unknown;
  emailLaboral?: unknown;
  birthDate?: unknown;
  sex?: unknown;
  workAddress?: unknown;
  personalAddress?: unknown;
  areaForm?: unknown;
  roleForm?: unknown;
  areaDotacion?: unknown;
  roleDotacion?: unknown;
  descRep?: unknown;
  pathNombres?: unknown;
  estadoRegistro?: unknown;
  observacionesCalidad?: unknown;
  fallbackSeed: unknown;
  source: string;
};

export type AttendanceCandidate = {
  person: PersonCandidate;
  eventName: unknown;
  eventType?: unknown;
  eventDate?: unknown;
  appEventId?: string | null;
  mysqlTableName?: string | null;
  registered?: unknown;
  attended?: unknown;
  outOfBase?: unknown;
  status?: unknown;
  accreditedAt?: Date | string | null;
  source: string;
};

export type DotacionRecord = {
  cuil: string | null;
  dni: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  sex: string | null;
  workAddress: string | null;
  personalAddress: string | null;
  area: string | null;
  role: string | null;
  descRep: string | null;
  pathNombres: string | null;
  emailLaboral: string | null;
  emailPersonal: string | null;
  emailMia: string | null;
};

export type DotacionIndex = {
  byCuil: Map<string, DotacionRecord>;
  byDni: Map<string, DotacionRecord>;
  database: string;
  table: string;
  rows: number;
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rowReader(row: Record<string, unknown>) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  return (...keys: string[]): unknown => {
    for (const key of keys) {
      const value = normalized.get(normalizeHeader(key));
      if (value != null && value !== "") return value;
    }
    return null;
  };
}

function booleanValue(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "si", "sí", "s", "true", "x", "acreditado", "asistio", "asistió"].includes(text)) return true;
  if (["0", "no", "n", "false", "pendiente", "no asistio", "no asistió"].includes(text)) return false;
  const numeric = Number(text.replace(",", "."));
  return Number.isNaN(numeric) ? null : numeric > 0;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
  }
  const text = normalizeText(value);
  if (!text) return null;
  const iso = new Date(text);
  if (!Number.isNaN(iso.getTime())) return iso;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const parsed = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonSources(existing: unknown, source: string): string {
  let sources: string[] = [];
  if (Array.isArray(existing)) sources = existing.map(String);
  else if (typeof existing === "string") {
    try {
      const parsed = JSON.parse(existing);
      if (Array.isArray(parsed)) sources = parsed.map(String);
    } catch {
      sources = [];
    }
  }
  return JSON.stringify([...new Set([...sources, source])]);
}

function aliasesFor(candidate: PersonCandidate): string[] {
  const aliases: string[] = [];
  const cuil = String(candidate.cuil ?? "").replace(/\D/g, "");
  const dni = normalizeDni(candidate.dni);
  const emails = [candidate.emailLaboral, candidate.emailForm, candidate.emailPersonal, candidate.emailMia]
    .map(normalizeEmail)
    .filter((value): value is string => Boolean(value));
  const phone = normalizePhone(candidate.phone);
  if (isValidCuil(cuil)) aliases.push(`cuil:${cuil}`);
  if (dni) aliases.push(`dni:${dni}`);
  for (const email of emails) aliases.push(`email:${email}`);
  if (phone) aliases.push(`telefono:${phone}`);
  return [...new Set(aliases)];
}

function candidateEmail(candidate: PersonCandidate): string | null {
  return (
    normalizeEmail(candidate.emailLaboral) ??
    normalizeEmail(candidate.emailForm) ??
    normalizeEmail(candidate.emailPersonal) ??
    normalizeEmail(candidate.emailMia)
  );
}

function parseDotacionName(value: unknown): { firstName: string | null; lastName: string | null } {
  const fullName = normalizeText(value);
  if (!fullName) return { firstName: null, lastName: null };
  const comma = fullName.indexOf(",");
  if (comma < 0) return { firstName: null, lastName: fullName };
  return {
    lastName: normalizeText(fullName.slice(0, comma)),
    firstName: normalizeText(fullName.slice(comma + 1))
  };
}

async function loadDotacionIndexOnce(): Promise<DotacionIndex> {
  const database = dotacionDatabaseName();
  const table = dotacionTableName();
  const connection = await openMysqlServerConnection();
  try {
    const [rows] = await connection.query(
      `SELECT CUIL_SIN_GUIONES, CUIL, NUM_DOC, AYN, FEC_NACIM, SEXO,
       DOMICILIO_LABORAL, DOMICILIO_PERSONAL, MINISTERIO, LIT_PUESTO, DESC_REP,
       PATH_NOMBRES, MAIL_LABORAL, MAIL_PERSONAL, MAIL_MIA
       FROM \`${database}\`.\`${table}\``
    );
    const records = rows as Array<Record<string, unknown>>;
    const byCuil = new Map<string, DotacionRecord>();
    const byDni = new Map<string, DotacionRecord>();
    for (const row of records) {
      const get = rowReader(row);
      const rawCuil = String(get("CUIL_SIN_GUIONES", "CUIL", "CUIT") ?? "").replace(/\D/g, "");
      const cuil = isValidCuil(rawCuil) ? rawCuil : null;
      const dni = normalizeDni(get("NUM_DOC", "DNI", "DOCUMENTO")) ?? (cuil ? normalizeDni(cuil.slice(2, 10)) : null);
      const name = parseDotacionName(get("AYN"));
      const record: DotacionRecord = {
        cuil,
        dni,
        firstName: name.firstName,
        lastName: name.lastName,
        birthDate: normalizeText(get("FEC_NACIM")),
        sex: normalizeText(get("SEXO")),
        workAddress: normalizeText(get("DOMICILIO_LABORAL")),
        personalAddress: normalizeText(get("DOMICILIO_PERSONAL")),
        area: normalizeText(get("MINISTERIO", "AREA_DOTACION", "AREA")),
        role: normalizeText(get("LIT_PUESTO", "ROL_DOTACION", "PUESTO", "CARGO")),
        descRep: normalizeText(get("DESC_REP")),
        pathNombres: normalizeText(get("PATH_NOMBRES")),
        emailLaboral: normalizeEmail(get("MAIL_LABORAL", "EMAIL_LABORAL")),
        emailPersonal: normalizeEmail(get("MAIL_PERSONAL", "EMAIL_PERSONAL")),
        emailMia: normalizeEmail(get("MAIL_MIA", "EMAIL_MIA"))
      };
      if (cuil) byCuil.set(cuil, record);
      if (dni && !byDni.has(dni)) byDni.set(dni, record);
    }
    return { byCuil, byDni, database, table, rows: records.length };
  } finally {
    await connection.end();
  }
}

export async function loadDotacionIndex(): Promise<DotacionIndex> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await loadDotacionIndexOnce();
    } catch (error) {
      lastError = error;
      const code = String((error as { code?: string })?.code ?? "");
      if (!["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "PROTOCOL_CONNECTION_LOST"].includes(code)) {
        throw error;
      }
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

function findDotacion(identity: ReturnType<typeof resolveIdentity>, index: DotacionIndex | null): DotacionRecord | null {
  if (!index) return null;
  return (identity.cuil ? index.byCuil.get(identity.cuil) : null) ?? (identity.dni ? index.byDni.get(identity.dni) : null) ?? null;
}

export function isInDotacion(candidate: PersonCandidate, index: DotacionIndex | null): boolean {
  if (!index) return false;
  const identity = resolveIdentity({
    cuil: candidate.cuil,
    dni: candidate.dni,
    email: candidateEmail(candidate),
    phone: candidate.phone,
    fallbackSeed: candidate.fallbackSeed
  });
  return Boolean(findDotacion(identity, index));
}

function personDbValues(candidate: PersonCandidate, dotacion: DotacionIndex | null) {
  const email = candidateEmail(candidate);
  const identity = resolveIdentity({
    cuil: candidate.cuil,
    dni: candidate.dni,
    email,
    phone: candidate.phone,
    fallbackSeed: candidate.fallbackSeed
  });
  const dot = findDotacion(identity, dotacion);
  return {
    identity,
    aliases: [...new Set([identity.key, ...aliasesFor(candidate)])],
    fields: [
      identity.key,
      identity.quality,
      identity.cuil,
      identity.dni,
      normalizeText(candidate.firstName) ?? dot?.firstName ?? null,
      normalizeText(candidate.lastName) ?? dot?.lastName ?? null,
      identity.phone,
      normalizeEmail(candidate.emailForm),
      dot?.emailPersonal ?? normalizeEmail(candidate.emailPersonal),
      dot?.emailMia ?? normalizeEmail(candidate.emailMia),
      dot?.emailLaboral ?? normalizeEmail(candidate.emailLaboral),
      normalizeText(candidate.birthDate) ?? dot?.birthDate ?? null,
      normalizeText(candidate.sex) ?? dot?.sex ?? null,
      normalizeText(candidate.workAddress) ?? dot?.workAddress ?? null,
      normalizeText(candidate.personalAddress) ?? dot?.personalAddress ?? null,
      normalizeText(candidate.areaForm),
      normalizeText(candidate.roleForm),
      dot?.area ?? normalizeText(candidate.areaDotacion),
      dot?.role ?? normalizeText(candidate.roleDotacion),
      dot?.descRep ?? normalizeText(candidate.descRep),
      dot?.pathNombres ?? normalizeText(candidate.pathNombres),
      Boolean(dot),
      normalizeText(candidate.estadoRegistro),
      normalizeText(candidate.observacionesCalidad),
      JSON.stringify([candidate.source])
    ]
  };
}

export async function upsertPerson(candidate: PersonCandidate, dotacion: DotacionIndex | null): Promise<number> {
  const email = candidateEmail(candidate);
  const identity = resolveIdentity({
    cuil: candidate.cuil,
    dni: candidate.dni,
    email,
    phone: candidate.phone,
    fallbackSeed: candidate.fallbackSeed
  });
  const aliases = [...new Set([identity.key, ...aliasesFor(candidate)])];
  const strongAliases = aliases.filter((alias) => alias.startsWith("cuil:") || alias.startsWith("dni:"));
  const lookupAliases = strongAliases.length ? strongAliases : aliases;
  const placeholders = lookupAliases.map(() => "?").join(", ");
  let personId: number | null = null;
  if (lookupAliases.length) {
    const found = await baseQuery<(RowDataPacket & { persona_id: number })[]>(
      `SELECT persona_id FROM persona_aliases WHERE alias_key IN (${placeholders}) LIMIT 1`,
      lookupAliases
    );
    personId = found[0] ? Number(found[0].persona_id) : null;
  }
  if (!personId && (identity.cuil || identity.dni)) {
    const found = await baseQuery<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM personas WHERE (cuil IS NOT NULL AND cuil = ?) OR (dni IS NOT NULL AND dni = ?) LIMIT 1",
      [identity.cuil, identity.dni]
    );
    personId = found[0] ? Number(found[0].id) : null;
  }

  const values = personDbValues(candidate, dotacion).fields;

  if (!personId) {
    const result = await baseExecute(
      `INSERT INTO personas (
        identity_key, calidad_identidad, cuil, dni, nombre, apellido, telefono,
        email_form, mail_personal, mail_mia, mail_laboral, fecha_nacimiento, sexo,
        domicilio_laboral, domicilio_personal, area_form, rol_form, area_dotacion,
        rol_dotacion, desc_rep, path_nombres, en_dotacion, estado_registro,
        observaciones_calidad, fuentes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );
    personId = result.insertId;
  } else {
    const current = await baseQuery<(RowDataPacket & { fuentes_json: unknown })[]>(
      "SELECT fuentes_json FROM personas WHERE id = ?",
      [personId]
    );
    await baseExecute(
      `UPDATE personas SET
        cuil = COALESCE(?, cuil), dni = COALESCE(?, dni),
        nombre = COALESCE(?, nombre), apellido = COALESCE(?, apellido),
        telefono = COALESCE(?, telefono), email_form = COALESCE(?, email_form),
        mail_personal = COALESCE(?, mail_personal), mail_mia = COALESCE(?, mail_mia),
        mail_laboral = COALESCE(?, mail_laboral), fecha_nacimiento = COALESCE(?, fecha_nacimiento),
        sexo = COALESCE(?, sexo), domicilio_laboral = COALESCE(?, domicilio_laboral),
        domicilio_personal = COALESCE(?, domicilio_personal), area_form = COALESCE(?, area_form),
        rol_form = COALESCE(?, rol_form), area_dotacion = COALESCE(?, area_dotacion),
        rol_dotacion = COALESCE(?, rol_dotacion), desc_rep = COALESCE(?, desc_rep),
        path_nombres = COALESCE(?, path_nombres), en_dotacion = en_dotacion OR ?,
        estado_registro = COALESCE(?, estado_registro),
        observaciones_calidad = COALESCE(?, observaciones_calidad), fuentes_json = ?
       WHERE id = ?`,
      [
        ...values.slice(2, 24),
        jsonSources(current[0]?.fuentes_json, candidate.source),
        personId
      ]
    );
  }
  for (const alias of aliases) {
    await baseExecute(
      "INSERT INTO persona_aliases (alias_key, persona_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE persona_id = persona_id",
      [alias, personId]
    );
  }
  return personId;
}

const PERSON_COLUMNS = [
  "identity_key",
  "calidad_identidad",
  "cuil",
  "dni",
  "nombre",
  "apellido",
  "telefono",
  "email_form",
  "mail_personal",
  "mail_mia",
  "mail_laboral",
  "fecha_nacimiento",
  "sexo",
  "domicilio_laboral",
  "domicilio_personal",
  "area_form",
  "rol_form",
  "area_dotacion",
  "rol_dotacion",
  "desc_rep",
  "path_nombres",
  "en_dotacion",
  "estado_registro",
  "observaciones_calidad",
  "fuentes_json"
] as const;

async function rebuildPersonAliases(): Promise<Map<string, number>> {
  const people = await baseQuery<
    (RowDataPacket & {
      id: number;
      identity_key: string;
      cuil: string | null;
      dni: string | null;
      telefono: string | null;
      email_form: string | null;
      mail_personal: string | null;
      mail_mia: string | null;
      mail_laboral: string | null;
    })[]
  >(
    `SELECT id, identity_key, cuil, dni, telefono, email_form, mail_personal, mail_mia, mail_laboral
     FROM personas`
  );
  const aliases: Array<[string, number]> = [];
  for (const person of people) {
    const keys = [
      person.identity_key,
      person.cuil ? `cuil:${person.cuil}` : null,
      person.dni ? `dni:${person.dni}` : null,
      ...[person.email_form, person.mail_personal, person.mail_mia, person.mail_laboral]
        .filter(Boolean)
        .map((email) => `email:${String(email).toLowerCase()}`),
      person.telefono ? `telefono:${person.telefono}` : null
    ].filter((value): value is string => Boolean(value));
    for (const key of new Set(keys)) aliases.push([key, Number(person.id)]);
  }
  const chunkSize = 500;
  for (let offset = 0; offset < aliases.length; offset += chunkSize) {
    const chunk = aliases.slice(offset, offset + chunkSize);
    await baseExecute(
      `INSERT IGNORE INTO persona_aliases (alias_key, persona_id) VALUES ${chunk.map(() => "(?, ?)").join(", ")}`,
      chunk.flat()
    );
  }
  const stored = await baseQuery<(RowDataPacket & { alias_key: string; persona_id: number })[]>(
    "SELECT alias_key, persona_id FROM persona_aliases"
  );
  return new Map(stored.map((row) => [row.alias_key, Number(row.persona_id)]));
}

async function bulkUpsertPeople(
  candidates: PersonCandidate[],
  dotacion: DotacionIndex
): Promise<Map<string, number>> {
  const chunkSize = 150;
  const quotedColumns = PERSON_COLUMNS.map((column) => `\`${column}\``).join(", ");
  const updateColumns = PERSON_COLUMNS.slice(2, -1)
    .map((column) => `\`${column}\` = COALESCE(VALUES(\`${column}\`), \`${column}\`)`)
    .join(", ");
  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(() => `(${PERSON_COLUMNS.map(() => "?").join(", ")})`)
      .join(", ");
    await baseExecute(
      `INSERT INTO personas (${quotedColumns}) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE ${updateColumns},
       fuentes_json = JSON_MERGE_PRESERVE(COALESCE(fuentes_json, JSON_ARRAY()), VALUES(fuentes_json))`,
      chunk.flatMap((candidate) => personDbValues(candidate, dotacion).fields)
    );
  }
  return rebuildPersonAliases();
}

async function upsertEvent(candidate: AttendanceCandidate): Promise<number> {
  const date = dateValue(candidate.eventDate);
  const fingerprint = normalizeEventFingerprint(candidate.eventName, date);
  const existing = await baseQuery<(RowDataPacket & { id: number; fuentes_json: unknown })[]>(
    `SELECT id, fuentes_json FROM eventos
     WHERE (? IS NOT NULL AND app_event_id = ?) OR fingerprint = ? LIMIT 1`,
    [candidate.appEventId ?? null, candidate.appEventId ?? null, fingerprint]
  );
  if (existing[0]) {
    await baseExecute(
      `UPDATE eventos SET nombre = COALESCE(?, nombre), tipo = COALESCE(?, tipo),
       fecha = COALESCE(?, fecha), app_event_id = COALESCE(?, app_event_id),
       mysql_table_name = COALESCE(?, mysql_table_name), fuentes_json = ? WHERE id = ?`,
      [
        normalizeText(candidate.eventName),
        normalizeText(candidate.eventType),
        date ? date.toISOString().slice(0, 10) : null,
        candidate.appEventId ?? null,
        candidate.mysqlTableName ?? null,
        jsonSources(existing[0].fuentes_json, candidate.source),
        existing[0].id
      ]
    );
    return Number(existing[0].id);
  }
  const result = await baseExecute(
    `INSERT INTO eventos (fingerprint, nombre, tipo, fecha, app_event_id, mysql_table_name, fuentes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      fingerprint,
      normalizeText(candidate.eventName) ?? "Evento",
      normalizeText(candidate.eventType),
      date ? date.toISOString().slice(0, 10) : null,
      candidate.appEventId ?? null,
      candidate.mysqlTableName ?? null,
      JSON.stringify([candidate.source])
    ]
  );
  return result.insertId;
}

export async function upsertAttendance(candidate: AttendanceCandidate, dotacion: DotacionIndex | null): Promise<void> {
  const personId = await upsertPerson(candidate.person, dotacion);
  const eventId = await upsertEvent(candidate);
  const existing = await baseQuery<(RowDataPacket & { fuentes_json: unknown })[]>(
    "SELECT fuentes_json FROM asistencias WHERE persona_id = ? AND evento_id = ?",
    [personId, eventId]
  );
  const sources = jsonSources(existing[0]?.fuentes_json, candidate.source);
  await baseExecute(
    `INSERT INTO asistencias (
      persona_id, evento_id, inscripto, asistio, fuera_de_base, estado, fecha_acreditacion, fuentes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      inscripto = COALESCE(VALUES(inscripto), inscripto),
      asistio = asistio OR VALUES(asistio),
      fuera_de_base = COALESCE(VALUES(fuera_de_base), fuera_de_base),
      estado = COALESCE(VALUES(estado), estado),
      fecha_acreditacion = COALESCE(VALUES(fecha_acreditacion), fecha_acreditacion),
      fuentes_json = VALUES(fuentes_json)`,
    [
      personId,
      eventId,
      booleanValue(candidate.registered),
      booleanValue(candidate.attended) ?? true,
      booleanValue(candidate.outOfBase),
      normalizeText(candidate.status),
      dateValue(candidate.accreditedAt),
      sources
    ]
  );
}

function historicalPerson(row: Record<string, unknown>, rowNumber: number, source: string): PersonCandidate {
  const get = rowReader(row);
  return {
    cuil: get("CUIT", "CUIL"),
    firstName: get("NOMBRE"),
    lastName: get("APELLIDO"),
    phone: get("TELEFONO"),
    emailForm: get("EMAIL_FORM"),
    emailPersonal: get("MAIL_PERSONAL"),
    emailMia: get("MAIL_MIA"),
    emailLaboral: get("MAIL_LABORAL"),
    birthDate: get("FEC_NACIM"),
    sex: get("SEXO"),
    workAddress: get("DOMICILIO_LABORAL"),
    personalAddress: get("DOMICILIO_PERSONAL"),
    areaForm: get("AREA_FORM"),
    roleForm: get("ROL_FORM"),
    areaDotacion: get("AREA_DOTACION"),
    roleDotacion: get("ROL_DOTACION"),
    descRep: get("DESC_REP"),
    pathNombres: get("PATH_NOMBRES"),
    estadoRegistro: get("ESTADO_REGISTRO"),
    observacionesCalidad: get("OBSERVACIONES_CALIDAD", "OBSERVACIONES"),
    fallbackSeed: `${source}:${rowNumber}:${JSON.stringify(row)}`,
    source
  };
}

export async function bulkUpsertAttendances(
  candidates: AttendanceCandidate[],
  dotacion: DotacionIndex
): Promise<number> {
  const aliasMap = await bulkUpsertPeople(
    candidates.map((candidate) => candidate.person),
    dotacion
  );
  const eventCandidates = new Map<string, AttendanceCandidate>();
  for (const candidate of candidates) {
    eventCandidates.set(normalizeEventFingerprint(candidate.eventName, dateValue(candidate.eventDate)), candidate);
  }
  for (const candidate of eventCandidates.values()) await upsertEvent(candidate);
  const eventRows = await baseQuery<(RowDataPacket & { id: number; fingerprint: string })[]>(
    "SELECT id, fingerprint FROM eventos"
  );
  const eventMap = new Map(eventRows.map((row) => [row.fingerprint, Number(row.id)]));

  const unique = new Map<
    string,
    {
      personId: number;
      eventId: number;
      registered: boolean | null;
      attended: boolean;
      outOfBase: boolean | null;
      status: string | null;
      accreditedAt: Date | null;
      source: string;
    }
  >();
  for (const candidate of candidates) {
    const person = candidate.person;
    const identity = resolveIdentity({
      cuil: person.cuil,
      dni: person.dni,
      email: candidateEmail(person),
      phone: person.phone,
      fallbackSeed: person.fallbackSeed
    });
    const personId = aliasMap.get(identity.key);
    const eventId = eventMap.get(normalizeEventFingerprint(candidate.eventName, dateValue(candidate.eventDate)));
    if (!personId || !eventId) continue;
    unique.set(`${personId}:${eventId}`, {
      personId,
      eventId,
      registered: booleanValue(candidate.registered),
      attended: booleanValue(candidate.attended) ?? true,
      outOfBase: booleanValue(candidate.outOfBase),
      status: normalizeText(candidate.status),
      accreditedAt: dateValue(candidate.accreditedAt),
      source: candidate.source
    });
  }
  const rows = [...unique.values()];
  const chunkSize = 300;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await baseExecute(
      `INSERT INTO asistencias (
        persona_id, evento_id, inscripto, asistio, fuera_de_base, estado, fecha_acreditacion, fuentes_json
       ) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE inscripto = COALESCE(VALUES(inscripto), inscripto),
       asistio = asistio OR VALUES(asistio),
       fuera_de_base = COALESCE(VALUES(fuera_de_base), fuera_de_base),
       estado = COALESCE(VALUES(estado), estado),
       fecha_acreditacion = COALESCE(VALUES(fecha_acreditacion), fecha_acreditacion),
       fuentes_json = JSON_MERGE_PRESERVE(COALESCE(fuentes_json, JSON_ARRAY()), VALUES(fuentes_json))`,
      chunk.flatMap((row) => [
        row.personId,
        row.eventId,
        row.registered,
        row.attended,
        row.outOfBase,
        row.status,
        row.accreditedAt,
        JSON.stringify([row.source])
      ])
    );
  }
  return rows.length;
}

async function importHistoricalAttendances(
  detail: Array<Record<string, unknown>>,
  dotacion: DotacionIndex
): Promise<number> {
  const source = "excel:DETALLE_EVENTO_PERSONA";
  const candidates = detail.flatMap((row, index): AttendanceCandidate[] => {
    const get = rowReader(row);
    if (booleanValue(get("ASISTIO")) !== true) return [];
    return [
      {
        person: historicalPerson(row, index + 2, source),
        eventName: get("EVENTO"),
        eventType: get("TIPO_EVENTO"),
        eventDate: get("FECHA_EVENTO"),
        registered: get("INSCRIPTO"),
        attended: get("ASISTIO"),
        outOfBase: get("FUERA_DE_BASE"),
        status: get("ESTADO_ASISTENCIA_EVENTO"),
        source
      }
    ];
  });
  return bulkUpsertAttendances(candidates, dotacion);
}

export function previewHistoricalWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheet = workbook.Sheets.DETALLE_EVENTO_PERSONA;
  if (!sheet) throw new Error("Falta la hoja DETALLE_EVENTO_PERSONA");
  const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    sheet,
    { defval: null }
  );
  const attended = detail.filter((row) => booleanValue(rowReader(row)("ASISTIO")) === true);
  const identities = attended.map((row, index) => {
    const person = historicalPerson(row, index + 2, "excel:DETALLE_EVENTO_PERSONA");
    return resolveIdentity({
      cuil: person.cuil,
      email: candidateEmail(person),
      phone: person.phone,
      fallbackSeed: person.fallbackSeed
    });
  });
  const quality = identities.reduce<Record<string, number>>((acc, identity) => {
    acc[identity.quality] = (acc[identity.quality] ?? 0) + 1;
    return acc;
  }, {});
  return {
    sheet: {
      name: "DETALLE_EVENTO_PERSONA",
      rows: detail.length,
      headers: detail[0] ? Object.keys(detail[0]) : []
    },
    attendedRows: attended.length,
    quality
  };
}

export async function importHistoricalWorkbook(
  buffer: Buffer,
  filename: string,
  dotacion: DotacionIndex
): Promise<Record<string, unknown>> {
  const hash = createHash("sha256").update(buffer).digest("hex");
  const workbook = XLSX.read(buffer, { cellDates: true });
  const carga = await createCarga("xlsx_historico", filename, hash);
  if (carga.alreadyCompleted) {
    const existingSheet = workbook.Sheets.DETALLE_EVENTO_PERSONA;
    if (!existingSheet) throw new Error("Falta la hoja DETALLE_EVENTO_PERSONA");
    const existingDetail = XLSX.utils.sheet_to_json<Record<string, unknown>>(existingSheet, { defval: null });
    const attendanceRows = await importHistoricalAttendances(existingDetail, dotacion);
    return {
      skippedRaw: true,
      reason: "La hoja raw ya existía; se refrescaron personas y asistencias",
      cargaId: carga.id,
      attendanceRows
    };
  }
  const sheet = workbook.Sheets.DETALLE_EVENTO_PERSONA;
  if (!sheet) throw new Error("Falta la hoja DETALLE_EVENTO_PERSONA");
  const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const headers = detail[0] ? Object.keys(detail[0]) : [];
  const raw = await prepareRawTable("DETALLE_EVENTO_PERSONA", headers);
  await insertRawRows(raw.tableName, raw.columns, carga.id, detail);
  const rawRows = detail.length;

  let dotacionMatches = 0;
  for (let index = 0; index < detail.length; index += 1) {
    const get = rowReader(detail[index]);
    if (booleanValue(get("ASISTIO")) !== true) continue;
    const person = historicalPerson(detail[index], index + 2, "excel:DETALLE_EVENTO_PERSONA");
    const identity = resolveIdentity({
      cuil: person.cuil,
      email: candidateEmail(person),
      phone: person.phone,
      fallbackSeed: person.fallbackSeed
    });
    if ((identity.cuil && dotacion.byCuil.has(identity.cuil)) || (identity.dni && dotacion.byDni.has(identity.dni))) {
      dotacionMatches += 1;
    }
  }
  const attendanceRows = await importHistoricalAttendances(detail, dotacion);
  const details = {
    sheets: 1,
    rawRows,
    attendanceRows,
    dotacionMatches,
    dotacionTable: `${dotacion.database}.${dotacion.table}`
  };
  await completeCarga(carga.id, rawRows, details);
  logger.info({ cargaId: carga.id, ...details }, "Consolidado histórico importado a BASE_ACREDITADOS");
  return { cargaId: carga.id, ...details };
}

export async function getBaseAcreditadosStats(): Promise<Record<string, unknown>> {
  const totals = await baseQuery<
    (RowDataPacket & {
      personas: number;
      en_dotacion: number;
      eventos: number;
      asistencias: number;
    })[]
  >(
    `SELECT
      (SELECT COUNT(*) FROM personas) AS personas,
      (SELECT COUNT(*) FROM personas WHERE en_dotacion = TRUE) AS en_dotacion,
      (SELECT COUNT(*) FROM eventos) AS eventos,
      (SELECT COUNT(*) FROM asistencias WHERE asistio = TRUE) AS asistencias`
  );
  const qualityRows = await baseQuery<(RowDataPacket & { calidad_identidad: string; total: number })[]>(
    "SELECT calidad_identidad, COUNT(*) AS total FROM personas GROUP BY calidad_identidad ORDER BY total DESC"
  );
  const duplicateRows = await baseQuery<
    (RowDataPacket & { duplicate_cuil_groups: number; duplicate_dni_groups: number })[]
  >(
    `SELECT
      (SELECT COUNT(*) FROM (
        SELECT cuil FROM personas WHERE cuil IS NOT NULL GROUP BY cuil HAVING COUNT(*) > 1
      ) c) AS duplicate_cuil_groups,
      (SELECT COUNT(*) FROM (
        SELECT dni FROM personas WHERE dni IS NOT NULL GROUP BY dni HAVING COUNT(*) > 1
      ) d) AS duplicate_dni_groups`
  );
  return {
    ...totals[0],
    calidadIdentidad: Object.fromEntries(
      qualityRows.map((row) => [row.calidad_identidad, Number(row.total)])
    ),
    duplicateCuilGroups: Number(duplicateRows[0]?.duplicate_cuil_groups ?? 0),
    duplicateDniGroups: Number(duplicateRows[0]?.duplicate_dni_groups ?? 0)
  };
}

