import { describe, expect, it } from "vitest";
import { calculateAbsenteeRate, calculateAttendanceRate } from "./build-event-report";

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
