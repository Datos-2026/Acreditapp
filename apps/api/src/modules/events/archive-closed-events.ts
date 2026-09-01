import { EventStatus } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  buildGoogleSpreadsheetUrl,
  dumpEventPeopleToSpreadsheet,
  ensureEventGoogleSheet,
  formatGoogleSheetsError,
  isGoogleSheetsConfigured
} from "./google-sheets-sync";

export class ArchiveEventToSheetsError extends Error {
  code: "NOT_FOUND" | "ALREADY_ARCHIVED" | "SHEETS_UNAVAILABLE";

  constructor(message: string, code: ArchiveEventToSheetsError["code"]) {
    super(message);
    this.code = code;
  }
}

export const ARCHIVE_CLOSED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function isEventDueForSheetsArchive(
  event: {
    status: EventStatus | string;
    closedAt: Date | null;
    archivedToSheetsAt: Date | null;
  },
  now: Date = new Date()
): boolean {
  if (event.archivedToSheetsAt) return false;
  if (event.status !== EventStatus.closed && event.status !== "closed") return false;
  if (!event.closedAt) return false;
  return now.getTime() - event.closedAt.getTime() >= ARCHIVE_CLOSED_AFTER_MS;
}

async function dumpEventBase(event: {
  id: string;
  name: string;
  googleSheetName: string | null;
  googleSpreadsheetId: string | null;
}): Promise<{ spreadsheetId: string; sheetName: string }> {
  if (!isGoogleSheetsConfigured()) {
    throw new ArchiveEventToSheetsError(
      "Google Sheets no está configurado: no se puede volcar ni borrar la nómina.",
      "SHEETS_UNAVAILABLE"
    );
  }
  let ref;
  try {
    ref = await ensureEventGoogleSheet(event);
  } catch (err) {
    throw new ArchiveEventToSheetsError(formatGoogleSheetsError(err), "SHEETS_UNAVAILABLE");
  }
  if (!ref) {
    throw new ArchiveEventToSheetsError(
      "No se pudo crear el archivo de Google Sheets del evento.",
      "SHEETS_UNAVAILABLE"
    );
  }
  const people = await prisma.eventPerson.findMany({
    where: { eventId: event.id },
    include: { person: true, accreditedByUser: { select: { id: true, name: true } } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
  });
  try {
    await dumpEventPeopleToSpreadsheet(ref.spreadsheetId, ref.sheetName, people);
  } catch (err) {
    throw new ArchiveEventToSheetsError(formatGoogleSheetsError(err), "SHEETS_UNAVAILABLE");
  }
  return { spreadsheetId: ref.spreadsheetId, sheetName: ref.sheetName };
}

async function purgeEventOperationalData(eventId: string, now: Date, sheetName: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.eventPerson.updateMany({
      where: { eventId },
      data: { referenteId: null }
    });
    await tx.eventReferente.deleteMany({ where: { eventId } });
    await tx.eventPerson.deleteMany({ where: { eventId } });
    await tx.importBatch.deleteMany({ where: { eventId } });
    await tx.eventReportAiCache.deleteMany({ where: { eventId } });
    await tx.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.archived,
        archivedToSheetsAt: now,
        googleSheetName: sheetName
      }
    });
  });
}

export async function archiveEventToSheets(
  eventId: string,
  now: Date = new Date()
): Promise<{ spreadsheetId: string; googleSheetUrl: string | null }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      googleSheetName: true,
      googleSpreadsheetId: true,
      archivedToSheetsAt: true
    }
  });
  if (!event) {
    throw new ArchiveEventToSheetsError("Evento no encontrado", "NOT_FOUND");
  }
  if (event.archivedToSheetsAt) {
    throw new ArchiveEventToSheetsError(
      "Este evento ya fue volcado a Google Sheets y la nómina operativa se borró.",
      "ALREADY_ARCHIVED"
    );
  }
  const ref = await dumpEventBase(event);
  await prisma.event.update({
    where: { id: event.id },
    data: { googleSpreadsheetId: ref.spreadsheetId, googleSheetName: ref.sheetName }
  });
  await purgeEventOperationalData(event.id, now, ref.sheetName);
  logger.info({ eventId: event.id, spreadsheetId: ref.spreadsheetId }, "Evento archivado a Google Sheets");
  return {
    spreadsheetId: ref.spreadsheetId,
    googleSheetUrl: buildGoogleSpreadsheetUrl(ref.spreadsheetId)
  };
}

export async function archiveClosedEventsDue(now: Date = new Date()): Promise<{ archived: number; failed: number }> {
  const cutoff = new Date(now.getTime() - ARCHIVE_CLOSED_AFTER_MS);
  const events = await prisma.event.findMany({
    where: {
      status: EventStatus.closed,
      archivedToSheetsAt: null,
      closedAt: { lte: cutoff }
    },
    select: { id: true }
  });

  let archived = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await archiveEventToSheets(event.id, now);
      archived += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, eventId: event.id }, "No se pudo archivar el evento a Google Sheets");
    }
  }
  return { archived, failed };
}
