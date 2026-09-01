import { google, sheets_v4, drive_v3 } from "googleapis";
import type { Event, EventPerson, Person, User } from "../../prisma-exports";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

type AccreditedRow = EventPerson & {
  person: Person;
  accreditedByUser: Pick<User, "id" | "name"> | null;
};

export const EVENT_BASE_SHEET_NAME = "Base";

export const SHEET_HEADER = [
  "DNI",
  "Apellido",
  "Nombre",
  "Comuna",
  "Dirección",
  "Teléfono",
  "Mesa",
  "Acreditado el",
  "Acreditado por",
  "Origen"
] as const;

export const ARCHIVE_SHEET_HEADER = [
  "DNI",
  "CUIL",
  "Apellido",
  "Nombre",
  "Email",
  "Teléfono",
  "Comuna",
  "Dirección",
  "Empresa",
  "Cargo",
  "Estado",
  "Origen",
  "Mesa",
  "Acreditado el",
  "Acreditado por",
  "Escuela",
  "Sección",
  "Oferta",
  "Referente"
] as const;

const SHEET_TITLE_MAX = 31;
const INVALID_SHEET_CHARS = /[\\/?*[\]]/g;
const LEGACY_UNPROVISIONED_SHEET_NAME = "Acreditados";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

const lastSheetErrors = new Map<string, string>();

export function recordVecinoSheetError(eventId: string, message: string): void {
  lastSheetErrors.set(eventId, message);
}

export function clearVecinoSheetError(eventId: string): void {
  lastSheetErrors.delete(eventId);
}

export function getVecinoSheetError(eventId: string): string | null {
  return lastSheetErrors.get(eventId) ?? null;
}

function getAuth() {
  const credentials = env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!credentials) return null;
  return new google.auth.GoogleAuth({ credentials, scopes: GOOGLE_SCOPES });
}

function getSheetsClient(): sheets_v4.Sheets | null {
  const auth = getAuth();
  if (!auth) return null;
  try {
    return google.sheets({ version: "v4", auth });
  } catch (err) {
    logger.warn({ err }, "No se pudo inicializar cliente de Google Sheets");
    return null;
  }
}

function getDriveClient(): drive_v3.Drive | null {
  const auth = getAuth();
  if (!auth) return null;
  try {
    return google.drive({ version: "v3", auth });
  } catch (err) {
    logger.warn({ err }, "No se pudo inicializar cliente de Google Drive");
    return null;
  }
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
}

export function buildGoogleSpreadsheetUrl(spreadsheetId?: string | null): string | null {
  const id = spreadsheetId?.trim() || null;
  if (!id || id === "ACREDITADOS") return null;
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export function formatGoogleSheetsError(err: unknown): string {
  const apiErr = (err as { response?: { data?: { error?: { message?: string; status?: string } } } })
    ?.response?.data?.error;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = apiErr?.message ?? raw;
  const status = apiErr?.status ?? "";
  const email = env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS?.client_email;
  if (/storageQuotaExceeded|quota has been exceeded/i.test(msg)) {
    return "La cuenta de Google no tiene espacio para crear archivos. Configurá GOOGLE_DRIVE_FOLDER_ID (Shared Drive) o GOOGLE_SPREADSHEET_ID para usar una pestaña en el libro existente.";
  }
  if (status === "PERMISSION_DENIED" || /does not have permission|permission denied/i.test(msg)) {
    return email
      ? `Sin permiso en Google. Revisá la cuenta de servicio (${email}) y que el archivo permita “cualquiera con el enlace”.`
      : "Sin permiso en Google Sheets.";
  }
  return msg;
}

export function formatVecinoEventSheetDate(startAt: Date): string {
  return startAt
    .toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires"
    })
    .replace(/\//g, "-");
}

export function sanitizeSheetTitle(raw: string): string {
  return raw.replace(INVALID_SHEET_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, SHEET_TITLE_MAX);
}

export function formatEventSheetName(eventName: string): string {
  const trimmed = eventName?.trim();
  if (!trimmed) return sanitizeSheetTitle("Evento");
  return sanitizeSheetTitle(trimmed);
}

/** @deprecated Usar formatEventSheetName (solo nombre del evento). */
export function formatVecinoEventSheetName(_startAt: Date, eventName?: string): string {
  return formatEventSheetName(eventName ?? "");
}

