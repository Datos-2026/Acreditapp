import { normalizeCuil } from "@gcba/shared";

function parseAyn(value: string): { nombre?: string; apellido?: string } {
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

export function normalizeImportCanonical(canonical: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...canonical };

  const ayn = String(normalized.nombreCompleto ?? "").trim();
  if ((!normalized.nombre || !normalized.apellido) && ayn) {
    const parsed = parseAyn(ayn);
    if (!normalized.nombre && parsed.nombre) normalized.nombre = parsed.nombre;
    if (!normalized.apellido && parsed.apellido) normalized.apellido = parsed.apellido;
  }

  if (normalized.cuit && !normalized.cuil) {
    normalized.cuil = normalized.cuit;
  }

  return normalized;
}

export function validateImportRow(canonical: Record<string, unknown>): string[] {
  const normalized = normalizeImportCanonical(canonical);
  const cuil = normalizeCuil(String(normalized.cuil ?? ""));
  const errors: string[] = [];
  if (!cuil || cuil.length !== 11) errors.push("CUIL inválido");
  if (!String(normalized.nombre ?? "").trim()) errors.push("Nombre requerido");
  if (!String(normalized.apellido ?? "").trim()) errors.push("Apellido requerido");
  return errors;
}
