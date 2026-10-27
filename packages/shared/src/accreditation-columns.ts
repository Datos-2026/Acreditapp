import type { AccreditationDisplayColumn } from "./types";

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Campos estándar de la ficha según tipo de evento. */
export function defaultAccreditationColumns(kind: "gcba" | "vecinos"): AccreditationDisplayColumn[] {
  if (kind === "vecinos") {
    return [
      { header: "DNI", field: "dni" },
      { header: "Dirección", field: "direccion" },
      { header: "Comuna", field: "comuna" },
      { header: "Teléfono", field: "telefono" },
      { header: "Mesa", field: "mesa" },
      { header: "Presente", field: "presente" },
      { header: "Origen", field: "origen" }
    ];
  }
  return [
    { header: "CUIL", field: "cuil" },
    { header: "DNI", field: "dni" },
    { header: "Ministerio", field: "empresa" },
    { header: "Rol", field: "cargo" },
    { header: "Origen", field: "origen" }
  ];
}

function matchesDefault(
  column: AccreditationDisplayColumn,
  defaults: AccreditationDisplayColumn[]
): boolean {
  const headerKey = normalizeHeader(column.header);
  return defaults.some(
    (item) =>
      (column.field != null && item.field === column.field) ||
      normalizeHeader(item.header) === headerKey
  );
}

/**
 * Qué se muestra en la ficha.
 * - Sin config: campos estándar.
 * - Config vieja (solo extras): estándar + extras.
 * - Config nueva (incluye algún campo estándar): exactamente lo elegido.
 */
export function resolveAccreditationDisplayColumns(
  kind: "gcba" | "vecinos",
  saved: AccreditationDisplayColumn[] | null | undefined
): AccreditationDisplayColumn[] {
  const defaults = defaultAccreditationColumns(kind);
  if (!saved || saved.length === 0) return defaults;
  const touchesDefault = saved.some((column) => matchesDefault(column, defaults));
  if (!touchesDefault) return [...defaults, ...saved];
  return saved;
}
