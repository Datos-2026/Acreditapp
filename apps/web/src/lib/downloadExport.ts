import { api } from "./api";

/** `all` = todos los acreditados; `manual` = fuera de base; `imported` = solo inscriptos desde base importada. */
export type AccreditedExportScope = "all" | "manual" | "imported";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function filenameForScope(scope: AccreditedExportScope): string {
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
  const blob = new Blob([res.data as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameForScope(scope);
  a.click();
  URL.revokeObjectURL(url);
}

/** @deprecated Usar downloadAccreditedXlsx */
export const downloadAccreditedCsv = downloadAccreditedXlsx;
