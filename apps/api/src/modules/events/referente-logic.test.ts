import { describe, expect, it } from "vitest";
import {
  parseReferenteCell,
  splitReferenteName,
  syntheticCuilFromEmail
} from "@gcba/shared";

describe("parseReferenteCell", () => {
  it("parsea Nombre | mail | DNI", () => {
    expect(
      parseReferenteCell("Mariela Maccarone | Mariela.maccarone@bue.edu.ar | 30111222")
    ).toEqual({
      name: "Mariela Maccarone",
      email: "Mariela.maccarone@bue.edu.ar",
      dni: "30111222",
      emailNormalized: "mariela.maccarone@bue.edu.ar",
      missingEmail: false
    });
  });

  it("agrupa por DNI si no hay mail", () => {
    const parsed = parseReferenteCell("Juan Perez | 30111222");
    expect(parsed?.missingEmail).toBe(true);
    expect(parsed?.emailNormalized).toBe("dni:30111222");
    expect(parsed?.dni).toBe("30111222");
  });

  it("no exige DNI: solo nombre o nombre + mail", () => {
    expect(parseReferenteCell("Martín García")).toMatchObject({
      name: "Martín García",
      dni: null,
      missingEmail: true
    });
    expect(parseReferenteCell("Martín García | martin@mail.com")).toMatchObject({
      name: "Martín García",
      email: "martin@mail.com",
      dni: null,
      missingEmail: false
    });
  });

  it("acepta solo DNI como clave de grupo sin omitirlo", () => {
    const parsed = parseReferenteCell("30111222");
    expect(parsed).not.toBeNull();
    expect(parsed?.emailNormalized).toBe("dni:30111222");
    expect(parsed?.dni).toBe("30111222");
  });

  it("no traga el nombre si el DNI va sin pipes", () => {
    const parsed = parseReferenteCell("Martín García 30111222");
    expect(parsed?.name).toContain("Martín");
    expect(parsed?.emailNormalized.startsWith("nombre:")).toBe(true);
  });

  it("ignora un teléfono largo legado y no lo mete en el nombre", () => {
    const parsed = parseReferenteCell("Ana López | ana@mail.com | 1144556677");
    expect(parsed?.dni).toBeNull();
    expect(parsed?.name).toBe("Ana López");
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
