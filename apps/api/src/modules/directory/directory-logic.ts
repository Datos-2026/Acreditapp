import { normalizeCuil } from "@gcba/shared";
import type { DirectoryPersonDto } from "@gcba/shared";
import * as XLSX from "xlsx";

const EXPECTED_HEADERS = [
  "MINISTERIO",
  "AYN",
  "NUM_DOC",
  "LIT_PUESTO",
  "DESC_REP",
  "MAIL_LABORAL",
  "MAIL_PERSONAL",
  "MAIL_MIA",
  "CUIL_SIN_GUIONES"
] as const;

export type DirectoryImportRow = {
  cuilNormalized: string;
  dni: string | null;
  firstName: string;
  lastName: string;
  ministerio: string | null;
  litPuesto: string | null;
  descRep: string | null;
  emailLaboral: string | null;
  emailPersonal: string | null;
  emailMia: string | null;
};

function normalizeHeaderKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function cellString(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function parseAyn(ayn: string): { firstName: string; lastName: string } {
  const trimmed = ayn.trim();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx < 0) {
    return { lastName: trimmed, firstName: "" };
  }
  return {
    lastName: trimmed.slice(0, commaIdx).trim(),
    firstName: trimmed.slice(commaIdx + 1).trim()
  };
}

export function pickDirectoryEmail(row: {
  emailLaboral?: string | null;
  emailPersonal?: string | null;
  emailMia?: string | null;
}): string | null {
  return row.emailLaboral ?? row.emailPersonal ?? row.emailMia ?? null;
}

export function toDirectoryPersonDto(row: DirectoryImportRow): DirectoryPersonDto {
  return {
    cuilNormalized: row.cuilNormalized,
    dni: row.dni,
    firstName: row.firstName,
    lastName: row.lastName,
    ministerio: row.ministerio,
    litPuesto: row.litPuesto,
    descRep: row.descRep,
    email: pickDirectoryEmail(row)
  };
}

export function parseDirectoryWorkbook(buffer: Buffer): DirectoryImportRow[] {
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("El archivo no contiene hojas.");
  }
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (jsonRows.length === 0) return [];

  const headerMap = new Map<string, string>();
  Object.keys(jsonRows[0] ?? {}).forEach((header) => {
    headerMap.set(normalizeHeaderKey(header), header);
  });

  const missing = EXPECTED_HEADERS.filter((h) => !headerMap.has(h));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}`);
  }

  const rows: DirectoryImportRow[] = [];
  const seenCuils = new Set<string>();

  for (const raw of jsonRows) {
    const get = (key: (typeof EXPECTED_HEADERS)[number]) => raw[headerMap.get(key)!];
    const cuilNormalized = normalizeCuil(String(get("CUIL_SIN_GUIONES") ?? ""));
    if (cuilNormalized.length !== 11 || seenCuils.has(cuilNormalized)) continue;
    seenCuils.add(cuilNormalized);

    const ayn = cellString(get("AYN"));
    if (!ayn) continue;
    const { firstName, lastName } = parseAyn(ayn);
    if (!lastName) continue;

    const dniRaw = cellString(get("NUM_DOC"));
    const dni = dniRaw ? normalizeCuil(dniRaw) : null;

    rows.push({
      cuilNormalized,
      dni: dni && dni.length >= 6 && dni.length <= 8 ? dni : null,
      firstName,
      lastName,
      ministerio: cellString(get("MINISTERIO")),
      litPuesto: cellString(get("LIT_PUESTO")),
      descRep: cellString(get("DESC_REP")),
      emailLaboral: cellString(get("MAIL_LABORAL")),
      emailPersonal: cellString(get("MAIL_PERSONAL")),
      emailMia: cellString(get("MAIL_MIA"))
    });
  }

  return rows;
}

export const DIRECTORY_CREATE_CHUNK = 500;
