import { describe, expect, it } from "vitest";
import {
  applyImportMappedValue,
  normalizeImportCanonical,
  normalizeImportSheetHeader,
  parseAyn,
  parseNombreApellido
} from "./import-logic";

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

describe("parseAyn (Apellido y Nombre)", () => {
  it("respeta el formato canónico con coma", () => {
    expect(parseAyn("PEREZ, JUAN")).toEqual({ apellido: "PEREZ", nombre: "JUAN" });
  });

  it("sin coma toma el primer token como apellido", () => {
    expect(parseAyn("PEREZ JUAN CARLOS")).toEqual({
      apellido: "PEREZ",
      nombre: "JUAN CARLOS"
    });
  });
});

describe("parseNombreApellido (Nombre y Apellido)", () => {
  it("toma el último token como apellido y el resto como nombres", () => {
    expect(parseNombreApellido("GUSTAVO BUSTAMANTE")).toEqual({
      nombre: "GUSTAVO",
      apellido: "BUSTAMANTE"
    });
    expect(parseNombreApellido("MARIA JOSE BUSTAMANTE")).toEqual({
      nombre: "MARIA JOSE",
      apellido: "BUSTAMANTE"
    });
  });

  it("si hay coma, asume formato canónico Apellido, Nombre", () => {
    expect(parseNombreApellido("BUSTAMANTE, GUSTAVO")).toEqual({
      apellido: "BUSTAMANTE",
      nombre: "GUSTAVO"
    });
  });

  it("token único cae como nombre", () => {
    expect(parseNombreApellido("GUSTAVO")).toEqual({ nombre: "GUSTAVO" });
  });
});

describe("normalizeImportCanonical con header 'Nombre y Apellido'", () => {
  it("derivar nombre y apellido desde nombreApellido cuando no vienen separados", () => {
    const result = normalizeImportCanonical({
      nombreApellido: "GUSTAVO BUSTAMANTE",
      cuil: "20181226227"
    });
    expect(result.nombre).toBe("GUSTAVO");
    expect(result.apellido).toBe("BUSTAMANTE");
  });

  it("no pisa nombre/apellido cuando ya vienen explícitos", () => {
    const result = normalizeImportCanonical({
      nombre: "Juan",
      apellido: "Pérez",
      nombreApellido: "Otra Cosa"
    });
    expect(result.nombre).toBe("Juan");
    expect(result.apellido).toBe("Pérez");
  });
});

describe("isImportNoiseColumn", () => {
  it("detecta columnas vacías generadas por Excel", async () => {
    const { isImportNoiseColumn } = await import("./import-logic");
    expect(isImportNoiseColumn("__EMPTY")).toBe(true);
    expect(isImportNoiseColumn("__EMPTY_1")).toBe(true);
    expect(isImportNoiseColumn("__EMPTY_14")).toBe(true);
    expect(isImportNoiseColumn("Nombre")).toBe(false);
    expect(isImportNoiseColumn("0")).toBe(false);
  });
});

describe("detectUniversalImportColumn", () => {
  it("mapea columnas de organizaciones, DNI y asistencia", async () => {
    const { detectUniversalImportColumn } = await import("./import-logic");
    expect(detectUniversalImportColumn("nombre de la organizacion")).toBe("empresa");
    expect(detectUniversalImportColumn("tipo de la organizacion")).toBe("cargo");
    expect(detectUniversalImportColumn("nombre y apellido")).toBe("nombreApellido");
    expect(detectUniversalImportColumn("dni")).toBe("dni");
    expect(detectUniversalImportColumn("asistio")).toBe("presente");
  });
});

describe("validateImportRow con DNI", () => {
  it("acepta fila GCBA solo con DNI (sin CUIL en planilla)", async () => {
    const { validateImportRow, normalizeImportCanonical } = await import("./import-logic");
    const canonical = normalizeImportCanonical({
      dni: "30123456",
      nombreApellido: "Juan Pérez"
    });
    expect(validateImportRow(canonical)).toEqual([]);
    expect(canonical.cuil).toBe("00030123456");
    expect(canonical.nombre).toBe("Juan");
    expect(canonical.apellido).toBe("Pérez");
  });

  it("rechaza fila sin CUIL ni DNI", async () => {
    const { validateImportRow } = await import("./import-logic");
    expect(validateImportRow({ nombre: "Ana", apellido: "García" })).toContain("CUIL o DNI inválido o faltante");
  });
});

describe("validateVecinoImportRow", () => {
  it("acepta fila con DNI, nombre y apellido", async () => {
    const { validateVecinoImportRow, normalizeVecinoImportCanonical } = await import("./import-logic");
    const canonical = normalizeVecinoImportCanonical({
      dni: "12345678",
      nombre: "Ana",
      apellido: "García"
    });
    expect(validateVecinoImportRow(canonical)).toEqual([]);
    expect(canonical.cuil).toBe("00012345678");
  });

  it("rechaza DNI inválido", async () => {
    const { validateVecinoImportRow } = await import("./import-logic");
    expect(validateVecinoImportRow({ dni: "123", nombre: "Ana", apellido: "García" })).toContain(
      "DNI inválido o faltante"
    );
  });
});
