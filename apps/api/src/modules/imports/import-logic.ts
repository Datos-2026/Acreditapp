import { normalizeCuil, normalizeDni, syntheticCuilFromDni } from "@gcba/shared";

/** Normaliza encabezados de planilla para autodetección (barras Unicode, espacios, tildes). */
export function normalizeImportSheetHeader(header: string): string {
  return header
    .replace(/^\uFEFF/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'¿?«»]/g, "")
    .replace(/[／∕⁄﹨⧸]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** Columnas fantasma de Excel (celdas vacías, __EMPTY, etc.) que no deben mostrarse ni persistirse. */
export function isImportNoiseColumn(header: string): boolean {
  const normalized = normalizeImportSheetHeader(header);
  if (!normalized) return true;
  if (normalized === "marca temporal") return true;
  if (/^__empty(_\d+)?$/.test(normalized)) return true;
  if (/^column\s*\d+$/i.test(normalized)) return true;
  if (/^rol\s*\d+$/i.test(normalized)) return true;
  return false;
}

/**
 * Une valores al objeto canónico por fila: no pisa nombre/apellido/CUIL con celdas vacías;
 * concatena varias columnas en `empresa`.
 */
export function applyImportMappedValue(canonical: Record<string, unknown>, target: string, raw: unknown): void {
  const s = raw == null ? "" : String(raw).trim();
  const noEmptyOverwrite = new Set([
    "nombre",
    "apellido",
    "cuil",
    "cuit",
    "email",
    "telefono",
    "cargo",
    "nombreCompleto",
    "nombreApellido",
    "notes",
    "dni",
    "direccion",
    "mesa",
    "presente"
  ]);
  if (noEmptyOverwrite.has(target) && !s) {
    return;
  }
  if (target === "empresa") {
    if (!s) return;
    const prev = canonical.empresa;
    if (prev == null || String(prev).trim() === "") {
      canonical.empresa = s;
    } else if (!String(prev).includes(s)) {
      canonical.empresa = `${String(prev).trim()} · ${s}`;
    }
    return;
  }
  if (!s) return;
  canonical[target] = s;
}

/**
 * Parsea un nombre completo en formato "Apellido(s) Nombre(s)" (típico del header
 * "Apellido y Nombre" / "AYN"). Si hay coma, siempre apellido va antes.
 */
export function parseAyn(value: string): { nombre?: string; apellido?: string } {
  const clean = value.trim();
  if (!clean) return {};

  if (clean.includes(",")) {
    const [lastNameRaw, firstNameRaw] = clean.split(",", 2);
    return {
      apellido: lastNameRaw.trim() || undefined,
      nombre: firstNameRaw.trim() || undefined
    };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { nombre: parts[0] };
  return {
    apellido: parts[0],
    nombre: parts.slice(1).join(" ")
  };
}

/**
 * Parsea un nombre completo en formato "Nombre(s) Apellido" (header "Nombre y
 * Apellido"): el último token se toma como apellido y el resto como nombres.
 * Si hay coma, asume formato canónico "Apellido, Nombre".
 */
export function parseNombreApellido(value: string): { nombre?: string; apellido?: string } {
  const clean = value.trim();
  if (!clean) return {};

  if (clean.includes(",")) {
    const [lastNameRaw, firstNameRaw] = clean.split(",", 2);
    return {
      apellido: lastNameRaw.trim() || undefined,
      nombre: firstNameRaw.trim() || undefined
    };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { nombre: parts[0] };
  return {
    nombre: parts.slice(0, -1).join(" "),
    apellido: parts[parts.length - 1]
  };
}

export function normalizeImportCanonical(canonical: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...canonical };

  const nombre = String(normalized.nombre ?? "").trim();
  const apellido = String(normalized.apellido ?? "").trim();
  const ayn = String(normalized.nombreCompleto ?? "").trim();
  const nyc = String(normalized.nombreApellido ?? "").trim();
  if (!ayn && (nombre || apellido)) {
    normalized.nombreCompleto = [apellido, nombre].filter(Boolean).join(", ");
  }

  if ((!normalized.nombre || !normalized.apellido) && ayn) {
    const parsed = parseAyn(ayn);
    if (!normalized.nombre && parsed.nombre) normalized.nombre = parsed.nombre;
    if (!normalized.apellido && parsed.apellido) normalized.apellido = parsed.apellido;
  }

  if ((!normalized.nombre || !normalized.apellido) && nyc) {
    const parsed = parseNombreApellido(nyc);
    if (!normalized.nombre && parsed.nombre) normalized.nombre = parsed.nombre;
    if (!normalized.apellido && parsed.apellido) normalized.apellido = parsed.apellido;
  }

  if (normalized.cuit && !normalized.cuil) {
    normalized.cuil = normalized.cuit;
  }
  if (normalized.cuil && !normalized.cuit) {
    normalized.cuit = normalized.cuil;
  }

  const idDigits = String(normalized.cuil ?? normalized.cuit ?? "").replace(/\D/g, "");
  if (idDigits) {
    normalized.cuil = idDigits;
    normalized.cuit = idDigits;
  }

  if (normalized.email != null && normalized.email !== "") {
    normalized.email = String(normalized.email).trim();
  }
  if (normalized.telefono != null && normalized.telefono !== "") {
    normalized.telefono = String(normalized.telefono).trim();
  }
  if (normalized.notes != null && normalized.notes !== "") {
    normalized.notes = String(normalized.notes).trim();
  }

  return normalized;
}

export function validateImportRow(canonical: Record<string, unknown>): string[] {
  const normalized = normalizeImportCanonical(canonical);
  const cuil = normalizeCuil(String(normalized.cuil ?? ""));
  const errors: string[] = [];
  if (!cuil || cuil.length !== 11) errors.push("CUIL inválido o faltante");
  return errors;
}

export function normalizeVecinoImportCanonical(canonical: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeImportCanonical(canonical);
  const dni = normalizeDni(String(normalized.dni ?? ""));
  if (dni) {
    normalized.dni = dni;
    normalized.cuil = syntheticCuilFromDni(dni);
  }
  if (normalized.direccion != null && normalized.direccion !== "") {
    normalized.direccion = String(normalized.direccion).trim();
  }
  if (normalized.mesa != null && normalized.mesa !== "") {
    normalized.mesa = String(normalized.mesa).trim();
  }
  if (normalized.presente != null && normalized.presente !== "") {
    normalized.presente = String(normalized.presente).trim();
  }
  return normalized;
}

export function validateVecinoImportRow(canonical: Record<string, unknown>): string[] {
  const normalized = normalizeVecinoImportCanonical(canonical);
  const errors: string[] = [];
  const dni = normalizeDni(String(normalized.dni ?? ""));
  if (!dni) errors.push("DNI inválido o faltante");
  if (!String(normalized.nombre ?? "").trim()) errors.push("Nombre faltante");
  if (!String(normalized.apellido ?? "").trim()) errors.push("Apellido faltante");
  return errors;
}

/** Campos extra del evento vecinos que van a EventPerson.extraData. */
export function buildVecinoExtraData(
  canonical: Record<string, unknown>,
  extraData: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extraData };
  for (const key of ["mesa", "presente", "direccion"] as const) {
    const v = canonical[key];
    if (v != null && String(v).trim() !== "") out[key] = String(v).trim();
  }
  return out;
}
