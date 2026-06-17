import { describe, expect, it } from "vitest";
import {
  formatVecinoEventSheetDate,
  formatVecinoEventSheetName,
  sanitizeSheetTitle
} from "./google-sheets-sync";

describe("formatVecinoEventSheetDate", () => {
  it("formatea en dd-MM-yyyy", () => {
    const d = new Date("2026-06-16T15:00:00.000Z");
    expect(formatVecinoEventSheetDate(d)).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });
});

describe("formatVecinoEventSheetName", () => {
  it("usa fecha y nombre del evento", () => {
    const name = formatVecinoEventSheetName(new Date("2026-06-16T12:00:00-03:00"), "Encuentro vecinos");
    expect(name).toContain("16");
    expect(name.toLowerCase()).toContain("encuentro");
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("elimina caracteres inválidos de Excel", () => {
    expect(sanitizeSheetTitle('16-06-2026 Evento [test]')).toBe("16-06-2026 Evento test");
  });
});
