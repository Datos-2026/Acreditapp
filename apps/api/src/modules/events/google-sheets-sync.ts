import { google, sheets_v4 } from "googleapis";

import type { Event, EventPerson, Person, User } from "../../prisma-exports";

import { env } from "../../config/env";

import { logger } from "../../lib/logger";



type AccreditedRow = EventPerson & {

  person: Person;

  accreditedByUser: Pick<User, "id" | "name"> | null;

};



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



const SHEET_TITLE_MAX = 31;

const INVALID_SHEET_CHARS = /[\\/?*[\]]/g;

/** Valor legacy de la migración inicial; no indica una hoja real provisionada. */

const LEGACY_UNPROVISIONED_SHEET_NAME = "Acreditados";



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



function getSpreadsheetId(): string | null {

  return env.GOOGLE_SPREADSHEET_ID?.trim() || null;

}



function getSheetsClient(): sheets_v4.Sheets | null {

  const credentials = env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;

  if (!credentials) return null;

  try {

    const auth = new google.auth.GoogleAuth({

      credentials,

      scopes: ["https://www.googleapis.com/auth/spreadsheets"]

    });

    return google.sheets({ version: "v4", auth });

  } catch (err) {

    logger.warn({ err }, "No se pudo inicializar cliente de Google Sheets");

    return null;

  }

}



export function isGoogleSheetsConfigured(): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS && getSpreadsheetId());
}

export function buildGoogleSpreadsheetUrl(): string | null {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export function formatGoogleSheetsError(err: unknown): string {
  const apiErr = (err as { response?: { data?: { error?: { message?: string; status?: string } } } })
    ?.response?.data?.error;

  const raw = err instanceof Error ? err.message : String(err);

  const msg = apiErr?.message ?? raw;

  const status = apiErr?.status ?? "";

  const email = env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS?.client_email;

  if (status === "PERMISSION_DENIED" || /does not have permission|permission denied/i.test(msg)) {

    return email

      ? `Sin permiso en el spreadsheet. En Google Sheets: Compartir → agregar ${email} como Editor.`

      : "Sin permiso en el spreadsheet. Compartilo con la cuenta de servicio como Editor.";

  }

  return msg;

}



/** Fecha del evento en formato dd-MM-yyyy (zona Argentina). */

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



/** Título de hoja válido para Excel (máx. 31 caracteres). */

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



/** Nombres que no representan una hoja creada para el evento. */

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



async function writeSheetHeader(

  sheets: sheets_v4.Sheets,

  spreadsheetId: string,

  sheetName: string

): Promise<void> {

  const escaped = escapeSheetNameForRange(sheetName);

  await sheets.spreadsheets.values.update({

    spreadsheetId,

    range: `'${escaped}'!A1`,

    valueInputOption: "USER_ENTERED",

    requestBody: { values: [[...SHEET_HEADER]] }

  });

}



/**
 * Crea una hoja nueva en el libro global (una por evento, nombre = evento).
 * Si ya existe el mismo título, agrega sufijo (2), (3), etc.
 */
export async function createEventGoogleSheet(eventName: string): Promise<string | null> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheetsClient();
  if (!spreadsheetId || !sheets) return null;

  const existing = await listSheetTitles(sheets, spreadsheetId);
  const baseName = formatEventSheetName(eventName);
  let candidate = baseName;
  let n = 2;
  while (existing.has(candidate)) {
    const suffix = ` (${n})`;
    const maxBase = SHEET_TITLE_MAX - suffix.length;
    candidate = sanitizeSheetTitle(`${baseName.slice(0, maxBase)}${suffix}`);
    n += 1;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: candidate }
          }
        }
      ]
    }
  });

  await writeSheetHeader(sheets, spreadsheetId, candidate);
  logger.info({ spreadsheetId, sheetName: candidate }, "Hoja de evento creada en Google Sheets");
  return candidate;
}

/** @deprecated Usar createEventGoogleSheet */
export async function createVecinoEventSheet(_startAt: Date, eventName: string): Promise<string | null> {
  return createEventGoogleSheet(eventName);
}



/** Asegura hoja del evento (crea si falta o si el nombre guardado no existe en el libro). */
export async function ensureEventGoogleSheet(
  event: Pick<Event, "id" | "name" | "googleSheetName">
): Promise<string | null> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheetsClient();
  if (!spreadsheetId || !sheets) return null;

  const storedName = event.googleSheetName?.trim();
  if (storedName && !isUnprovisionedSheetName(storedName)) {
    const exists = await sheetExists(sheets, spreadsheetId, storedName);
    if (exists) return storedName;
    logger.warn(
      { eventId: event.id, sheetName: storedName, spreadsheetId },
      "Hoja guardada no existe en el spreadsheet; se creará una nueva"
    );
  }

  const sheetName = await createEventGoogleSheet(event.name);
  if (!sheetName) return null;

  const { prisma } = await import("../../lib/prisma");
  await prisma.event.update({
    where: { id: event.id },
    data: { googleSheetName: sheetName }
  });
  return sheetName;
}

/** @deprecated Usar ensureEventGoogleSheet */
export async function ensureVecinoEventSheet(
  event: Pick<Event, "id" | "startAt" | "name" | "googleSheetName">
): Promise<string | null> {
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

/** @deprecated Usar buildEventSheetRow */
export function buildVecinoSheetRow(eventPerson: AccreditedRow): string[] {
  return buildEventSheetRow(eventPerson);
}



export async function appendVecinoAccreditationToSheet(

  eventId: string,

  sheetName: string,

  eventPerson: AccreditedRow

): Promise<void> {

  const spreadsheetId = getSpreadsheetId();

  const sheets = getSheetsClient();

  if (!spreadsheetId || !sheets) {

    const msg = "Google Sheets no configurado (GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SPREADSHEET_ID)";

    recordVecinoSheetError(eventId, msg);

    logger.warn({ eventId }, msg);

    return;

  }



  const escaped = escapeSheetNameForRange(sheetName);

  const range = `'${escaped}'!A:J`;



  try {

    const exists = await sheetExists(sheets, spreadsheetId, sheetName);

    if (!exists) {

      throw new Error(`La hoja "${sheetName}" no existe en el spreadsheet ${spreadsheetId}`);

    }



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


