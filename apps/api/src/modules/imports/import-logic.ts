import { normalizeCuil, normalizeDni, syntheticCuilFromDni, dniFromCuil } from "@gcba/shared";

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

  const dni = normalizeDni(String(normalized.dni ?? ""));
  const cuilDigits = normalizeCuil(String(normalized.cuil ?? ""));
  if (cuilDigits.length === 11 && !dni) {
    const fromCuil = dniFromCuil(cuilDigits);
    if (fromCuil) normalized.dni = fromCuil;
  }
  if (dni) {
    normalized.dni = dni;
    if (!cuilDigits || cuilDigits.length !== 11) {
      normalized.cuil = syntheticCuilFromDni(dni);
      normalized.cuit = normalized.cuil;
    }
  }

  if (normalized.presente != null && normalized.presente !== "") {
    normalized.presente = String(normalized.presente).trim();
  }

  return normalized;
}

/** Resuelve identidad de fila: CUIL de 11 dígitos y/o DNI (6–8 dígitos). */
export function resolveImportIdentity(canonical: Record<string, unknown>): {
  cuil: string;
  dni: string | null;
} | null {
  const normalized = normalizeImportCanonical(canonical);
  const cuilDigits = normalizeCuil(String(normalized.cuil ?? ""));
  if (cuilDigits.length === 11) {
    return {
      cuil: cuilDigits,
      dni: normalizeDni(String(normalized.dni ?? "")) ?? dniFromCuil(cuilDigits)
    };
  }
  const dni = normalizeDni(String(normalized.dni ?? ""));
  if (dni) {
    return { cuil: syntheticCuilFromDni(dni), dni };
  }
  return null;
}

/** Clave de identificación para deduplicar filas en importación (CUIL o DNI). */
export function importRowIdKey(canonical: Record<string, unknown>): string {
  const identity = resolveImportIdentity(canonical);
  if (!identity) return "";
  return identity.cuil.length === 11 ? identity.cuil : identity.dni ?? "";
}

export function validateImportRow(canonical: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!resolveImportIdentity(canonical)) errors.push("CUIL o DNI inválido o faltante");
  return errors;
}

/**
 * Autodetección de columnas comunes a GCBA y Vecinos (organizaciones, DNI, asistencia, etc.).
 * Devuelve null si no aplica; el caller puede seguir con reglas específicas del tipo de evento.
 */
export function detectUniversalImportColumn(normalized: string): string | null {
  if (normalized.includes("dni") || normalized.includes("documento") || normalized.includes("num doc")) {
    return "dni";
  }
  if (normalized.includes("cuit") || normalized.includes("cuil")) {
    return "cuil";
  }
  if (
    normalized.includes("nombre de la organizacion") ||
    normalized.includes("nombre organizacion") ||
    normalized.includes("nombre de organizacion")
  ) {
    return "empresa";
  }
  if (
    normalized.includes("tipo de la organizacion") ||
    normalized.includes("tipo organizacion") ||
    normalized.includes("tipo de organizacion")
  ) {
    return "cargo";
  }
  if (normalized.includes("nombre y apellido")) {
    return "nombreApellido";
  }
  if (normalized === "ayn" || normalized.includes("apellido y nombre")) {
    return "nombreCompleto";
  }
  if (normalized.includes("asistio") || normalized === "presente") {
    return "presente";
  }
  return null;
}

export function normalizeVecinoImportCanonical(canonical: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeImportCanonical(canonical);
  const identity = resolveImportIdentity(normalized);
  if (identity) {
    normalized.cuil = identity.cuil;
    if (identity.dni) normalized.dni = identity.dni;
  }
  if (normalized.direccion != null && normalized.direccion !== "") {
    normalized.direccion = String(normalized.direccion).trim();
  }
  if (normalized.presente != null && normalized.presente !== "") {
    normalized.presente = String(normalized.presente).trim();
  }
  return normalized;
}

export function validateVecinoImportRow(canonical: Record<string, unknown>): string[] {
  const normalized = normalizeVecinoImportCanonical(canonical);
  const errors: string[] = [];
  if (!resolveImportIdentity(normalized)) errors.push("CUIL o DNI inválido o faltante");
  if (!String(normalized.nombre ?? "").trim()) errors.push("Nombre faltante");
  if (!String(normalized.apellido ?? "").trim()) errors.push("Apellido faltante");
  return errors;
}

/** Campos operativos de la fila que van a EventPerson.extraData. */
export function buildImportExtraData(
  canonical: Record<string, unknown>,
  extraData: Record<string, unknown>,
  keys: readonly string[] = ["mesa", "presente", "direccion"]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extraData };
  for (const key of keys) {
    const v = canonical[key];
    if (v != null && String(v).trim() !== "") out[key] = String(v).trim();
  }
  return out;
}

/** @deprecated usar buildImportExtraData */
export function buildVecinoExtraData(
  canonical: Record<string, unknown>,
  extraData: Record<string, unknown>
): Record<string, unknown> {
  return buildImportExtraData(canonical, extraData, ["presente", "direccion"]);
}
