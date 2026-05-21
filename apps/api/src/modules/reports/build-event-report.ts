import type {
  EventReportAccreditationHour,
  EventReportOperationalRow,
  EventReportPayload,
  EventReportStatusSlice
} from "@gcba/shared";
import { EventPersonStatus } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import {
  ACCREDITATION_BUCKET_MINUTES,
  AR_TZ,
  arBucketKey,
  arBucketLabelHm
} from "../../lib/time-buckets";

export { ACCREDITATION_BUCKET_MINUTES };

function formatDateAr(d: Date): string {
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: AR_TZ
  });
}

function formatTimeAr(d: Date): string {
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: AR_TZ
  });
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

/**
 * Agrupa las acreditaciones por franja en horario de Buenos Aires.
 * Granularidad: {@link ACCREDITATION_BUCKET_MINUTES} (por defecto 15 minutos),
 * para que el gráfico muestre hora y minuto.
 */
export function groupAccreditationsByHour(
  dates: Array<Date | null>,
  bucketMinutes: number = ACCREDITATION_BUCKET_MINUTES
): EventReportAccreditationHour[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const date of dates) {
    if (!date) continue;
    const key = arBucketKey(date, bucketMinutes);
    const label = arBucketLabelHm(date, bucketMinutes);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { label, count: 1 });
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => ({ label: value.label, count: value.count }));
}

function buildOperationalTable(params: {
  attendanceRate: number;
  absenteeRate: number;
  manualAccredited: number;
  expectedPeople: number;
}): EventReportOperationalRow[] {
  const { attendanceRate, absenteeRate, manualAccredited, expectedPeople } = params;

  const attendanceState: EventReportOperationalRow["state"] =
    attendanceRate >= 70 ? "ok" : attendanceRate >= 50 ? "warn" : "bad";
  const absentState: EventReportOperationalRow["state"] =
    absenteeRate <= 30 ? "ok" : absenteeRate <= 45 ? "warn" : "bad";
  const manualState: EventReportOperationalRow["state"] =
    manualAccredited === 0 ? "ok" : manualAccredited <= Math.max(5, expectedPeople * 0.1) ? "warn" : "bad";

  return [
    {
      indicator: "Tasa de asistencia (sobre base convocada)",
      value: `${formatPct(attendanceRate)}%`,
      reading:
        attendanceRate >= 70
          ? "¡Muy buena convocatoria! La asistencia superó el 70% de la base."
          : attendanceRate >= 50
            ? "Buena participación. Hay margen para potenciar la comunicación previa y acercarse al 70%."
            : "La convocatoria quedó por debajo de lo esperado; una buena oportunidad para reforzar recordatorios y canales de difusión.",
      state: attendanceState
    },
    {
      indicator: "Ausentes en la base convocada",
      value: `${formatPct(absenteeRate)}%`,
      reading:
        absenteeRate <= 30
          ? "Nivel de ausentes acotado: la mayoría de la base convocada se acercó al evento."
          : "Una parte de la base no llegó a acreditarse; conviene mirar qué motivó esa ausencia para la próxima.",
      state: absentState
    },
    {
      indicator: "Acreditaciones en sede (fuera de base)",
      value: String(manualAccredited),
      reading:
        manualAccredited === 0
          ? "No hubo altas fuera de base: todos los acreditados estaban en la planilla."
          : "Hubo acreditaciones fuera de base: ¡buen trabajo del equipo en sede recibiendo asistentes espontáneos!",
      state: manualState
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
    out.push(
      `¡Muy buena convocatoria! La asistencia llegó al ${formatPct(attendanceRate)}% de la base convocada.`
    );
  } else if (attendanceRate >= 50) {
    out.push(
      `Asistencia del ${formatPct(attendanceRate)}%: una participación sólida con margen para crecer en próximas ediciones.`
    );
  } else if (attendanceRate > 0) {
    out.push(
      `La asistencia fue del ${formatPct(attendanceRate)}%. Es una buena oportunidad para revisar recordatorios y canales de difusión.`
    );
  }

  if (accreditationByHour.length > 0) {
    const peak = [...accreditationByHour].sort((a, b) => b.count - a.count)[0];
    if (peak && peak.count > 0) {
      out.push(
        `El pico de acreditaciones se dio cerca de las ${peak.label} (${peak.count} personas). Útil para dimensionar el staff la próxima.`
      );
    }
  }

  if (manualAccredited > 0 && accreditedPeople > 0) {
    const pctMan = (manualAccredited / accreditedPeople) * 100;
    out.push(
      `El ${formatPct(pctMan)}% de las personas se acreditaron fuera de base (${manualAccredited} personas): el equipo en sede acompañó muy bien la afluencia espontánea.`
    );
  } else if (accreditedPeople > 0) {
    out.push("Todas las acreditaciones se hicieron desde la base convocada: una operación bien planificada.");
  }

  while (out.length < 3) {
    out.push("Tenés datos consolidados para comparar este evento con futuras convocatorias y seguir mejorando.");
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
    accreditationsTimes
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
    })
  ]);

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
    invalidRegistrations: 0,

    attendanceRate,
    absenteeRate,

    accreditationByHour,
    statusDistribution,
    operationalTable,
    suggestedInsights
  };
}
