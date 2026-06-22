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
  kind: "gcba" | "vecinos";
  location: string | null;
  enableMesas?: boolean;
  enableNotes?: boolean;
  mesaCount?: number | null;
  googleSheetName?: string | null;
  totalPeople: number;
  accreditedPeople: number;
};

export type MesaStatRowDto = {
  mesa: string;
  mesaNumber: number;
  accredited: number;
  assigned: number;
};

export type MesaStatsDto = {
  mesaCount: number | null;
  mesas: MesaStatRowDto[];
  totalAccredited: number;
  totalAssigned: number;
  unassignedAccredited: number;
  autoAssignEnabled: boolean;
  sheetsConfigured: boolean;
  googleSheetsEnabled: boolean;
  googleSheetName?: string | null;
  lastSheetError?: string | null;
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

export type PersonSummaryDto = {
  cuilNormalized: string;
  firstName: string;
  lastName: string;
  dni: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  position?: string | null;
  address?: string | null;
  comuna?: string | null;
};

export type EventPersonDto = {
  id: string;
  status: "pending" | "accredited";
  source: "manual" | "imported";
  accreditedAt: string | null;
  eventNotes?: string | null;
  extraData?: Record<string, unknown> | null;
  person: PersonSummaryDto;
  accreditedByUser?: { id: string; name: string } | null;
};

export type DirectoryPersonDto = {
  cuilNormalized: string;
  dni: string | null;
  firstName: string;
  lastName: string;
  ministerio: string | null;
  litPuesto: string | null;
  descRep: string | null;
  email: string | null;
};

export type VecinoDirectoryPersonDto = {
  dni: string;
  firstName: string;
  lastName: string;
  address: string | null;
  comuna: string | null;
  phone: string | null;
  email: string | null;
  participationCount: number | null;
  claimCount: number | null;
  codV: string | null;
};

export type DirectorySearchResult =
  | { inEvent: true; eventPerson: EventPersonDto }
  | {
      inEvent: false;
      fromDirectory: true;
      directoryKind: "gcba";
      directoryPerson: DirectoryPersonDto;
    }
  | {
      inEvent: false;
      fromDirectory: true;
      directoryKind: "vecinos";
      directoryPerson: VecinoDirectoryPersonDto;
    }
  | { inEvent: false; fromDirectory: false };

export type DirectoryStatsDto = {
  total: number;
  lastUpload: {
    filename: string;
    createdAt: string;
    uploadedBy: string;
  } | null;
};
