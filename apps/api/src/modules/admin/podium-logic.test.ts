import { describe, expect, it } from "vitest";

import {
  buildAccreditorPodiumStats,
  sortByAveragePerEvent,
  sortByTotalCount
} from "./podium-logic";

describe("podium-logic", () => {
  it("calcula promedio por evento en el que acreditó", () => {
    const { stats, totalEventsWithAccreditations } = buildAccreditorPodiumStats([
      { accreditedByUserId: "u1", eventId: "e1" },
      { accreditedByUserId: "u1", eventId: "e1" },
      { accreditedByUserId: "u1", eventId: "e2" },
      { accreditedByUserId: "u2", eventId: "e1" },
      { accreditedByUserId: "u2", eventId: "e1" },
      { accreditedByUserId: "u2", eventId: "e1" }
    ]);

    expect(totalEventsWithAccreditations).toBe(2);
    const u1 = stats.find((s) => s.userId === "u1");
    const u2 = stats.find((s) => s.userId === "u2");
    expect(u1).toMatchObject({ count: 3, eventCount: 2, averagePerEvent: 1.5 });
    expect(u2).toMatchObject({ count: 3, eventCount: 1, averagePerEvent: 3 });
  });

  it("ordena por promedio y no solo por total", () => {
    const { stats } = buildAccreditorPodiumStats([
      { accreditedByUserId: "heavy", eventId: "e1" },
      { accreditedByUserId: "heavy", eventId: "e1" },
      { accreditedByUserId: "heavy", eventId: "e2" },
      { accreditedByUserId: "heavy", eventId: "e2" },
      { accreditedByUserId: "steady", eventId: "e1" },
      { accreditedByUserId: "steady", eventId: "e1" },
      { accreditedByUserId: "steady", eventId: "e2" },
      { accreditedByUserId: "steady", eventId: "e2" },
      { accreditedByUserId: "steady", eventId: "e3" },
      { accreditedByUserId: "steady", eventId: "e3" }
    ]);

    const byTotal = sortByTotalCount(stats);
    const byAverage = sortByAveragePerEvent(stats);

    expect(byTotal[0]?.userId).toBe("steady");
    expect(byAverage[0]?.userId).toBe("steady");
    expect(byAverage[0]?.averagePerEvent).toBe(2);
    expect(byAverage.find((s) => s.userId === "heavy")?.averagePerEvent).toBe(2);
  });
});