function escapeSheetNameForRange(sheetName: string): string {
  return sheetName.replace(/'/g, "''");
}

export function isUnprovisionedSheetName(name: string | null | undefined): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  return trimmed === LEGACY_UNPROVISIONED_SHEET_NAME;
}

async function listSheetTitles(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Set<string>> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return new Set(
    (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t))
  );
}

async function sheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<boolean> {
  const titles = await listSheetTitles(sheets, spreadsheetId);
  return titles.has(sheetName);
}

async function ensureSheetTitle(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  if (await sheetExists(sheets, spreadsheetId, sheetName)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });
}

async function writeSheetHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  header: readonly string[] = SHEET_HEADER
): Promise<void> {
  const escaped = escapeSheetNameForRange(sheetName);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${escaped}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...header]] }
  });
}

async function shareSpreadsheet(spreadsheetId: string): Promise<void> {
  const drive = getDriveClient();
  if (!drive) return;
  try {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        type: "anyone",
        role: "writer",
        allowFileDiscovery: false
      }
    });
  } catch (err) {
    const already =
      (err as { code?: number; response?: { status?: number } }).code === 409 ||
      (err as { response?: { status?: number } }).response?.status === 409 ||
      /already|exists/i.test(err instanceof Error ? err.message : String(err));
    if (!already) {
      logger.warn(
        { err, spreadsheetId },
        "No se pudo dejar el spreadsheet como editor para cualquiera con el enlace (la organización puede bloquear ese tipo de compartir)"
      );
    }
  }
  for (const email of env.GOOGLE_SHEETS_SHARE_EMAILS) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        sendNotificationEmail: false,
        requestBody: { type: "user", role: "writer", emailAddress: email }
      });
    } catch (err) {
      logger.warn({ err, spreadsheetId, email }, "No se pudo compartir el spreadsheet con un mail extra");
    }
  }
}

export type EventSpreadsheetRef = {
  spreadsheetId: string;
  sheetName: string;
};

export function uniqueSheetName(desired: string, existing: Set<string>): string {
  const base = formatEventSheetName(desired) || "Evento";
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const suffix = ` ${i}`;
    const candidate = sanitizeSheetTitle(base.slice(0, SHEET_TITLE_MAX - suffix.length) + suffix);
    if (!existing.has(candidate)) return candidate;
  }
  return sanitizeSheetTitle(`${base.slice(0, 20)} ${Date.now().toString(36)}`);
}

async function createTabInLegacyWorkbook(eventName: string, spreadsheetId: string): Promise<EventSpreadsheetRef> {
  const sheets = getSheetsClient();
  if (!sheets) {
    throw new Error("Google Sheets no configurado");
  }
  const titles = await listSheetTitles(sheets, spreadsheetId);
  const sheetName = uniqueSheetName(eventName, titles);
  await ensureSheetTitle(sheets, spreadsheetId, sheetName);
  await writeSheetHeader(sheets, spreadsheetId, sheetName, ARCHIVE_SHEET_HEADER);
  logger.info({ spreadsheetId, sheetName, eventName }, "Pestaña creada en el libro de Google Sheets existente");
  return { spreadsheetId, sheetName };
}

async function createDedicatedSpreadsheet(title: string): Promise<EventSpreadsheetRef> {
  const sheets = getSheetsClient();
  if (!sheets) {
    throw new Error("Google Sheets no configurado");
  }
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  const drive = getDriveClient();
  let spreadsheetId: string | null = null;

  if (folderId && drive) {
    const file = await drive.files.create({
      requestBody: {
        name: title.slice(0, 200),
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [folderId]
      },
      supportsAllDrives: true,
      fields: "id"
    });
    spreadsheetId = file.data.id ?? null;
  } else {
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: title.slice(0, 200) },
        sheets: [{ properties: { title: EVENT_BASE_SHEET_NAME } }]
      },
      fields: "spreadsheetId"
    });
    spreadsheetId = created.data.spreadsheetId ?? null;
  }

  if (!spreadsheetId) {
    throw new Error("Google no devolvió ID de spreadsheet");
  }
  await ensureSheetTitle(sheets, spreadsheetId, EVENT_BASE_SHEET_NAME);
  await writeSheetHeader(sheets, spreadsheetId, EVENT_BASE_SHEET_NAME, ARCHIVE_SHEET_HEADER);
  await shareSpreadsheet(spreadsheetId);
  logger.info({ spreadsheetId, eventName: title }, "Archivo de Google Sheets creado para el evento");
  return { spreadsheetId, sheetName: EVENT_BASE_SHEET_NAME };
}

