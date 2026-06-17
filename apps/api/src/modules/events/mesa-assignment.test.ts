import { describe, expect, it } from "vitest";
import { parseMesaNumber } from "./mesa-assignment";

describe("parseMesaNumber", () => {
  it("parsea números y etiquetas Mesa N", () => {
    expect(parseMesaNumber("3")).toBe(3);
    expect(parseMesaNumber("Mesa 5")).toBe(5);
    expect(parseMesaNumber("mesa 12")).toBe(12);
  });

  it("rechaza vacío o sin dígitos", () => {
    expect(parseMesaNumber("")).toBeNull();
    expect(parseMesaNumber(null)).toBeNull();
    expect(parseMesaNumber("sin mesa")).toBeNull();
  });
});
