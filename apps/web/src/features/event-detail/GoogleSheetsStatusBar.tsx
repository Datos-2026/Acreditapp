import { useQuery } from "@tanstack/react-query";

import type { GoogleSheetsStatsDto } from "@gcba/shared";

import { api } from "../../lib/api";

import { Icon } from "../../components/Icon";

type Props = {
  eventId: string;
  compact?: boolean;
};

export function GoogleSheetsStatusBar({ eventId, compact = false }: Props) {
  const statsQuery = useQuery({
    queryKey: ["sheets", eventId],
    queryFn: async () => (await api.get<GoogleSheetsStatsDto>(`/events/${eventId}/sheets/stats`)).data,
    refetchInterval: 15_000
  });

  const stats = statsQuery.data;
  const sheetError = stats?.lastSheetError ?? null;

  if (!stats?.googleSheetsEnabled && !sheetError && !stats?.googleSheetName) {
    if (!stats?.sheetsConfigured) {
      return compact ? null : (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
          Google Sheets no está configurado en el servidor.
        </p>
      );
    }
    return null;
  }

  if (compact) {
    return (
      <div className="mesa-panel-compact__sheet" style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)" }}>
        <Icon name="table_chart" style={{ fontSize: "0.95rem", verticalAlign: "middle", marginRight: 4 }} />
        {stats?.googleSheetName ? <>Hoja: {stats.googleSheetName}</> : "Sheets activo"}
        {sheetError ? <span className="message-error" style={{ display: "block", marginTop: 4 }}>{sheetError}</span> : null}
      </div>
    );
  }

  return (
    <article className="card" style={{ marginBottom: "1rem" }}>
      <h3 className="display-sm" style={{ fontSize: "1.1rem", margin: "0 0 0.35rem", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="table_chart" />
        Google Sheets
      </h3>
      <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.875rem" }}>
        Cada acreditación se vuelca en tiempo real a una hoja con el nombre del evento.
      </p>
      {stats?.googleSheetName ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
          Hoja: <strong>{stats.googleSheetName}</strong>
        </p>
      ) : null}
      {sheetError ? <p className="message-error" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>{sheetError}</p> : null}
    </article>
  );
}
