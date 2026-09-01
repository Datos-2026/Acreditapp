import { describe, expect, it } from "vitest";
import { isValidAcreditadosTableName, mysqlTableNameForEvent } from "./acreditados-mysql";

describe("mysqlTableNameForEvent", () => {
  it("genera un identificador MySQL seguro y único por evento", () => {
    const name = mysqlTableNameForEvent("Encuentro vecinos 2026", "clxyz123abcdefgh");
    expect(name).toBe("e_encuentro_vecinos_2026_abcdefgh");
    expect(isValidAcreditadosTableName(name)).toBe(true);
  });

  it("recorta nombres largos al límite de 64 caracteres", () => {
    const longSlug = "evento-institucional-de-acreditacion-masiva-ciudad-de-buenos-aires-2026";
    const name = mysqlTableNameForEvent(longSlug, "id12345678");
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("e_")).toBe(true);
    expect(isValidAcreditadosTableName(name)).toBe(true);
  });

  it("elimina acentos y caracteres inválidos", () => {
    const name = mysqlTableNameForEvent("Jornada de Vida Independiente!", "abc");
    expect(name).toMatch(/^e_jornada_de_vida_independiente_/);
    expect(name).not.toMatch(/[^a-z0-9_]/);
  });
});

describe("isValidAcreditadosTableName", () => {
  it("acepta tablas generadas y rechaza títulos de Sheets", () => {
    expect(isValidAcreditadosTableName("e_metro_cuadrado_abcd1234")).toBe(true);
    expect(isValidAcreditadosTableName("Encuentro vecinos")).toBe(false);
    expect(isValidAcreditadosTableName("Acreditados")).toBe(false);
    expect(isValidAcreditadosTableName("e_;drop table")).toBe(false);
    expect(isValidAcreditadosTableName(null)).toBe(false);
  });
});