/**
 * Crea un archivo propio del evento. Si la cuenta de servicio no puede crear archivos
 * (cuota 0 típica), usa una pestaña en GOOGLE_SPREADSHEET_ID.
 */
export async function createEventSpreadsheetFile(eventName: string): Promise<EventSpreadsheetRef | null> {
  if (!isGoogleSheetsConfigured()) return null;
  const title = eventName.trim() || "Evento";
  try {
    return await createDedicatedSpreadsheet(title);
  } catch (err) {
    const legacyId = env.GOOGLE_SPREADSHEET_ID?.trim();
    if (!legacyId) {
      throw err;
    }
    logger.warn(
      { err, eventName: title },
      "No se pudo crear un archivo propio; se usa una pestaña en GOOGLE_SPREADSHEET_ID"
    );
    return createTabInLegacyWorkbook(title, legacyId);
  }
}

/** @deprecated Crear archivo con createEventSpreadsheetFile */
export async function createEventGoogleSheet(eventName: string): Promise<string | null> {
  const created = await createEventSpreadsheetFile(eventName);
  return created?.sheetName ?? null;
}

/** @deprecated Usar createEventSpreadsheetFile */
export async function createVecinoEventSheet(_startAt: Date, eventName: string): Promise<string | null> {
  return createEventGoogleSheet(eventName);
}

export async function ensureEventGoogleSheet(
  event: Pick<Event, "id" | "name" | "googleSheetName" | "googleSpreadsheetId">
): Promise<EventSpreadsheetRef | null> {
  const sheets = getSheetsClient();
  if (!sheets || !isGoogleSheetsConfigured()) return null;

  const storedId = event.googleSpreadsheetId?.trim();
  const storedName =
    event.googleSheetName?.trim() && !isUnprovisionedSheetName(event.googleSheetName)
      ? event.googleSheetName.trim()
      : EVENT_BASE_SHEET_NAME;

  if (storedId) {
    try {
      await ensureSheetTitle(sheets, storedId, storedName);
      const legacyId = env.GOOGLE_SPREADSHEET_ID?.trim();
      if (legacyId && storedId !== legacyId) {
        await shareSpreadsheet(storedId);
      }
      return { spreadsheetId: storedId, sheetName: storedName };
    } catch (err) {
      logger.warn(
        { err, eventId: event.id, spreadsheetId: storedId },
        "Spreadsheet guardado no accesible; se creará uno nuevo"
      );
    }
  }

  const created = await createEventSpreadsheetFile(event.name);
  if (!created) return null;

  const { prisma } = await import("../../lib/prisma");
  await prisma.event.update({
    where: { id: event.id },
    data: {
      googleSpreadsheetId: created.spreadsheetId,
      googleSheetName: created.sheetName
    }
  });
  return created;
}

/** @deprecated Usar ensureEventGoogleSheet */
export async function ensureVecinoEventSheet(
  event: Pick<Event, "id" | "startAt" | "name" | "googleSheetName" | "googleSpreadsheetId">
): Promise<EventSpreadsheetRef | null> {
  return ensureEventGoogleSheet(event);
}

function formatAccreditedAt(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function documentForSheet(person: Person): string {
  const dni = person.dni?.trim();
  if (dni) return dni;
  return person.cuilNormalized?.trim() ?? "";
}

function extraString(extra: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const match = Object.entries(extra).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && match[1] != null && String(match[1]).trim() !== "") return String(match[1]).trim();
  }
  return "";
}

