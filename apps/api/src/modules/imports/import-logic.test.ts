import { describe, expect, it } from "vitest";
import { applyImportMappedValue, normalizeImportSheetHeader } from "./import-logic";

describe("normalizeImportSheetHeader", () => {
  it("unifica barra ancha tipo Excel en nombre/s y apellido/s", () => {
    expect(normalizeImportSheetHeader("Nombre／s")).toBe("nombre/s");
    expect(normalizeImportSheetHeader("Apellido／s")).toBe("apellido/s");
  });
});

describe("applyImportMappedValue", () => {
  it("no pisa nombre con celda vacía posterior", () => {
    const c: Record<string, unknown> = {};
    applyImportMappedValue(c, "nombre", "Raúl");
    applyImportMappedValue(c, "nombre", "");
    expect(c.nombre).toBe("Raúl");
  });

  it("concatena dos columnas en empresa", () => {
    const c: Record<string, unknown> = {};
    applyImportMappedValue(c, "empresa", "Sec A");
    applyImportMappedValue(c, "empresa", "Dir B");
    expect(c.empresa).toBe("Sec A · Dir B");
  });
});
