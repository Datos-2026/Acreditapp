import { normalizeCuil, normalizeDni } from "@gcba/shared";
import type { VecinoDirectoryPersonDto } from "@gcba/shared";
import * as XLSX from "xlsx";

export type VecinoDirectoryImportRow = {
  dni: string;
  firstName: string;
  lastName: string;
  address: string | null;
  comuna: string | null;
  phone: string | null;
  email: string | null;
  participationCount: number | null;
  claimCount: number | null;
  codV: string | null;
};

function normalizeHeaderKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cellString(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function cellInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : null;
}

type FieldKey = keyof Omit<VecinoDirectoryImportRow, "dni"> | "dni";

const HEADER_TO_FIELD: Record<string, FieldKey> = {
  NOMBRE: "firstName",
  APELLIDO: "lastName",
  DNI: "dni",
  DOMICILIO: "address",
  DIRECCION: "address",
  COMUNA: "comuna",
  TELEFONO: "phone",
  TELEFONO_: "phone",
  CORREO: "email",
  EMAIL: "email",
  Q_PARTICIPACIONES: "participationCount",
  Q_RECLAMOS: "claimCount",
  COD_V: "codV",
  COD_V_: "codV"
};

function resolveField(header: string): FieldKey | null {
  const key = normalizeHeaderKey(header);
  if (HEADER_TO_FIELD[key]) return HEADER_TO_FIELD[key];
  if (key.includes("PARTICIPAC")) return "participationCount";
  if (key.includes("RECLAM")) return "claimCount";
  if (key.startsWith("COD") && key.includes("V")) return "codV";
  if (key.includes("DOMICILIO") || key.includes("DIRECCION")) return "address";
  if (key.includes("TELEFONO") || key.includes("CELULAR")) return "phone";
  if (key.includes("CORREO") || key.includes("MAIL")) return "email";
  if (key.includes("COMUNA")) return "comuna";
  if (key === "NOMBRE" || key.startsWith("NOMBRE")) return "firstName";
  if (key === "APELLIDO" || key.startsWith("APELLIDO")) return "lastName";
  if (key.includes("DNI") || key.includes("DOCUMENTO")) return "dni";
  return null;
}

export function toVecinoDirectoryPersonDto(row: VecinoDirectoryImportRow): VecinoDirectoryPersonDto {
  return {
    dni: row.dni,
    firstName: row.firstName,
    lastName: row.lastName,
    address: row.address,
    comuna: row.comuna,
    phone: row.phone,
    email: row.email,
    participationCount: row.participationCount,
    claimCount: row.claimCount,
    codV: row.codV
  };
}

export function parseVecinoDirectoryWorkbook(buffer: Buffer): VecinoDirectoryImportRow[] {
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene hojas.");
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (jsonRows.length === 0) return [];

  const headers = Object.keys(jsonRows[0] ?? {});
  const headerFields = new Map<string, FieldKey>();
  for (const h of headers) {
    const field = resolveField(h);
    if (field) headerFields.set(h, field);
  }

  if (![...headerFields.values()].includes("dni")) {
    throw new Error("Falta columna DNI en el archivo.");
  }
  if (![...headerFields.values()].includes("firstName") || ![...headerFields.values()].includes("lastName")) {
    throw new Error("Faltan columnas NOMBRE y/o APELLIDO en el archivo.");
  }

  const rows: VecinoDirectoryImportRow[] = [];
  const seenDnis = new Set<string>();

  for (const raw of jsonRows) {
    const partial: Partial<VecinoDirectoryImportRow> = {};
    for (const [header, field] of headerFields) {
      const value = raw[header];
      if (field === "participationCount" || field === "claimCount") {
        partial[field] = cellInt(value);
      } else if (field === "dni") {
        const d = normalizeDni(String(value ?? ""));
        if (d) partial.dni = d;
      } else {
        partial[field] = cellString(value) as never;
      }
    }

    const dni = partial.dni;
    if (!dni || !partial.firstName?.trim() || !partial.lastName?.trim()) continue;
    if (seenDnis.has(dni)) continue;
    seenDnis.add(dni);

    rows.push({
      dni,
      firstName: partial.firstName.trim(),
      lastName: partial.lastName.trim(),
      address: partial.address ?? null,
      comuna: partial.comuna ?? null,
      phone: partial.phone ?? null,
      email: partial.email ?? null,
      participationCount: partial.participationCount ?? null,
      claimCount: partial.claimCount ?? null,
      codV: partial.codV ?? null
    });
  }

  return rows;
}

export const VECINO_DIRECTORY_CREATE_CHUNK = 500;
