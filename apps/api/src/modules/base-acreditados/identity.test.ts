import { describe, expect, it } from "vitest";
import {
  isValidCuil,
  normalizeEventFingerprint,
  resolveIdentity
} from "./identity";

describe("identidad única de BASE_ACREDITADOS", () => {
  it("prioriza CUIL válido sobre los demás datos", () => {
    expect(isValidCuil("20-12345678-6")).toBe(true);
    expect(
      resolveIdentity({
        cuil: "20-12345678-6",
        dni: "87654321",
        email: "persona@ejemplo.com",
        phone: "11 4444 5555"
      })
    ).toMatchObject({
      key: "cuil:20123456786",
      quality: "cuil",
      cuil: "20123456786",
      dni: "87654321"
    });
  });

  it("usa DNI, email y teléfono como fallback en ese orden", () => {
    expect(resolveIdentity({ cuil: "invalido", dni: "12.345.678", email: "a@b.com" }).key).toBe(
      "dni:12345678"
    );
    expect(resolveIdentity({ cuil: "invalido", email: " Persona@Ejemplo.COM " }).key).toBe(
      "email:persona@ejemplo.com"
    );
    expect(resolveIdentity({ phone: "+54 11 4444-5555" }).key).toBe("telefono:541144445555");
  });

  it("no fusiona filas sin una clave confiable", () => {
    const first = resolveIdentity({ fallbackSeed: "archivo:fila:1" });
    const second = resolveIdentity({ fallbackSeed: "archivo:fila:2" });
    expect(first.quality).toBe("sin_clave_confiable");
    expect(first.key).not.toBe(second.key);
  });

  it("normaliza nombre y fecha para deduplicar eventos", () => {
    expect(normalizeEventFingerprint("  Metro Cuadrado ", "2026-05-20")).toBe(
      "metro cuadrado|2026-05-20"
    );
  });
});

