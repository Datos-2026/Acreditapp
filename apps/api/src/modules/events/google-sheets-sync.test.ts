import { describe, expect, it } from "vitest";
import {
  formatEventSheetName,
  formatVecinoEventSheetDate,
  formatVecinoEventSheetName,
  sanitizeSheetTitle,
  buildArchiveSheetRow,
  buildGoogleSpreadsheetUrl
} from "./google-sheets-sync";

describe("formatVecinoEventSheetDate", () => {
  it("formatea en dd-MM-yyyy", () => {
    const d = new Date("2026-06-16T15:00:00.000Z");
    expect(formatVecinoEventSheetDate(d)).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });
});

describe("formatEventSheetName", () => {
  it("usa solo el nombre del evento", () => {
    const name = formatEventSheetName("Encuentro vecinos");
    expect(name).toBe("Encuentro vecinos");
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("trunca nombres largos al límite de Excel", () => {
    const longName = "Evento institucional de acreditación masiva 2026";
    expect(formatEventSheetName(longName).length).toBeLessThanOrEqual(31);
  });

  it("elimina caracteres inválidos de Excel", () => {
    expect(sanitizeSheetTitle("Evento [test]")).toBe("Evento test");
  });
});

describe("formatVecinoEventSheetName", () => {
  it("delega al nombre del evento sin fecha", () => {
    const name = formatVecinoEventSheetName(new Date("2026-06-16T12:00:00-03:00"), "Encuentro vecinos");
    expect(name).toBe("Encuentro vecinos");
    expect(name).not.toMatch(/16-06-2026/);
  });
});

describe("buildGoogleSpreadsheetUrl", () => {
  it("arma la URL del archivo del evento", () => {
    expect(buildGoogleSpreadsheetUrl("abc123")).toBe("https://docs.google.com/spreadsheets/d/abc123/edit");
  });

  it("no inventa URL si el evento no tiene spreadsheet", () => {
    expect(buildGoogleSpreadsheetUrl(null)).toBeNull();
    expect(buildGoogleSpreadsheetUrl("  ")).toBeNull();
  });
});

describe("buildArchiveSheetRow", () => {
  it("incluye estado y documento", () => {
    const row = buildArchiveSheetRow({
      id: "ep1",
      eventId: "ev1",
      personId: "p1",
      source: "imported",
      importBatchId: null,
      status: "accredited",
      accreditedAt: new Date("2026-08-01T15:00:00.000Z"),
      accreditedByUserId: "u1",
      accreditationNotes: null,
      eventNotes: null,
      extraData: { mesa: 2, Escuela: "N° 1" },
      isReferente: false,
      referenteId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      person: {
        id: "p1",
        cuilNormalized: "20123456789",
        cuilRaw: "20-12345678-9",
        dni: "12345678",
        firstName: "Ana",
        lastName: "Local",
        email: "ana@test.com",
        phone: "1100000000",
        company: "GCBA",
        position: "Rol",
        address: "Calle 1",
        comuna: "1",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      accreditedByUser: { id: "u1", name: "Operador" }
    } as never);
    expect(row[0]).toBe("12345678");
    expect(row[2]).toBe("Local");
    expect(row[10]).toBe("Acreditado");
    expect(row[12]).toBe("2");
    expect(row[15]).toBe("N° 1");
  });
});
