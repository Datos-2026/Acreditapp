export type AccreditorAccreditationRow = {
  accreditedByUserId: string;
  eventId: string;
};

export type AccreditorPodiumStats = {
  userId: string;
  count: number;
  eventCount: number;
  averagePerEvent: number;
};

export function buildAccreditorPodiumStats(rows: AccreditorAccreditationRow[]): {
  totalAccredited: number;
  totalEventsWithAccreditations: number;
  stats: AccreditorPodiumStats[];
} {
  const statsByUser = new Map<string, { count: number; eventIds: Set<string> }>();
  const allEventIds = new Set<string>();

  for (const row of rows) {
    allEventIds.add(row.eventId);
    let stats = statsByUser.get(row.accreditedByUserId);
    if (!stats) {
      stats = { count: 0, eventIds: new Set() };
      statsByUser.set(row.accreditedByUserId, stats);
    }
    stats.count += 1;
    stats.eventIds.add(row.eventId);
  }

  const accreditorStats: AccreditorPodiumStats[] = [...statsByUser.entries()].map(
    ([userId, entry]) => ({
      userId,
      count: entry.count,
      eventCount: entry.eventIds.size,
      averagePerEvent: entry.eventIds.size > 0 ? entry.count / entry.eventIds.size : 0
    })
  );

  return {
    totalAccredited: rows.length,
    totalEventsWithAccreditations: allEventIds.size,
    stats: accreditorStats
  };
}

export function sortByTotalCount(stats: AccreditorPodiumStats[]): AccreditorPodiumStats[] {
  return [...stats].sort((a, b) => b.count - a.count || b.averagePerEvent - a.averagePerEvent);
}

export function sortByAveragePerEvent(stats: AccreditorPodiumStats[]): AccreditorPodiumStats[] {
  return [...stats].sort(
    (a, b) =>
      b.averagePerEvent - a.averagePerEvent ||
      b.count - a.count ||
      b.eventCount - a.eventCount
  );
}