export function buildEventSheetRow(eventPerson: AccreditedRow): string[] {
  const extra = (eventPerson.extraData ?? {}) as Record<string, unknown>;
  const mesa = String(extra.mesa ?? "").trim();
  const direccion = String(extra.direccion ?? eventPerson.person.address ?? "").trim();
  return [
    documentForSheet(eventPerson.person),
    eventPerson.person.lastName,
    eventPerson.person.firstName,
    eventPerson.person.comuna ?? "",
    direccion,
    eventPerson.person.phone ?? "",
    mesa,
    formatAccreditedAt(eventPerson.accreditedAt),
    eventPerson.accreditedByUser?.name ?? "",
    eventPerson.source === "manual" ? "Fuera de base" : "Base importada"
  ];
}

export function buildArchiveSheetRow(eventPerson: AccreditedRow): string[] {
  const extra = (eventPerson.extraData ?? {}) as Record<string, unknown>;
  const mesa = String(extra.mesa ?? "").trim();
  const direccion = String(extra.direccion ?? eventPerson.person.address ?? "").trim();
  const estado = eventPerson.status === "accredited" ? "Acreditado" : "Pendiente";
  return [
    eventPerson.person.dni?.trim() ?? "",
    eventPerson.person.cuilNormalized ?? "",
    eventPerson.person.lastName,
    eventPerson.person.firstName,
    eventPerson.person.email ?? "",
    eventPerson.person.phone ?? "",
    eventPerson.person.comuna ?? "",
    direccion,
    eventPerson.person.company ?? extraString(extra, ["empresa", "ministerio", "escuela"]),
    eventPerson.person.position ?? extraString(extra, ["cargo", "rol", "oferta"]),
    estado,
    eventPerson.source === "manual" ? "Fuera de base" : "Base importada",
    mesa,
    formatAccreditedAt(eventPerson.accreditedAt),
    eventPerson.accreditedByUser?.name ?? "",
    extraString(extra, ["escuela", "Escuela"]),
    extraString(extra, ["sección", "seccion", "Sección"]),
    extraString(extra, ["oferta", "Oferta"]),
    extraString(extra, ["referente", "Referente"])
  ];
}

/** @deprecated Usar buildEventSheetRow */
export function buildVecinoSheetRow(eventPerson: AccreditedRow): string[] {
  return buildEventSheetRow(eventPerson);
}

export async function dumpEventPeopleToSpreadsheet(
  spreadsheetId: string,
  sheetName: string,
  rows: AccreditedRow[]
): Promise<void> {
  const sheets = getSheetsClient();
  if (!sheets) throw new Error("Google Sheets no configurado");
  await ensureSheetTitle(sheets, spreadsheetId, sheetName);
  const escaped = escapeSheetNameForRange(sheetName);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${escaped}'`
  });
  const values = [[...ARCHIVE_SHEET_HEADER], ...rows.map((row) => buildArchiveSheetRow(row).map((cell) => String(cell ?? "")))];
  const chunkSize = 4000;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escaped}'!A${i + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: chunk }
    });
  }
}

export async function appendVecinoAccreditationToSheet(
  eventId: string,
  sheetName: string,
  eventPerson: AccreditedRow,
  spreadsheetIdOverride?: string | null
): Promise<void> {
  const spreadsheetId = spreadsheetIdOverride?.trim() || null;
  const sheets = getSheetsClient();

  if (!spreadsheetId || !sheets) {
    const msg = "Google Sheets no configurado (GOOGLE_SERVICE_ACCOUNT_JSON)";
    recordVecinoSheetError(eventId, msg);
    logger.warn({ eventId }, msg);
    return;
  }

  const escaped = escapeSheetNameForRange(sheetName);
  const range = `'${escaped}'!A:J`;

  try {
    await ensureSheetTitle(sheets, spreadsheetId, sheetName);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escaped}'!A1:A1`
    });
    if (!existing.data.values?.length) {
      await writeSheetHeader(sheets, spreadsheetId, sheetName);
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [buildEventSheetRow(eventPerson)] }
    });

    clearVecinoSheetError(eventId);
    logger.info(
      { spreadsheetId, sheetName, eventPersonId: eventPerson.id, dni: eventPerson.person.dni },
      "Fila de acreditación enviada a Google Sheets"
    );
  } catch (err) {
    const message = formatGoogleSheetsError(err);
    recordVecinoSheetError(eventId, message);
    logger.error(
      { err, eventId, spreadsheetId, sheetName, eventPersonId: eventPerson.id },
      "Falló envío a Google Sheets"
    );
    throw err;
  }
}
