import { describe, expect, it } from "vitest";
import {
  calculateAbsenteeRate,
  calculateAttendanceRate,
  groupAccreditationsByHour
} from "./build-event-report";

describe("event report metrics", () => {
  it("calculateAttendanceRate evita división por cero", () => {
    expect(calculateAttendanceRate(0, 10)).toBe(0);
    expect(calculateAttendanceRate(100, 50)).toBe(50);
  });

  it("calculateAbsenteeRate evita división por cero", () => {
    expect(calculateAbsenteeRate(0, 5)).toBe(0);
    expect(calculateAbsenteeRate(100, 25)).toBe(25);
  });
});

describe("groupAccreditationsByHour", () => {
  it("agrupa por buckets de 15 minutos en horario Argentina (UTC-3)", () => {
    // 13:07 ART → 13:00, 13:18 ART → 13:15, 13:46 ART → 13:45
    const dates = [
      new Date("2026-05-20T16:07:00Z"),
      new Date("2026-05-20T16:18:30Z"),
      new Date("2026-05-20T16:46:10Z"),
      new Date("2026-05-20T16:14:00Z")
    ];
    const result = groupAccreditationsByHour(dates);
    expect(result).toEqual([
      { label: "13:00", count: 2 },
      { label: "13:15", count: 1 },
      { label: "13:45", count: 1 }
    ]);
  });

  it("ignora fechas nulas y respeta el orden temporal", () => {
    const dates = [
      new Date("2026-05-20T17:30:00Z"),
      null,
      new Date("2026-05-20T16:00:00Z")
    ];
    const result = groupAccreditationsByHour(dates);
    expect(result.map((r) => r.label)).toEqual(["13:00", "14:30"]);
  });
});
