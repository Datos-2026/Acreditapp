import { prisma } from "../../lib/prisma";
import { EventPersonStatus } from "../../prisma-exports";

/** Extrae número de mesa desde valores como "3", "Mesa 3", "mesa 12". */
export function parseMesaNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const match = /(\d+)/.exec(s);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function mesaLabel(n: number): string {
  return String(n);
}

type MesaCounts = Map<number, number>;

function emptyCounts(mesaCount: number): MesaCounts {
  const counts = new Map<number, number>();
  for (let i = 1; i <= mesaCount; i++) counts.set(i, 0);
  return counts;
}

async function loadMesaCounts(eventId: string, mesaCount: number): Promise<MesaCounts> {
  const rows = await prisma.eventPerson.findMany({
    where: { eventId },
    select: { status: true, extraData: true }
  });
  const accredited = emptyCounts(mesaCount);
  const assigned = emptyCounts(mesaCount);

  for (const row of rows) {
    const extra = row.extraData as Record<string, unknown> | null;
    const n = parseMesaNumber(extra?.mesa);
    if (!n || n < 1 || n > mesaCount) continue;
    assigned.set(n, (assigned.get(n) ?? 0) + 1);
    if (row.status === EventPersonStatus.accredited) {
      accredited.set(n, (accredited.get(n) ?? 0) + 1);
    }
  }

  return accredited;
}

/** Elige la mesa con menos acreditados; desempate por número de mesa menor. */
export async function pickMesaWithLeastLoad(eventId: string, mesaCount: number): Promise<number> {
  if (mesaCount < 1) throw new Error("mesaCount inválido");
  const counts = await loadMesaCounts(eventId, mesaCount);
  let best = 1;
  let min = counts.get(1) ?? 0;
  for (let i = 2; i <= mesaCount; i++) {
    const c = counts.get(i) ?? 0;
    if (c < min) {
      min = c;
      best = i;
    }
  }
  return best;
}

export type MesaStatRow = {
  mesa: string;
  mesaNumber: number;
  accredited: number;
  assigned: number;
};

export async function getMesaStats(eventId: string, mesaCount: number) {
  const rows = await prisma.eventPerson.findMany({
    where: { eventId },
    select: { status: true, extraData: true }
  });

  const accredited = emptyCounts(mesaCount);
  const assigned = emptyCounts(mesaCount);
  let totalAccredited = 0;
  let totalAssigned = 0;
  let unassignedAccredited = 0;

  for (const row of rows) {
    const extra = row.extraData as Record<string, unknown> | null;
    const n = parseMesaNumber(extra?.mesa);
    const isAccredited = row.status === EventPersonStatus.accredited;
    if (isAccredited) totalAccredited += 1;
    if (!n || n < 1 || n > mesaCount) {
      if (isAccredited) unassignedAccredited += 1;
      continue;
    }
    assigned.set(n, (assigned.get(n) ?? 0) + 1);
    totalAssigned += 1;
    if (isAccredited) accredited.set(n, (accredited.get(n) ?? 0) + 1);
  }

  const mesas: MesaStatRow[] = [];
  for (let i = 1; i <= mesaCount; i++) {
    mesas.push({
      mesa: mesaLabel(i),
      mesaNumber: i,
      accredited: accredited.get(i) ?? 0,
      assigned: assigned.get(i) ?? 0
    });
  }

  return {
    mesaCount,
    mesas,
    totalAccredited,
    totalAssigned,
    unassignedAccredited
  };
}

export function mergeMesaIntoExtraData(
  extraData: Record<string, unknown> | null | undefined,
  mesaNumber: number
): Record<string, unknown> {
  return { ...(extraData ?? {}), mesa: mesaLabel(mesaNumber) };
}
