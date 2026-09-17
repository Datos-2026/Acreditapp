export const PERSONA_ESTADO_ACREDITADO = "Acreditado";
export const PERSONA_ESTADO_CONVOCADO = "Convocado no acreditado";
export const PERSONA_ESTADO_FUERA_DE_BASE = "Fuera de base";

export function shouldSyncToBaseOnStatusChange(previousStatus: string, nextStatus: string): boolean {
  return nextStatus === "closed" && previousStatus !== "closed";
}

/** Quién entra a BASE_ACREDITADOS al cerrar: importados todos; manual solo acreditado + match dotación. */
export function shouldIncludeEventPersonInBaseSync(
  person: { source: string; status: string },
  inDotacion: boolean
): boolean {
  const source = String(person.source);
  const status = String(person.status);
  if (source === "imported") return true;
  if (source === "manual") return status === "accredited" && inDotacion;
  return false;
}

export function attendanceFlagsForEventPerson(person: { source: string; status: string }): {
  registered: true;
  attended: boolean;
  outOfBase: boolean;
  status: string;
} {
  const source = String(person.source);
  const accredited = String(person.status) === "accredited";
  const outOfBase = source === "manual";
  return {
    registered: true,
    attended: accredited,
    outOfBase,
    status: outOfBase ? PERSONA_ESTADO_FUERA_DE_BASE : accredited ? PERSONA_ESTADO_ACREDITADO : PERSONA_ESTADO_CONVOCADO
  };
}

export function normalizePersonaEstado(
  raw: string | null | undefined,
  flags?: { attended?: boolean; outOfBase?: boolean }
): string | null {
  const text = String(raw ?? "").trim();
  const lower = text.toLocaleLowerCase("es-AR");
  if (text === PERSONA_ESTADO_ACREDITADO || text === PERSONA_ESTADO_CONVOCADO || text === PERSONA_ESTADO_FUERA_DE_BASE) {
    return text;
  }
  if (lower === "pendiente" || lower.includes("convocado")) return PERSONA_ESTADO_CONVOCADO;
  if (lower.includes("fuera")) return PERSONA_ESTADO_FUERA_DE_BASE;
  if (lower.includes("acredit")) return PERSONA_ESTADO_ACREDITADO;
  if (flags?.outOfBase) return PERSONA_ESTADO_FUERA_DE_BASE;
  if (flags?.attended) return PERSONA_ESTADO_ACREDITADO;
  if (flags?.attended === false || text) return PERSONA_ESTADO_CONVOCADO;
  return null;
}

const ESTADO_PRIORITY: Record<string, number> = {
  [PERSONA_ESTADO_ACREDITADO]: 3,
  [PERSONA_ESTADO_CONVOCADO]: 2,
  [PERSONA_ESTADO_FUERA_DE_BASE]: 1
};

export function mergePersonaEstado(
  current: string | null | undefined,
  incoming: string | null | undefined
): string | null {
  const next = String(incoming ?? "").trim();
  const prev = String(current ?? "").trim();
  if (!next) return prev || null;
  if (!prev) return next;
  return (ESTADO_PRIORITY[next] ?? 0) >= (ESTADO_PRIORITY[prev] ?? 0) ? next : prev;
}

export function appendEventoAsistido(
  current: string | null | undefined,
  eventName: string | null | undefined
): string | null {
  const name = String(eventName ?? "").trim();
  if (!name) return String(current ?? "").trim() || null;
  const existing = String(current ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (existing.some((part) => part.toLocaleLowerCase("es-AR") === name.toLocaleLowerCase("es-AR"))) {
    return existing.join(", ");
  }
  return [...existing, name].join(", ");
}
