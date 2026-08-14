import { describe, expect, it } from "vitest";
import {
  parseReferenteCell,
  splitReferenteName,
  syntheticCuilFromEmail
} from "@gcba/shared";

describe("parseReferenteCell", () => {
  it("parsea Nombre | mail | teléfono", () => {
    expect(
      parseReferenteCell("Mariela Maccarone | Mariela.maccarone@bue.edu.ar | 1162459013")
    ).toEqual({
      name: "Mariela Maccarone",
      email: "Mariela.maccarone@bue.edu.ar",
      phone: "1162459013",
      emailNormalized: "mariela.maccarone@bue.edu.ar",
      missingEmail: false
    });
  });

  it("agrupa por nombre si no hay mail", () => {
    const parsed = parseReferenteCell("Juan Perez | 1122334455");
    expect(parsed?.missingEmail).toBe(true);
    expect(parsed?.emailNormalized.startsWith("nombre:")).toBe(true);
    expect(parsed?.phone).toBe("1122334455");
  });
});

describe("splitReferenteName", () => {
  it("toma el último token como apellido", () => {
    expect(splitReferenteName("Guillermo GOMEZ ORTEGA")).toEqual({
      firstName: "Guillermo GOMEZ",
      lastName: "ORTEGA"
    });
  });
});

describe("syntheticCuilFromEmail", () => {
  it("es determinístico y usa prefijo 99", () => {
    const a = syntheticCuilFromEmail("Mariela.maccarone@bue.edu.ar");
    const b = syntheticCuilFromEmail("mariela.maccarone@bue.edu.ar");
    expect(a).toBe(b);
    expect(a.startsWith("99")).toBe(true);
    expect(a).toHaveLength(11);
  });
});
