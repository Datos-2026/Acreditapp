import { describe, expect, it } from "vitest";
import {
  PERSONA_ESTADO_ACREDITADO,
  PERSONA_ESTADO_CONVOCADO,
  PERSONA_ESTADO_FUERA_DE_BASE,
  appendEventoAsistido,
  attendanceFlagsForEventPerson,
  mergePersonaEstado,
  normalizePersonaEstado,
  shouldIncludeEventPersonInBaseSync,
  shouldSyncToBaseOnStatusChange
} from "./policy";

describe("sincronización de BASE_ACREDITADOS al cerrar", () => {
  it("sincroniza al pasar de activo o borrador a cerrado", () => {
    expect(shouldSyncToBaseOnStatusChange("active", "closed")).toBe(true);
    expect(shouldSyncToBaseOnStatusChange("draft", "closed")).toBe(true);
  });

  it("no sincroniza eventos abiertos ni repite un cerrado sin transición", () => {
    expect(shouldSyncToBaseOnStatusChange("active", "active")).toBe(false);
    expect(shouldSyncToBaseOnStatusChange("closed", "closed")).toBe(false);
    expect(shouldSyncToBaseOnStatusChange("closed", "active")).toBe(false);
  });
});

describe("shouldIncludeEventPersonInBaseSync", () => {
  it("incluye todos los importados, acreditados o pendientes", () => {
    expect(shouldIncludeEventPersonInBaseSync({ source: "imported", status: "accredited" }, false)).toBe(true);
    expect(shouldIncludeEventPersonInBaseSync({ source: "imported", status: "pending" }, false)).toBe(true);
  });

  it("incluye fuera de base solo si está acreditado y en dotación", () => {
    expect(shouldIncludeEventPersonInBaseSync({ source: "manual", status: "accredited" }, true)).toBe(true);
    expect(shouldIncludeEventPersonInBaseSync({ source: "manual", status: "accredited" }, false)).toBe(false);
    expect(shouldIncludeEventPersonInBaseSync({ source: "manual", status: "pending" }, true)).toBe(false);
  });
});

describe("attendanceFlagsForEventPerson", () => {
  it("marca asistencia y estado según origen y acreditación", () => {
    expect(attendanceFlagsForEventPerson({ source: "imported", status: "accredited" })).toEqual({
      registered: true,
      attended: true,
      outOfBase: false,
      status: PERSONA_ESTADO_ACREDITADO
    });
    expect(attendanceFlagsForEventPerson({ source: "imported", status: "pending" })).toEqual({
      registered: true,
      attended: false,
      outOfBase: false,
      status: PERSONA_ESTADO_CONVOCADO
    });
    expect(attendanceFlagsForEventPerson({ source: "manual", status: "accredited" })).toEqual({
      registered: true,
      attended: true,
      outOfBase: true,
      status: PERSONA_ESTADO_FUERA_DE_BASE
    });
  });
});

describe("mergePersonaEstado", () => {
  it("deja Acreditado si la persona alguna vez se acreditó", () => {
    expect(mergePersonaEstado(PERSONA_ESTADO_CONVOCADO, PERSONA_ESTADO_ACREDITADO)).toBe(PERSONA_ESTADO_ACREDITADO);
    expect(mergePersonaEstado(PERSONA_ESTADO_ACREDITADO, PERSONA_ESTADO_CONVOCADO)).toBe(PERSONA_ESTADO_ACREDITADO);
    expect(mergePersonaEstado(PERSONA_ESTADO_FUERA_DE_BASE, PERSONA_ESTADO_ACREDITADO)).toBe(PERSONA_ESTADO_ACREDITADO);
  });

  it("prioriza Convocado no acreditado sobre Fuera de base", () => {
    expect(mergePersonaEstado(PERSONA_ESTADO_FUERA_DE_BASE, PERSONA_ESTADO_CONVOCADO)).toBe(PERSONA_ESTADO_CONVOCADO);
  });
});

describe("normalizePersonaEstado", () => {
  it("pasa Pendiente a Convocado no acreditado", () => {
    expect(normalizePersonaEstado("Pendiente")).toBe(PERSONA_ESTADO_CONVOCADO);
    expect(normalizePersonaEstado("Acreditado")).toBe(PERSONA_ESTADO_ACREDITADO);
  });
});

describe("appendEventoAsistido", () => {
  it("concatena eventos nuevos sin duplicar", () => {
    expect(appendEventoAsistido(null, "Eje Cuadrado")).toBe("Eje Cuadrado");
    expect(appendEventoAsistido("Eje Cuadrado", "Eje Cuidado")).toBe("Eje Cuadrado, Eje Cuidado");
    expect(appendEventoAsistido("Eje Cuadrado, Eje Cuidado", "eje cuadrado")).toBe("Eje Cuadrado, Eje Cuidado");
  });
});
