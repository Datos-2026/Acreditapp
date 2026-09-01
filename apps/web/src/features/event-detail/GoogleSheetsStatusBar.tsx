import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { GoogleSheetsStatsDto } from "@gcba/shared";

import { api } from "../../lib/api";
import { downloadAcreditadosMysqlXlsx } from "../../lib/downloadExport";

import { Icon } from "../../components/Icon";

type Props = {
  eventId: string;
  compact?: boolean;
};

export function GoogleSheetsStatusBar({ eventId, compact = false }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const statsQuery = useQuery({
    queryKey: ["sheets", eventId],
    queryFn: async () => (await api.get<GoogleSheetsStatsDto>(`/events/${eventId}/sheets/stats`)).data,
    refetchInterval: 15_000
  });

  const stats = statsQuery.data;
  const sheetError = stats?.lastSheetError ?? null;

  const downloadBase = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadAcreditadosMysqlXlsx(eventId);
    } catch {
      setDownloadError("No se pudo descargar la base de ACREDITADOS.");
    } finally {
      setDownloading(false);
    }
  };

  if (!stats?.googleSheetsEnabled && !sheetError && !stats?.googleSheetName) {
    if (!stats?.sheetsConfigured) {
      return compact ? null : (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
          MySQL ACREDITADOS no está configurado en el servidor.
        </p>
      );
    }
    return null;
  }

  if (compact) {
    return (
      <div className="mesa-panel-compact__sheet" style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)" }}>
        <Icon name="download" style={{ fontSize: "0.95rem", verticalAlign: "middle", marginRight: 4 }} />
        <button
          type="button"
          className="btn-link"
          style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", textDecoration: "underline" }}
          onClick={() => void downloadBase()}
          disabled={downloading}
        >
          {downloading ? "Descargando…" : "DESCARGAR BASE DE ACREDITADOS"}
        </button>
        {sheetError ? <span className="message-error" style={{ display: "block", marginTop: 4 }}>{sheetError}</span> : null}
        {downloadError ? <span className="message-error" style={{ display: "block", marginTop: 4 }}>{downloadError}</span> : null}
      </div>
    );
  }

  return (
    <article className="card" style={{ marginBottom: "1rem" }}>
      <h3 className="display-sm" style={{ fontSize: "1.1rem", margin: "0 0 0.35rem", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="table_chart" />
        Base ACREDITADOS
      </h3>
      <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.875rem" }}>
        Cada acreditación se vuelca en tiempo real a la tabla de este evento en phpMyAdmin (base ACREDITADOS).
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: "0.75rem" }}
        onClick={() => void downloadBase()}
        disabled={downloading}
      >
        <Icon name="download" />
        {downloading ? "Descargando…" : "DESCARGAR BASE DE ACREDITADOS"}
      </button>
      {sheetError ? <p className="message-error" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>{sheetError}</p> : null}
      {downloadError ? <p className="message-error" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>{downloadError}</p> : null}
    </article>
  );
}
