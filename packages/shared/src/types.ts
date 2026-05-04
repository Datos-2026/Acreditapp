import type { AppRole } from "./constants";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

export type EventStatus = "draft" | "active" | "closed" | "archived";

export type EventCardDto = {
  id: string;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  status: EventStatus;
  location: string | null;
  totalPeople: number;
  accreditedPeople: number;
};

/** Franja horaria de acreditaciones (informe). */
export type EventReportAccreditationHour = {
  label: string;
  count: number;
};

/** Porción para gráfico de convocatoria. */
export type EventReportStatusSlice = {
  key: string;
  label: string;
  count: number;
};

/** Fila de tabla operativa (indicadores de gestión). */
export type EventReportOperationalRow = {
  indicator: string;
  value: string;
  reading: string;
  state: "ok" | "warn" | "bad";
};

/** Respuesta JSON esperada del análisis IA (parseo en backend). */
export type EventReportAiAnalysis = {
  executiveSummary: string;
  keyFindings: string[];
  operationalAlerts: string[];
  recommendations: string[];
  conclusion: string;
};

/** Payload del informe post-evento (GET /events/:id/report). */
export type EventReportPayload = {
  eventId: string;
  eventName: string;
  eventStatus: EventStatus;
  eventDateLabel: string;
  eventRangeLabel: string;
  location: string | null;
  generatedAt: string;
  generatedAtLabel: string;

  totalPeople: number;
  expectedPeople: number;
  accreditedPeople: number;
  absentPeople: number;
  manualRegistrations: number;
  manualAccredited: number;
  invalidRegistrations: number;

  attendanceRate: number;
  absenteeRate: number;

  accreditationByHour: EventReportAccreditationHour[];
  statusDistribution: EventReportStatusSlice[];

  operationalTable: EventReportOperationalRow[];
  /** Hallazgos sugeridos por reglas locales si la IA no está disponible. */
  suggestedInsights: string[];

  /** Persistido en servidor tras generar o regenerar el análisis. */
  aiAnalysis?: EventReportAiAnalysis | null;
  /** ISO 8601 — última vez que se guardó el análisis IA. */
  aiAnalysisUpdatedAt?: string | null;
};
