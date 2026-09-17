import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2/promise";
import { logger } from "../../lib/logger";
import {
  isValidCuil,
  normalizeDni,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  resolveIdentity,
  type IdentityQuality,
  type ResolvedIdentity
} from "./identity";
import {
  baseExecute,
  baseQuery,
  baseTableExists,
  dotacionDatabaseName,
  dotacionTableName,
  openMysqlServerConnection
} from "./mysql";
import {
  PERSONA_ESTADO_CONVOCADO,
  appendEventoAsistido,
  mergePersonaEstado,
  normalizePersonaEstado
} from "./policy";

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

const IDENTITY_QUALITY_RANK: Record<IdentityQuality, number> = {
  cuil: 5,
  dni: 4,
  email: 3,
  telefono: 2,
  sin_clave_confiable: 1
};

type ExistingPersona = {
  id: number;
  identity_key: string;
  cuil: string | null;
  dni: string | null;
  estado: string | null;
  eventos_asistidos: string | null;
  fuentes_json: unknown;
  en_dotacion: boolean;
};

type PersonWriteExtras = {
  identityKey?: string;
  estado?: string | null;
  eventosAsistidos?: string | null;
  fuentesJson?: string;
};

function identityOf(person: PersonCandidate): ResolvedIdentity {
  return resolveIdentity({
    cuil: person.cuil,
    dni: person.dni,
    email: candidateEmail(person),
    phone: person.phone,
    fallbackSeed: person.fallbackSeed
  });
}

function personDbValues(
  candidate: PersonCandidate,
  dotacion: DotacionIndex | null,
  extras?: PersonWriteExtras
) {
  const identity = identityOf(candidate);
  const dot = findDotacion(identity, dotacion);
  return {
    identity,
    fields: [
      extras?.identityKey ?? identity.key,
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
      extras?.estado ?? null,
      extras?.eventosAsistidos ?? null,
      normalizeText(candidate.estadoRegistro),
      normalizeText(candidate.observacionesCalidad),
      extras?.fuentesJson ?? JSON.stringify([candidate.source])
    ]
  };
}

async function findExistingPersonas(identities: ResolvedIdentity[]): Promise<ExistingPersona[]> {
  if (!identities.length) return [];
  const found: ExistingPersona[] = [];
  const seen = new Set<number>();
  const chunkSize = 300;
  for (let offset = 0; offset < identities.length; offset += chunkSize) {
    const chunk = identities.slice(offset, offset + chunkSize);
    const keys = [...new Set(chunk.map((identity) => identity.key))];
    const cuils = [...new Set(chunk.map((identity) => identity.cuil).filter((value): value is string => Boolean(value)))];
    const dnis = [...new Set(chunk.map((identity) => identity.dni).filter((value): value is string => Boolean(value)))];
    const conditions = [`identity_key IN (${keys.map(() => "?").join(", ")})`];
    const params: unknown[] = [...keys];
    if (cuils.length) {
      conditions.push(`(cuil IS NOT NULL AND cuil IN (${cuils.map(() => "?").join(", ")}))`);
      params.push(...cuils);
    }
    if (dnis.length) {
      conditions.push(`(dni IS NOT NULL AND dni IN (${dnis.map(() => "?").join(", ")}))`);
      params.push(...dnis);
    }
    const rows = await baseQuery<
      (RowDataPacket & {
        id: number;
        identity_key: string;
        cuil: string | null;
        dni: string | null;
        estado: string | null;
        eventos_asistidos: string | null;
        fuentes_json: unknown;
        en_dotacion: number | boolean;
      })[]
    >(
      `SELECT id, identity_key, cuil, dni, estado, eventos_asistidos, fuentes_json, en_dotacion
       FROM personas WHERE ${conditions.join(" OR ")}`,
      params
    );
    for (const row of rows) {
      const id = Number(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({
        id,
        identity_key: row.identity_key,
        cuil: row.cuil,
        dni: row.dni,
        estado: row.estado,
        eventos_asistidos: row.eventos_asistidos,
        fuentes_json: row.fuentes_json,
        en_dotacion: Boolean(row.en_dotacion)
      });
    }
  }
  return found;
}

function matchExistingPersona(
  identity: ResolvedIdentity,
  existing: ExistingPersona[]
): ExistingPersona | null {
  return (
    existing.find((row) => row.identity_key === identity.key) ??
    (identity.cuil ? existing.find((row) => row.cuil === identity.cuil) : undefined) ??
    (identity.dni ? existing.find((row) => row.dni === identity.dni) : undefined) ??
    null
  );
}

export async function upsertPerson(candidate: PersonCandidate, dotacion: DotacionIndex | null): Promise<number> {
  const identity = identityOf(candidate);
  const existing = matchExistingPersona(identity, await findExistingPersonas([identity]));
  const fields = personDbValues(candidate, dotacion, { identityKey: existing?.identity_key }).fields;
  await bulkWritePersonas([fields]);
  if (existing) return existing.id;
  const inserted = matchExistingPersona(identity, await findExistingPersonas([identity]));
  return inserted?.id ?? 0;
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
  "estado",
  "eventos_asistidos",
  "estado_registro",
  "observaciones_calidad",
  "fuentes_json"
] as const;

function personUpdateSql(): string {
  return PERSON_COLUMNS.slice(2)
    .map((column) => {
      if (column === "en_dotacion") return "`en_dotacion` = `en_dotacion` OR VALUES(`en_dotacion`)";
      if (column === "fuentes_json") {
        return "`fuentes_json` = JSON_MERGE_PRESERVE(COALESCE(`fuentes_json`, JSON_ARRAY()), VALUES(`fuentes_json`))";
      }
      return `\`${column}\` = COALESCE(VALUES(\`${column}\`), \`${column}\`)`;
    })
    .join(", ");
}

async function bulkWritePersonas(rows: unknown[][]): Promise<void> {
  if (!rows.length) return;
  const quotedColumns = PERSON_COLUMNS.map((column) => `\`${column}\``).join(", ");
  const updateSql = personUpdateSql();
  const chunkSize = 150;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => `(${PERSON_COLUMNS.map(() => "?").join(", ")})`).join(", ");
    await baseExecute(
      `INSERT INTO personas (${quotedColumns}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateSql}`,
      chunk.flat()
    );
  }
}

