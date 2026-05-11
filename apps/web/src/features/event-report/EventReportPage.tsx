import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { EventReportAiAnalysis, EventReportPayload } from "@gcba/shared";
import { Icon } from "../../components/Icon";
import { api } from "../../lib/api";
import { formatPercentage, formatReportDate } from "../../utils/eventReportMetrics";
import "./event-report.css";

const DONUT_COLORS = ["#16a34a", "#f59e0b", "#2563eb", "#dc2626"];

const statusLabel: Record<string, string> = {
  ok: "Óptimo",
  warn: "Atención",
  bad: "Corregir"
};

const INFORME_PRINT_CLASS = "event-informe-print";

export function EventReportPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const eventsListHref = user?.role === "SUPERADMIN" ? "/admin/eventos" : "/eventos";
  const backFromInformeHref = user?.role === "INFORMADOR" ? eventsListHref : `/events/${id}?tab=metricas`;
  const canUseAiTools = user?.role !== "INFORMADOR";
  const queryClient = useQueryClient();

  useEffect(() => {
    document.documentElement.classList.add(INFORME_PRINT_CLASS);
    return () => document.documentElement.classList.remove(INFORME_PRINT_CLASS);
  }, []);

  const reportQuery = useQuery({
    queryKey: ["event-report", id],
    queryFn: async () => (await api.get<EventReportPayload>(`/events/${id}/report`)).data,
    enabled: Boolean(id)
  });

  const aiMutation = useMutation({
    mutationFn: async (regenerate: boolean) => {
      const { data } = await api.post<{
        ok: boolean;
        analysis?: EventReportAiAnalysis;
        error?: string;
        fromCache?: boolean;
      }>(`/events/${id}/report/ai`, { regenerate });
      return data;
    },
    onSuccess: (data) => {
      if (data.ok) void queryClient.invalidateQueries({ queryKey: ["event-report", id] });
    }
  });

  const handlePrint = () => {
    window.print();
  };

  if (reportQuery.isLoading) {
    return (
      <div className="event-report-screen">
        <div className="page-state">Cargando informe del evento…</div>
      </div>
    );
  }

  if (reportQuery.isError || !reportQuery.data) {
    return (
      <div className="event-report-screen">
        <p className="message-error">No se pudo cargar el informe o no tenés acceso a este evento.</p>
        <Link className="btn btn-secondary" to={id ? backFromInformeHref : eventsListHref}>
          Volver
        </Link>
      </div>
    );
  }

  const d = reportQuery.data;
  const aiPayload = aiMutation.data;
  const analysisFromServer = d.aiAnalysis ?? undefined;
  const analysisFromMutation =
    aiPayload?.ok === true && aiPayload.analysis ? aiPayload.analysis : undefined;
  const analysis = analysisFromMutation ?? analysisFromServer;

  const aiFallbackMessage =
    aiPayload?.ok === false
      ? aiPayload.error
      : aiMutation.isError
        ? "No se pudo contactar al servicio de análisis."
        : null;

  const aiFallbackParagraph = (() => {
    if (!aiFallbackMessage) {
      return "Todavía no hay análisis IA. Usá «Generar análisis IA» (solo la primera vez consume la API).";
    }
    const isQuota =
      aiFallbackMessage.includes("429") ||
      aiFallbackMessage.includes("cuota") ||
      aiFallbackMessage.includes("límite de cuota");
    const isNoKey = aiFallbackMessage.includes("GEMINI_API_KEY no configurada");
    if (isQuota) {
      return `${aiFallbackMessage} El resto del informe se basa en datos operativos reales.`;
    }
    if (isNoKey) {
      return `${aiFallbackMessage} El resto del informe se basa en datos operativos reales.`;
    }
    return `El análisis automático no pudo generarse: ${aiFallbackMessage} Reintentá más tarde o revisá la configuración del servidor. El resto del informe utiliza datos operativos reales.`;
  })();

  const pieData = d.statusDistribution.filter((s) => s.count > 0);
  const findings =
    analysis?.keyFindings && analysis.keyFindings.length > 0 ? analysis.keyFindings : d.suggestedInsights;

  const hasStoredAnalysis = Boolean(analysisFromServer);
  const showGenerateCta = !hasStoredAnalysis && !analysis && !aiMutation.isPending;

  return (
    <div className="event-report-root event-report-screen">
      <div className="event-report-toolbar no-print">
        <Link className="btn btn-ghost" to={backFromInformeHref}>
          <Icon name="arrow_back" />
          {user?.role === "INFORMADOR" ? "Volver a eventos" : "Volver al evento"}
        </Link>
        <div className="event-report-toolbar__actions">
          {d.aiAnalysisUpdatedAt ? (
            <span className="er-ai-muted" style={{ alignSelf: "center", fontSize: "0.8rem" }}>
              Análisis IA guardado: {formatReportDate(d.aiAnalysisUpdatedAt)}
            </span>
          ) : null}
          {aiMutation.isPending ? (
            <span className="er-ai-muted" style={{ alignSelf: "center" }}>
              {aiMutation.variables ? "Regenerando análisis…" : "Generando análisis…"}
            </span>
          ) : null}
          {canUseAiTools && showGenerateCta ? (
            <button type="button" className="btn btn-primary" onClick={() => void aiMutation.mutate(false)}>
              <Icon name="smart_toy" />
              Generar análisis IA
            </button>
          ) : null}
          {canUseAiTools && (hasStoredAnalysis || analysis) ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void aiMutation.mutate(true)}
              disabled={aiMutation.isPending}
            >
              <Icon name="smart_toy" />
              Regenerar análisis IA
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            <Icon name="picture_as_pdf" />
            Exportar / imprimir PDF
          </button>
        </div>
      </div>

      <article className="event-report-page">
        <header className="er-header">
          <div className="er-brand">
            <div className="er-logo" aria-hidden>
              A
            </div>
            <div>
              <h1>Informe de Evento</h1>
              <p className="er-sub">Sistema de acreditaciones y asistencia · Reporte ejecutivo post-evento</p>
            </div>
          </div>
          <div className="er-event-meta">
            <strong>{d.eventName}</strong>
            Fecha: {d.eventDateLabel}
            <br />
            Sede: {d.location ?? "—"}
            <br />
            Generado: {d.generatedAtLabel}
            <br />
            <span style={{ fontSize: "11px" }}>Estado evento: {d.eventStatus}</span>
          </div>
        </header>

        <section>
          <div className="er-section-title">
            <h2>Resumen general</h2>
            <span className="er-badge">Cierre de evento</span>
          </div>
          <div className="er-kpi-grid">
            <article className="er-kpi-card">
              <div className="er-kpi-label">Personas esperadas</div>
              <div className="er-kpi-value">{d.expectedPeople}</div>
              <div className="er-kpi-foot">Base importada (convocatoria)</div>
            </article>
            <article className="er-kpi-card">
              <div className="er-kpi-label">Personas acreditadas</div>
              <div className="er-kpi-value">{d.accreditedPeople}</div>
              <div className="er-kpi-foot">
                <span className="er-positive">{formatPercentage(d.attendanceRate)}</span> asist. sobre convocados
              </div>
            </article>
            <article className="er-kpi-card">
              <div className="er-kpi-label">Ausentes (base sin acreditar)</div>
              <div className="er-kpi-value">{d.absentPeople}</div>
              <div className="er-kpi-foot">
                <span className="er-neutral">{formatPercentage(d.absenteeRate)}</span> sobre convocados
              </div>
            </article>
            <article className="er-kpi-card">
              <div className="er-kpi-label">Registros manuales</div>
              <div className="er-kpi-value">{d.manualRegistrations}</div>
              <div className="er-kpi-foot">Altas fuera de planilla · Acreditados man.: {d.manualAccredited}</div>
            </article>
          </div>
          {d.invalidRegistrations > 0 ? (
            <p style={{ marginTop: "12px", fontSize: "13px", color: "var(--er-muted)" }}>
              Filas inválidas o duplicadas en importaciones: <strong>{d.invalidRegistrations}</strong>
            </p>
          ) : null}
        </section>

        <section>
          <div className="er-section-title">
            <h2>Comportamiento de acreditación</h2>
            <span className="er-badge">Franja horaria</span>
          </div>
          <div className="er-content-grid">
            <article className="er-panel">
              <h3>Ingresos por hora</h3>
              {d.accreditationByHour.length === 0 ? (
                <p className="er-ai-muted">No hay acreditaciones con hora registrada.</p>
              ) : (
                <div className="er-chart-h">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.accreditationByHour} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid #e5e7eb"
                        }}
                      />
                      <Bar dataKey="count" name="Acreditaciones" fill="#2563eb" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
            <article className="er-panel">
              <h3>Resultado de convocatoria</h3>
              {pieData.length === 0 ? (
                <p className="er-ai-muted">Sin datos para el gráfico.</p>
              ) : (
                <div className="er-donut-stack">
                  <div className="er-donut-chart-only">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <Pie
                          data={pieData}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius="52%"
                          outerRadius="78%"
                          paddingAngle={2}
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="er-donut-legend">
                    {pieData.map((slice, i) => (
                      <li key={slice.key} className="er-donut-legend__item">
                        <span
                          className="er-donut-legend__dot"
                          style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                          aria-hidden
                        />
                        <span className="er-donut-legend__text">
                          <span className="er-donut-legend__label">{slice.label}</span>
                          <span className="er-donut-legend__count">{slice.count}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="er-donut-footnote">
                    Asistencia sobre convocados: <strong>{formatPercentage(d.attendanceRate)}</strong>
                  </p>
                </div>
              )}
            </article>
          </div>
        </section>

        <section>
          <div className="er-section-title">
            <h2>Análisis generado por IA</h2>
          </div>
          <article className="er-ai-box">
            <div className="er-ai-head">
              <h3>Lectura ejecutiva del evento</h3>
              <span className="er-ai-tag">IA · Borrador automático</span>
            </div>
            {aiMutation.isPending && !analysis ? (
              <p className="er-ai-muted">Generando texto con los datos consolidados…</p>
            ) : analysis ? (
              <>
                <p>{analysis.executiveSummary}</p>
                {analysis.operationalAlerts.length > 0 ? (
                  <>
                    <p style={{ fontWeight: 700, marginBottom: 4 }}>Alertas operativas</p>
                    <ul style={{ margin: "0 0 10px 1.1rem", padding: 0 }}>
                      {analysis.operationalAlerts.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {analysis.recommendations.length > 0 ? (
                  <>
                    <p style={{ fontWeight: 700, marginBottom: 4 }}>Recomendaciones</p>
                    <ul style={{ margin: "0 0 10px 1.1rem", padding: 0 }}>
                      {analysis.recommendations.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {analysis.conclusion ? <p>{analysis.conclusion}</p> : null}
              </>
            ) : (
              <p className="er-ai-muted">{aiFallbackParagraph}</p>
            )}
          </article>
        </section>

        <section>
          <div className="er-section-title">
            <h2>Hallazgos principales</h2>
            <span className="er-badge">Insights</span>
          </div>
          <div className="er-insights">
            {findings.slice(0, 3).map((text, i) => (
              <article key={i} className="er-insight-card">
                <strong>{analysis ? `Hallazgo ${i + 1}` : `Indicador ${i + 1}`}</strong>
                <span>{text}</span>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="er-section-title">
            <h2>Detalle operativo</h2>
            <span className="er-badge">Control de gestión</span>
          </div>
          <article className="er-panel">
            <table className="er-table">
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Valor</th>
                  <th>Lectura</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.operationalTable.map((row) => (
                  <tr key={row.indicator}>
                    <td>{row.indicator}</td>
                    <td>{row.value}</td>
                    <td>{row.reading}</td>
                    <td>
                      <span className={`er-status ${row.state}`}>{statusLabel[row.state]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>

        <footer className="er-footer">
          <span>Sistema de acreditaciones · Informe automático post-evento · {formatReportDate(d.generatedAt)}</span>
          <span>Página 1 de 1</span>
        </footer>
      </article>
    </div>
  );
}
