import { normalizeCuil, normalizeDni, syntheticCuilFromDni, type AccreditationDisplayColumn } from "@gcba/shared";

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
      dni: normalizeDni(String(normalized.dni ?? ""))
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

/** Mergea extraData de un reimport: no pisa mesa ni claves existentes vacías. */
export function mergeImportExtraData(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const prev = existing && typeof existing === "object" ? { ...existing } : {};
  const next = { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    next[key] = value;
  }
  if (prev.mesa != null && incoming.mesa == null) {
    next.mesa = prev.mesa;
  }
  return next;
}

/** @deprecated usar buildImportExtraData */
export function buildVecinoExtraData(
  canonical: Record<string, unknown>,
  extraData: Record<string, unknown>
): Record<string, unknown> {
  return buildImportExtraData(canonical, extraData, ["presente", "direccion"]);
}

export type { AccreditationDisplayColumn };

const ACCREDITATION_COLUMN_FIELDS = new Set([
  "email",
  "telefono",
  "empresa",
  "cargo",
  "notes",
  "presente",
  "direccion",
  "comuna",
  "mesa",
  "dni",
  "cuil",
  "cuit",
  "nombre",
  "apellido",
  "nombreCompleto",
  "nombreApellido"
]);

/** Campos que la ficha de acreditación ya muestra siempre. */
const DISPLAYED_CANONICAL_FIELDS: Record<"gcba" | "vecinos", Set<string>> = {
  gcba: new Set(["nombre", "apellido", "nombreCompleto", "nombreApellido", "cuil", "cuit", "dni", "empresa", "cargo"]),
  vecinos: new Set([
    "nombre",
    "apellido",
    "nombreCompleto",
    "nombreApellido",
    "cuil",
    "cuit",
    "dni",
    "direccion",
    "telefono",
    "presente",
    "mesa"
  ])
};

function headerAlreadyOnAccreditationCard(kind: "gcba" | "vecinos", header: string, field: string | null): boolean {
  if (field && DISPLAYED_CANONICAL_FIELDS[kind].has(field)) return true;
  const normalized = normalizeImportSheetHeader(header);
  if (!normalized) return true;
  if (
    normalized === "nombre" ||
    normalized === "nombres" ||
    normalized === "apellido" ||
    normalized === "apellidos" ||
    normalized === "ayn" ||
    normalized.includes("nombre y apellido") ||
    normalized.includes("apellido y nombre") ||
    normalized.startsWith("nombre/") ||
    normalized.startsWith("apellido/")
  ) {
    return true;
  }
  if (normalized.includes("dni") || normalized.includes("documento") || normalized.includes("cuil") || normalized.includes("cuit")) {
    return true;
  }
  if (normalized === "origen") return true;
  if (kind === "vecinos") {
    if (normalized === "direccion" || normalized === "domicilio") return true;
    if (
      normalized === "telefono" ||
      normalized === "celular" ||
      normalized === "tel" ||
      normalized === "numero de telefono"
    ) {
      return true;
    }
    if (normalized === "comuna" || normalized.startsWith("comuna ")) return true;
    if (normalized === "mesa" || normalized.startsWith("mesa ")) return true;
    if (normalized === "presente" || normalized === "asistio") return true;
  }
  if (kind === "gcba") {
    if (normalized.includes("ministerio")) return true;
    if (normalized === "rol" || normalized.startsWith("rol ") || normalized === "cargo") return true;
  }
  return false;
}

function cellHasValue(value: unknown): boolean {
  return value != null && String(value).trim() !== "";
}

/** Columnas de la planilla que todavía no se ven en la ficha y tienen algún dato. */
export function listAccreditationColumnChoices(params: {
  kind: "gcba" | "vecinos";
  headers: string[];
  mapping: Record<string, string>;
  rows: Array<{ canonical: Record<string, unknown>; extraData?: Record<string, unknown> }>;
}): AccreditationDisplayColumn[] {
  const choices: AccreditationDisplayColumn[] = [];
  const seen = new Set<string>();
  for (const header of params.headers) {
    if (isImportNoiseColumn(header)) continue;
    const field = params.mapping[header] ?? null;
    if (headerAlreadyOnAccreditationCard(params.kind, header, field)) continue;
    const hasValue = params.rows.some((row) => {
      if (field && cellHasValue(row.canonical[field])) return true;
      return cellHasValue(row.extraData?.[header]);
    });
    if (!hasValue) continue;
    const key = normalizeImportSheetHeader(header);
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ header, field });
  }
  return choices;
}

/** null = payload inválido. [] = el usuario no quiere columnas extra. */
export function parseAccreditationColumnsPayload(raw: unknown): AccreditationDisplayColumn[] | null {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  if (value.length > 12) return null;
  const out: AccreditationDisplayColumn[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const header = String((item as { header?: unknown }).header ?? "").trim();
    if (!header || header.length > 160 || isImportNoiseColumn(header)) return null;
    const fieldRaw = (item as { field?: unknown }).field;
    const field = fieldRaw == null || String(fieldRaw).trim() === "" ? null : String(fieldRaw).trim();
    if (field && !ACCREDITATION_COLUMN_FIELDS.has(field)) return null;
    const key = normalizeImportSheetHeader(header);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ header, field });
  }
  return out;
}

export function extractReferenteRaw(extraData: Record<string, unknown>): unknown {
  for (const [header, value] of Object.entries(extraData)) {
    const normalized = normalizeImportSheetHeader(header);
    if (
      normalized === "referente" ||
      normalized.startsWith("referente") ||
      normalized === "titular del grupo" ||
      normalized === "titular" ||
      normalized.startsWith("titular del grupo") ||
      normalized === "titular grupo"
    ) {
      return value;
    }
  }
  return null;
}
