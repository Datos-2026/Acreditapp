import { api } from "./api";

/** `all` = todos los acreditados; `manual` = fuera de base; `imported` = solo inscriptos desde base importada. */
export type AccreditedExportScope = "all" | "manual" | "imported";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Lee el nombre del archivo del header `Content-Disposition` enviado por el backend. */
function filenameFromHeaders(headers: unknown, fallback: string): string {
  if (!headers || typeof headers !== "object") return fallback;
  const h = headers as Record<string, unknown>;
  const raw = h["content-disposition"] ?? h["Content-Disposition"];
  if (typeof raw !== "string") return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(raw);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function triggerBlobDownload(data: BlobPart, filename: string): void {
  const blob = new Blob([data], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fallbackAccreditedFilename(scope: AccreditedExportScope): string {
  if (scope === "manual") return "acreditados-fuera-de-base.xlsx";
  if (scope === "imported") return "acreditados-desde-base.xlsx";
  return "acreditados-todos.xlsx";
}

export async function downloadAccreditedXlsx(eventId: string, scope: AccreditedExportScope): Promise<void> {
  const params =
    scope === "manual"
      ? { manualOnly: true }
      : scope === "imported"
        ? { importedOnly: true }
        : {};
  const res = await api.get(`/events/${eventId}/export/accredited`, {
    responseType: "blob",
    params
  });
  triggerBlobDownload(res.data as BlobPart, filenameFromHeaders(res.headers, fallbackAccreditedFilename(scope)));
}

/** Nómina importada del evento (mismas columnas que acreditados). */
export async function downloadPeopleBaseXlsx(
  eventId: string,
  options?: { importedOnly?: boolean }
): Promise<void> {
  const importedOnly = options?.importedOnly ?? true;
  const res = await api.get(`/events/${eventId}/export/people`, {
    responseType: "blob",
    params: { importedOnly }
  });
  const fallback = importedOnly ? "base-evento-importada.xlsx" : "nomina-evento-completa.xlsx";
  triggerBlobDownload(res.data as BlobPart, filenameFromHeaders(res.headers, fallback));
}

/** XLSX con hojas ACREDITADOS y FUERA DE BASE (dotación + columnas operativas). */
export async function downloadEventTwoSheetsXlsx(eventId: string): Promise<void> {
  const res = await api.get(`/events/${eventId}/export/two-sheets`, {
    responseType: "blob"
  });
  triggerBlobDownload(
    res.data as BlobPart,
    filenameFromHeaders(res.headers, "acreditacion-2-hojas.xlsx")
  );
}

/** Dimensión por la que se agrupan las personas en el panel de descargas. */
export type GroupedExportDimension = "ministerio" | "rol";
/** `accredited` = solo acreditados; `all` = todas las personas del evento. */
export type GroupedExportScope = "accredited" | "all";

/** XLSX con una hoja por grupo (ministerio o ROL) + hoja Resumen. */
export async function downloadGroupedXlsx(
  eventId: string,
  by: GroupedExportDimension,
  scope: GroupedExportScope = "accredited"
): Promise<void> {
  const res = await api.get(`/events/${eventId}/export/grouped`, {
    responseType: "blob",
    params: { by, scope }
  });
  const scopeLabel = scope === "all" ? "personas" : "acreditados";
  triggerBlobDownload(
    res.data as BlobPart,
    filenameFromHeaders(res.headers, `${scopeLabel}-por-${by}.xlsx`)
  );
}

/** @deprecated Usar downloadAccreditedXlsx */
export const downloadAccreditedCsv = downloadAccreditedXlsx;
