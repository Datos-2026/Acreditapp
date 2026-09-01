import { EventStatus } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  dumpEventPeopleToSpreadsheet,
  ensureEventGoogleSheet,
  EVENT_BASE_SHEET_NAME,
  isGoogleSheetsConfigured
} from "./google-sheets-sync";

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
    throw new Error("Google Sheets no configurado: no se archiva sin volcar la base");
  }
  const ref = await ensureEventGoogleSheet(event);
  if (!ref) {
    throw new Error("No se pudo crear el archivo de Google Sheets del evento");
  }
  const people = await prisma.eventPerson.findMany({
    where: { eventId: event.id },
    include: { person: true, accreditedByUser: { select: { id: true, name: true } } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
  });
  await dumpEventPeopleToSpreadsheet(ref.spreadsheetId, EVENT_BASE_SHEET_NAME, people);
  return { spreadsheetId: ref.spreadsheetId, sheetName: EVENT_BASE_SHEET_NAME };
}

async function purgeEventOperationalData(eventId: string, now: Date): Promise<void> {
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
        googleSheetName: EVENT_BASE_SHEET_NAME
      }
    });
  });
}

export async function archiveClosedEventsDue(now: Date = new Date()): Promise<{ archived: number; failed: number }> {
  const cutoff = new Date(now.getTime() - ARCHIVE_CLOSED_AFTER_MS);
  const events = await prisma.event.findMany({
    where: {
      status: EventStatus.closed,
      archivedToSheetsAt: null,
      closedAt: { lte: cutoff }
    },
    select: {
      id: true,
      name: true,
      googleSheetName: true,
      googleSpreadsheetId: true
    }
  });

  let archived = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const ref = await dumpEventBase(event);
      await prisma.event.update({
        where: { id: event.id },
        data: { googleSpreadsheetId: ref.spreadsheetId, googleSheetName: ref.sheetName }
      });
      await purgeEventOperationalData(event.id, now);
      archived += 1;
      logger.info({ eventId: event.id, spreadsheetId: ref.spreadsheetId }, "Evento archivado a Google Sheets");
    } catch (err) {
      failed += 1;
      logger.error({ err, eventId: event.id }, "No se pudo archivar el evento a Google Sheets");
    }
  }
  return { archived, failed };
}
