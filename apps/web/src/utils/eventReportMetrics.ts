/** Utilidades de formato para informes (sin lógica de negocio duplicada del backend). */

export function formatPercentage(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

export function formatReportDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}
