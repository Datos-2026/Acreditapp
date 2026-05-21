/** Zona horaria operativa del evento (GCBA, Argentina, sin horario de verano). */
export const AR_TZ = "America/Argentina/Buenos_Aires";

/** Granularidad por defecto de los buckets de acreditación, en minutos. */
export const ACCREDITATION_BUCKET_MINUTES = 15;

type ArParts = { y: string; mo: string; d: string; h: string; m: string };

function arDateParts(date: Date): ArParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour"),
    m: get("minute")
  };
}

function clampBucketMinutes(minutes: number): number {
  return minutes > 0 && minutes <= 60 ? minutes : ACCREDITATION_BUCKET_MINUTES;
}

/**
 * Clave estable de bucket en horario Argentina: `"YYYY-MM-DDTHH:mm"`.
 * Ordena lexicográficamente igual que cronológicamente.
 */
export function arBucketKey(date: Date, minutes: number = ACCREDITATION_BUCKET_MINUTES): string {
  const bucket = clampBucketMinutes(minutes);
  const { y, mo, d, h, m } = arDateParts(date);
  const bucketMin = String(Math.floor(Number(m) / bucket) * bucket).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${bucketMin}`;
}

/** Solo la parte hora:minuto del bucket (útil para labels cortos). */
export function arBucketLabelHm(date: Date, minutes: number = ACCREDITATION_BUCKET_MINUTES): string {
  const bucket = clampBucketMinutes(minutes);
  const { h, m } = arDateParts(date);
  const bucketMin = String(Math.floor(Number(m) / bucket) * bucket).padStart(2, "0");
  return `${h}:${bucketMin}`;
}
