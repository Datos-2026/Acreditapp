import { api } from "./api";

/** `all` = todos los acreditados; `manual` = fuera de base; `imported` = solo inscriptos desde base importada. */
export type AccreditedExportScope = "all" | "manual" | "imported";

export async function downloadAccreditedCsv(eventId: string, scope: AccreditedExportScope): Promise<void> {
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
  const blob = new Blob([res.data as BlobPart], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    scope === "manual"
      ? "acreditados-fuera-de-base.csv"
      : scope === "imported"
        ? "acreditados-desde-base.csv"
        : "acreditados-todos.csv";
  a.click();
  URL.revokeObjectURL(url);
}