function coalesceUnknown(current: unknown, incoming: unknown): unknown {
  return incoming == null || incoming === "" ? current : incoming;
}

function mergePersonCandidate(base: PersonCandidate, extra: PersonCandidate): PersonCandidate {
  return {
    cuil: coalesceUnknown(base.cuil, extra.cuil),
    dni: coalesceUnknown(base.dni, extra.dni),
    firstName: coalesceUnknown(base.firstName, extra.firstName),
    lastName: coalesceUnknown(base.lastName, extra.lastName),
    phone: coalesceUnknown(base.phone, extra.phone),
    emailForm: coalesceUnknown(base.emailForm, extra.emailForm),
    emailPersonal: coalesceUnknown(base.emailPersonal, extra.emailPersonal),
    emailMia: coalesceUnknown(base.emailMia, extra.emailMia),
    emailLaboral: coalesceUnknown(base.emailLaboral, extra.emailLaboral),
    birthDate: coalesceUnknown(base.birthDate, extra.birthDate),
    sex: coalesceUnknown(base.sex, extra.sex),
    workAddress: coalesceUnknown(base.workAddress, extra.workAddress),
    personalAddress: coalesceUnknown(base.personalAddress, extra.personalAddress),
    areaForm: coalesceUnknown(base.areaForm, extra.areaForm),
    roleForm: coalesceUnknown(base.roleForm, extra.roleForm),
    areaDotacion: coalesceUnknown(base.areaDotacion, extra.areaDotacion),
    roleDotacion: coalesceUnknown(base.roleDotacion, extra.roleDotacion),
    descRep: coalesceUnknown(base.descRep, extra.descRep),
    pathNombres: coalesceUnknown(base.pathNombres, extra.pathNombres),
    estadoRegistro: coalesceUnknown(base.estadoRegistro, extra.estadoRegistro),
    observacionesCalidad: coalesceUnknown(base.observacionesCalidad, extra.observacionesCalidad),
    fallbackSeed: base.fallbackSeed,
    source: extra.source
  };
}

function personaEstadoFromAttendance(candidate: AttendanceCandidate): string {
  return (
    normalizePersonaEstado(normalizeText(candidate.status), {
      attended: booleanValue(candidate.attended) === true,
      outOfBase: booleanValue(candidate.outOfBase) === true
    }) ?? PERSONA_ESTADO_CONVOCADO
  );
}

