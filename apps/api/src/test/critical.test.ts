import { describe, expect, it } from "vitest";
import { normalizeCuil } from "@gcba/shared";
import { buildCuilSearch, ensureNotAlreadyAccredited } from "../modules/events/event-logic";
import { validateImportRow } from "../modules/imports/import-logic";
import { AppError } from "../middlewares/error-handler";

describe("backend critical", () => {
  it("login helpers: normaliza CUIL para búsqueda", () => {
    const normalized = normalizeCuil("20-12345678-3");
    const where = buildCuilSearch(normalized);
    expect(normalized).toBe("20123456783");
    expect(where.person.cuilNormalized).toBe("20123456783");
  });

  it("búsqueda por CUIL usa formato tolerante", () => {
    expect(normalizeCuil("20 12345678 3")).toBe("20123456783");
    expect(normalizeCuil("20-12345678-3")).toBe("20123456783");
  });

  it("bloquea doble acreditación", () => {
    expect(() => ensureNotAlreadyAccredited("pending")).not.toThrow();
    expect(() => ensureNotAlreadyAccredited("accredited")).toThrowError(AppError);
  });

  it("valida preview de importación", () => {
    const valid = validateImportRow({ cuil: "20-12345678-3", nombre: "Juan", apellido: "Perez" });
    const invalid = validateImportRow({ cuil: "20-1", nombre: "", apellido: "" });
    expect(valid).toHaveLength(0);
    expect(invalid.length).toBeGreaterThan(0);
  });
});
