import { describe, expect, it } from "vitest";
import { EventStatus } from "../../prisma-exports";
import { ARCHIVE_CLOSED_AFTER_MS, isEventDueForSheetsArchive } from "./archive-closed-events";

describe("isEventDueForSheetsArchive", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("archiva cerrado con más de 30 días", () => {
    expect(
      isEventDueForSheetsArchive(
        {
          status: EventStatus.closed,
          closedAt: new Date(now.getTime() - ARCHIVE_CLOSED_AFTER_MS - 1000),
          archivedToSheetsAt: null
        },
        now
      )
    ).toBe(true);
  });

  it("no archiva si aún no pasaron 30 días", () => {
    expect(
      isEventDueForSheetsArchive(
        {
          status: EventStatus.closed,
          closedAt: new Date(now.getTime() - ARCHIVE_CLOSED_AFTER_MS + 60_000),
          archivedToSheetsAt: null
        },
        now
      )
    ).toBe(false);
  });

  it("no archiva activos ni ya volcados", () => {
    expect(
      isEventDueForSheetsArchive(
        { status: EventStatus.active, closedAt: new Date("2020-01-01"), archivedToSheetsAt: null },
        now
      )
    ).toBe(false);
    expect(
      isEventDueForSheetsArchive(
        {
          status: EventStatus.closed,
          closedAt: new Date("2020-01-01"),
          archivedToSheetsAt: new Date("2026-08-01")
        },
        now
      )
    ).toBe(false);
  });

  it("no archiva cerrado sin closedAt", () => {
    expect(
      isEventDueForSheetsArchive({ status: EventStatus.closed, closedAt: null, archivedToSheetsAt: null }, now)
    ).toBe(false);
  });
});