type AttendanceGroup = {
  identityKey: string;
  identity: ResolvedIdentity;
  person: PersonCandidate;
  estado: string | null;
  attendedEvents: Array<{ name: string; time: number }>;
  sources: string[];
  existing: ExistingPersona | null;
};

function indexAttendanceGroup(
  group: AttendanceGroup,
  byKey: Map<string, AttendanceGroup>,
  byCuil: Map<string, AttendanceGroup>,
  byDni: Map<string, AttendanceGroup>
): void {
  byKey.set(group.identityKey, group);
  byKey.set(group.identity.key, group);
  if (group.identity.cuil) byCuil.set(group.identity.cuil, group);
  if (group.identity.dni) byDni.set(group.identity.dni, group);
}

export async function upsertAttendance(
  candidate: AttendanceCandidate,
  dotacion: DotacionIndex | null
): Promise<void> {
  await bulkUpsertAttendances([candidate], dotacion);
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
  dotacion: DotacionIndex | null
): Promise<number> {
  if (!candidates.length) return 0;
  const identities = candidates.map((candidate) => identityOf(candidate.person));
  const existingRows = await findExistingPersonas(identities);
  const groups: AttendanceGroup[] = [];
  const byKey = new Map<string, AttendanceGroup>();
  const byCuil = new Map<string, AttendanceGroup>();
  const byDni = new Map<string, AttendanceGroup>();

  for (const candidate of candidates) {
    const identity = identityOf(candidate.person);
    const existing = matchExistingPersona(identity, existingRows);
    const found =
      (existing ? groups.find((group) => group.existing?.id === existing.id) : undefined) ??
      byKey.get(identity.key) ??
      (identity.cuil ? byCuil.get(identity.cuil) : undefined) ??
      (identity.dni ? byDni.get(identity.dni) : undefined);

    if (found) {
      found.person = mergePersonCandidate(found.person, candidate.person);
      if (IDENTITY_QUALITY_RANK[identity.quality] > IDENTITY_QUALITY_RANK[found.identity.quality]) {
        found.identity = identity;
        if (!found.existing) found.identityKey = identity.key;
      }
      found.estado = mergePersonaEstado(found.estado, personaEstadoFromAttendance(candidate));
      const eventName = normalizeText(candidate.eventName);
      if (eventName && booleanValue(candidate.attended) === true) {
        found.attendedEvents.push({
          name: eventName,
          time: dateValue(candidate.eventDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
        });
      }
      if (!found.sources.includes(candidate.source)) found.sources.push(candidate.source);
      indexAttendanceGroup(found, byKey, byCuil, byDni);
      continue;
    }

    const group: AttendanceGroup = {
      identityKey: existing?.identity_key ?? identity.key,
      identity,
      person: candidate.person,
      estado: personaEstadoFromAttendance(candidate),
      attendedEvents:
        booleanValue(candidate.attended) === true && normalizeText(candidate.eventName)
          ? [
              {
                name: normalizeText(candidate.eventName) as string,
                time: dateValue(candidate.eventDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
              }
            ]
          : [],
      sources: [candidate.source],
      existing
    };
    groups.push(group);
    indexAttendanceGroup(group, byKey, byCuil, byDni);
  }

  const rows = groups.map((group) => {
    const eventos = [...group.attendedEvents]
      .sort((left, right) => left.time - right.time)
      .reduce(
        (current, event) => appendEventoAsistido(current, event.name),
        group.existing?.eventos_asistidos ?? null
      );
    return personDbValues(group.person, dotacion, {
      identityKey: group.identityKey,
      estado: mergePersonaEstado(group.existing?.estado, group.estado),
      eventosAsistidos: eventos,
      fuentesJson: JSON.stringify(group.sources)
    }).fields;
  });
  await bulkWritePersonas(rows);
  return groups.length;
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
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheet = workbook.Sheets.DETALLE_EVENTO_PERSONA;
  if (!sheet) throw new Error("Falta la hoja DETALLE_EVENTO_PERSONA");
  const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
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
    filename,
    sheets: 1,
    rawRows,
    attendanceRows,
    dotacionMatches,
    dotacionTable: `${dotacion.database}.${dotacion.table}`
  };
  logger.info(details, "Consolidado histórico importado a BASE_ACREDITADOS");
  return details;
}

export async function getBaseAcreditadosStats(): Promise<Record<string, unknown>> {
  const totals = await baseQuery<(RowDataPacket & { personas: number; en_dotacion: number })[]>(
    `SELECT
      (SELECT COUNT(*) FROM personas) AS personas,
      (SELECT COUNT(*) FROM personas WHERE en_dotacion = TRUE) AS en_dotacion`
  );
  const estadoRows = await baseQuery<(RowDataPacket & { estado: string | null; total: number })[]>(
    "SELECT estado, COUNT(*) AS total FROM personas GROUP BY estado ORDER BY total DESC"
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
    estado: Object.fromEntries(estadoRows.map((row) => [row.estado ?? "sin_estado", Number(row.total)])),
    calidadIdentidad: Object.fromEntries(
      qualityRows.map((row) => [row.calidad_identidad, Number(row.total)])
    ),
    duplicateCuilGroups: Number(duplicateRows[0]?.duplicate_cuil_groups ?? 0),
    duplicateDniGroups: Number(duplicateRows[0]?.duplicate_dni_groups ?? 0)
  };
}

/** Completa estado y eventos_asistidos de filas ya cargadas usando asistencias/eventos históricas. */
export async function backfillPersonaEstadoYEventosFromLegacy(): Promise<{
  updated: number;
  skippedNoLegacy: boolean;
}> {
  const hasAsistencias = await baseTableExists("asistencias");
  const hasEventos = await baseTableExists("eventos");
  if (!hasAsistencias || !hasEventos) {
    logger.info("BASE_ACREDITADOS no tiene tablas históricas; se omite el backfill de personas");
    return { updated: 0, skippedNoLegacy: true };
  }

  await baseExecute("SET SESSION group_concat_max_len = 32768");
  const eventosResult = await baseExecute(
    `UPDATE personas p
     INNER JOIN (
       SELECT a.persona_id,
         GROUP_CONCAT(e.nombre ORDER BY e.fecha SEPARATOR ', ') AS eventos
       FROM asistencias a
       INNER JOIN eventos e ON e.id = a.evento_id
       WHERE a.asistio = 1 AND NULLIF(TRIM(e.nombre), '') IS NOT NULL
       GROUP BY a.persona_id
     ) x ON x.persona_id = p.id
     SET p.eventos_asistidos = CASE
       WHEN p.eventos_asistidos IS NULL OR TRIM(p.eventos_asistidos) = '' THEN x.eventos
       ELSE p.eventos_asistidos
     END`
  );
  const estadoResult = await baseExecute(
    `UPDATE personas p
     INNER JOIN (
       SELECT persona_id,
         CASE MAX(
           CASE
             WHEN LOWER(TRIM(COALESCE(estado, ''))) LIKE '%acredit%'
               AND LOWER(TRIM(COALESCE(estado, ''))) NOT LIKE '%no acredit%' THEN 3
             WHEN asistio = 1 AND IFNULL(fuera_de_base, 0) = 0 THEN 3
             WHEN LOWER(TRIM(COALESCE(estado, ''))) IN ('pendiente', 'convocado no acreditado')
               OR LOWER(TRIM(COALESCE(estado, ''))) LIKE '%convocado%' THEN 2
             WHEN asistio = 0 THEN 2
             WHEN LOWER(TRIM(COALESCE(estado, ''))) LIKE '%fuera%'
               OR IFNULL(fuera_de_base, 0) = 1 THEN 1
             ELSE 0
           END
         )
           WHEN 3 THEN 'Acreditado'
           WHEN 2 THEN 'Convocado no acreditado'
           WHEN 1 THEN 'Fuera de base'
           ELSE NULL
         END AS estado_calc
       FROM asistencias
       GROUP BY persona_id
     ) x ON x.persona_id = p.id
     SET p.estado = CASE
       WHEN p.estado = 'Acreditado' OR x.estado_calc = 'Acreditado' THEN 'Acreditado'
       WHEN p.estado = 'Convocado no acreditado' OR x.estado_calc = 'Convocado no acreditado'
         THEN 'Convocado no acreditado'
       ELSE COALESCE(x.estado_calc, p.estado)
     END`
  );
  const updated = Number(eventosResult.affectedRows ?? 0) + Number(estadoResult.affectedRows ?? 0);
  logger.info({ updated }, "Backfill de estado y eventos_asistidos en personas");
  return { updated, skippedNoLegacy: false };
}

