import { describe, expect, it } from "vitest";
import {
  formatEventSheetName,
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

describe("formatEventSheetName", () => {
  it("usa solo el nombre del evento", () => {
    const name = formatEventSheetName("Encuentro vecinos");
    expect(name).toBe("Encuentro vecinos");
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("trunca nombres largos al límite de Excel", () => {
    const longName = "Evento institucional de acreditación masiva 2026";
    expect(formatEventSheetName(longName).length).toBeLessThanOrEqual(31);
  });

  it("elimina caracteres inválidos de Excel", () => {
    expect(sanitizeSheetTitle("Evento [test]")).toBe("Evento test");
  });
});

describe("formatVecinoEventSheetName", () => {
  it("delega al nombre del evento sin fecha", () => {
    const name = formatVecinoEventSheetName(new Date("2026-06-16T12:00:00-03:00"), "Encuentro vecinos");
    expect(name).toBe("Encuentro vecinos");
    expect(name).not.toMatch(/16-06-2026/);
  });
});
