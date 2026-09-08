import { describe, expect, it } from "vitest";
import {
  attendanceFlagsForEventPerson,
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
      status: "Acreditado"
    });
    expect(attendanceFlagsForEventPerson({ source: "imported", status: "pending" })).toEqual({
      registered: true,
      attended: false,
      outOfBase: false,
      status: "Pendiente"
    });
    expect(attendanceFlagsForEventPerson({ source: "manual", status: "accredited" })).toEqual({
      registered: true,
      attended: true,
      outOfBase: true,
      status: "Fuera de base"
    });
  });
});
