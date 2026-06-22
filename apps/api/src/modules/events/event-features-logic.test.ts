import { describe, expect, it } from "vitest";

import { AppError } from "../../middlewares/error-handler";
import { mesasActive, normalizeEventFeatures } from "./event-features-logic";

describe("event-features-logic", () => {
  it("exige mesaCount si enableMesas está activo", () => {
    expect(() => normalizeEventFeatures({ enableMesas: true })).toThrow(AppError);
    expect(() => normalizeEventFeatures({ enableMesas: true, mesaCount: 0 })).toThrow(AppError);
  });

  it("normaliza mesas desactivadas con mesaCount null", () => {
    expect(normalizeEventFeatures({ enableMesas: false, enableNotes: true })).toEqual({
      enableMesas: false,
      enableNotes: true,
      mesaCount: null
    });
  });

  it("detecta mesas activas", () => {
    expect(mesasActive({ enableMesas: true, mesaCount: 6 })).toBe(true);
    expect(mesasActive({ enableMesas: false, mesaCount: 6 })).toBe(false);
    expect(mesasActive({ enableMesas: true, mesaCount: null })).toBe(false);
  });
});
