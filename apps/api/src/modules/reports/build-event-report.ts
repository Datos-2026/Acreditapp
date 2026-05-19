import type {
  EventReportAccreditationHour,
  EventReportOperationalRow,
  EventReportPayload,
  EventReportStatusSlice
} from "@gcba/shared";
import { EventPersonStatus } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";

function formatDateAr(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTimeAr(d: Date): string {
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatPct(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return "0,0";
  return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Tasa de asistencia sobre convocados (base importada). */
export function calculateAttendanceRate(expected: number, accreditedFromBase: number): number {
  if (expected <= 0) return 0;
  return Number(((accreditedFromBase / expected) * 100).toFixed(2));
}

export function calculateAbsenteeRate(expected: number, absent: number): number {
  if (expected <= 0) return 0;
  return Number(((absent / expected) * 100).toFixed(2));
}

export function groupAccreditationsByHour(dates: Array<Date | null>): EventReportAccreditationHour[] {
  const map = new Map<string, number>();
  for (const date of dates) {
    if (!date) continue;
    const bucket = new Date(date);
    bucket.setMinutes(0, 0, 0);
    const key = bucket.toISOString();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([iso, count]) => ({
      label: new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      count
    }));
}

function buildOperationalTable(params: {
  attendanceRate: number;
  absenteeRate: number;
  manualAccredited: number;
  invalidRegistrations: number;
  expectedPeople: number;
}): EventReportOperationalRow[] {
  const { attendanceRate, absenteeRate, manualAccredited, invalidRegistrations, expectedPeople } = params;

  const attendanceState: EventReportOperationalRow["state"] =
    attendanceRate >= 70 ? "ok" : attendanceRate >= 50 ? "warn" : "bad";
  const absentState: EventReportOperationalRow["state"] =
    absenteeRate <= 30 ? "ok" : absenteeRate <= 45 ? "warn" : "bad";
  const manualState: EventReportOperationalRow["state"] =
    manualAccredited === 0 ? "ok" : manualAccredited <= Math.max(5, expectedPeople * 0.1) ? "warn" : "bad";
  const invalidState: EventReportOperationalRow["state"] =
    invalidRegistrations === 0 ? "ok" : invalidRegistrations <= 5 ? "warn" : "bad";

  return [
    {
      indicator: "Tasa de asistencia (sobre base importada)",
      value: `${formatPct(attendanceRate)}%`,
      reading:
        attendanceRate >= 70
          ? "Convocatoria alineada o por encima del umbral habitual (70%)."
          : attendanceRate >= 50
            ? "Convocatoria moderada; conviene revisar comunicación previa."
            : "Convocatoria baja respecto a la base importada.",
      state: attendanceState
    },
    {
      indicator: "Tasa de ausentismo (base importada)",
      value: `${formatPct(absenteeRate)}%`,
      reading:
        absenteeRate <= 30
          ? "Ausentismo acotado respecto a convocados."
          : "Parte significativa de la base no acreditó; revisar causas operativas.",
      state: absentState
    },
    {
      indicator: "Acreditaciones manuales (en sede)",
      value: String(manualAccredited),
      reading:
        manualAccredited === 0
          ? "Sin altas manuales acreditadas en el período."
          : "Participantes acreditados fuera de la planilla importada.",
      state: manualState
    },
    {
      indicator: "Filas inválidas / duplicadas (importaciones)",
      value: String(invalidRegistrations),
      reading:
        invalidRegistrations === 0
          ? "Sin incidencias registradas en lotes de importación."
          : "Revisar calidad de datos en planillas y reglas de importación.",
      state: invalidState
    }
  ];
}

function buildSuggestedInsights(params: {
  attendanceRate: number;
  accreditationByHour: EventReportAccreditationHour[];
  manualAccredited: number;
  accreditedPeople: number;
}): string[] {
  const { attendanceRate, accreditationByHour, manualAccredited, accreditedPeople } = params;
  const out: string[] = [];

  if (attendanceRate >= 70) {
    out.push(`La asistencia sobre convocados alcanzó el ${formatPct(attendanceRate)}%, en línea con objetivos operativos habituales.`);
  } else if (attendanceRate > 0) {
    out.push(`La asistencia sobre convocados fue del ${formatPct(attendanceRate)}%; conviene analizar recordatorios y canales de difusión.`);
  }

  if (accreditationByHour.length > 0) {
    const peak = [...accreditationByHour].sort((a, b) => b.count - a.count)[0];
    if (peak && peak.count > 0) {
      out.push(`El mayor flujo de acreditaciones se concentró en la franja ${peak.label} (${peak.count} registros).`);
    }
  }

  if (manualAccredited > 0 && accreditedPeople > 0) {
    const pctMan = (manualAccredited / accreditedPeople) * 100;
    out.push(
      `El ${formatPct(pctMan)}% de las acreditaciones corresponden a registros manuales en sede (${manualAccredited} personas).`
    );
  }

  while (out.length < 3) {
    out.push("Los datos consolidados permiten comparar este evento con próximas convocatorias usando las mismas métricas.");
    if (out.length >= 3) break;
  }

  return out.slice(0, 3);
}

export async function buildEventReportPayload(eventId: string): Promise<EventReportPayload | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const [
    totalPeople,
    importedTotal,
    manualTotal,
    accreditedTotal,
    accreditedImported,
    accreditedManual,
    pendingImported,
    accreditationsTimes,
    batchSums
  ] = await Promise.all([
    prisma.eventPerson.count({ where: { eventId } }),
    prisma.eventPerson.count({ where: { eventId, source: "imported" } }),
    prisma.eventPerson.count({ where: { eventId, source: "manual" } }),
    prisma.eventPerson.count({ where: { eventId, status: EventPersonStatus.accredited } }),
    prisma.eventPerson.count({
      where: { eventId, source: "imported", status: EventPersonStatus.accredited }
    }),
    prisma.eventPerson.count({
      where: { eventId, source: "manual", status: EventPersonStatus.accredited }
    }),
    prisma.eventPerson.count({
      where: { eventId, source: "imported", status: EventPersonStatus.pending }
    }),
    prisma.eventPerson.findMany({
      where: { eventId, status: EventPersonStatus.accredited, accreditedAt: { not: null } },
      select: { accreditedAt: true }
    }),
    prisma.importBatch.aggregate({
      where: { eventId },
      _sum: { invalidRows: true, duplicateRows: true }
    })
  ]);

  const invalidRegistrations =
    (batchSums._sum.invalidRows ?? 0) + (batchSums._sum.duplicateRows ?? 0);

  const expectedPeople = importedTotal;
  const absentPeople = pendingImported;
  const attendanceRate = calculateAttendanceRate(expectedPeople, accreditedImported);
  const absenteeRate = calculateAbsenteeRate(expectedPeople, absentPeople);

  const accreditationByHour = groupAccreditationsByHour(accreditationsTimes.map((r) => r.accreditedAt));

  const statusDistribution: EventReportStatusSlice[] = [
    { key: "accredited", label: "Acreditados", count: accreditedTotal },
    { key: "absent", label: "Ausentes (sin acreditar, base importada)", count: absentPeople },
    { key: "manual", label: "Registros manuales (total)", count: manualTotal }
  ];

  const operationalTable = buildOperationalTable({
    attendanceRate,
    absenteeRate,
    manualAccredited: accreditedManual,
    invalidRegistrations,
    expectedPeople
  });

  const suggestedInsights = buildSuggestedInsights({
    attendanceRate,
    accreditationByHour,
    manualAccredited: accreditedManual,
    accreditedPeople: accreditedTotal
  });

  const now = new Date();
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);

  return {
    eventId: event.id,
    eventName: event.name,
    eventStatus: event.status,
    eventDateLabel: formatDateAr(start),
    eventRangeLabel: `${formatDateAr(start)} — ${formatDateAr(end)} · ${formatTimeAr(start)} a ${formatTimeAr(end)}`,
    location: event.location,
    generatedAt: now.toISOString(),
    generatedAtLabel: `${formatDateAr(now)} ${formatTimeAr(now)}`,

    totalPeople,
    expectedPeople,
    accreditedPeople: accreditedTotal,
    absentPeople,
    manualRegistrations: manualTotal,
    manualAccredited: accreditedManual,
    invalidRegistrations,

    attendanceRate,
    absenteeRate,

    accreditationByHour,
    statusDistribution,
    operationalTable,
    suggestedInsights
  };
}
