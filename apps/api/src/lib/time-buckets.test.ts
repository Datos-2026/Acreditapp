import { describe, expect, it } from "vitest";
import { arBucketKey, arBucketLabelHm } from "./time-buckets";

describe("time-buckets", () => {
  it("arBucketKey redondea al cuarto de hora inferior en horario Argentina", () => {
    // 13:07 ART (16:07Z) → 13:00 ART
    expect(arBucketKey(new Date("2026-05-20T16:07:00Z"))).toBe("2026-05-20T13:00");
    // 13:14 ART → 13:00 ART
    expect(arBucketKey(new Date("2026-05-20T16:14:59Z"))).toBe("2026-05-20T13:00");
    // 13:15 ART → 13:15 ART
    expect(arBucketKey(new Date("2026-05-20T16:15:00Z"))).toBe("2026-05-20T13:15");
    // 13:59 ART → 13:45 ART
    expect(arBucketKey(new Date("2026-05-20T16:59:00Z"))).toBe("2026-05-20T13:45");
  });

  it("arBucketLabelHm devuelve solo hh:mm en horario Argentina", () => {
    expect(arBucketLabelHm(new Date("2026-05-20T16:32:00Z"))).toBe("13:30");
  });

  it("admite granularidades alternativas dentro del rango válido", () => {
    expect(arBucketKey(new Date("2026-05-20T16:07:00Z"), 5)).toBe("2026-05-20T13:05");
    // Granularidad inválida cae al default (15 min).
    expect(arBucketKey(new Date("2026-05-20T16:07:00Z"), 0)).toBe("2026-05-20T13:00");
  });
});
