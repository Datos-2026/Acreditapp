import { parseReferenteCell, splitReferenteName, syntheticCuilFromEmail } from "@gcba/shared";
import { Prisma } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { extractReferenteRaw } from "../imports/import-logic";

export async function upsertReferenteForImport(params: {
  eventId: string;
  extraData: Record<string, unknown>;
  importBatchId: string;
}): Promise<{ id: string; missingEmail: boolean } | null> {
  const parsed = parseReferenteCell(extractReferenteRaw(params.extraData));
  if (!parsed) return null;

  const { firstName, lastName } = splitReferenteName(parsed.name);
  const cuil = syntheticCuilFromEmail(parsed.emailNormalized);
  const email = parsed.email ?? null;
  const phone = parsed.phone ?? null;

  const person = await prisma.person.upsert({
    where: { cuilNormalized: cuil },
    create: {
      cuilNormalized: cuil,
      cuilRaw: parsed.emailNormalized,
      firstName,
      lastName,
      email,
      phone
    },
    update: {
      firstName,
      lastName,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {})
    }
  });

  const eventPerson = await prisma.eventPerson.upsert({
    where: { eventId_personId: { eventId: params.eventId, personId: person.id } },
    create: {
      eventId: params.eventId,
      personId: person.id,
      source: "imported",
      importBatchId: params.importBatchId,
      isReferente: true
    },
    update: {
      isReferente: true,
      importBatchId: params.importBatchId
    }
  });

  const referente = await prisma.eventReferente.upsert({
    where: {
      eventId_emailNormalized: {
        eventId: params.eventId,
        emailNormalized: parsed.emailNormalized
      }
    },
    create: {
      eventId: params.eventId,
      name: parsed.name,
      email: parsed.email ?? "",
      emailNormalized: parsed.emailNormalized,
      phone,
      eventPersonId: eventPerson.id
    },
    update: {
      name: parsed.name,
      email: parsed.email ?? "",
      phone,
      eventPersonId: eventPerson.id
    }
  });

  return { id: referente.id, missingEmail: parsed.missingEmail };
}

export function summarizeReferentesFromRows(
  rows: Array<{ extraData: Record<string, unknown>; errors: string[] }>
): Array<{ name: string; email: string | null; peopleCount: number; missingEmail: boolean }> {
  const map = new Map<
    string,
    { name: string; email: string | null; peopleCount: number; missingEmail: boolean }
  >();
  for (const row of rows) {
    if (row.errors.length > 0) continue;
    const parsed = parseReferenteCell(extractReferenteRaw(row.extraData));
    if (!parsed) continue;
    const prev = map.get(parsed.emailNormalized);
    if (prev) {
      prev.peopleCount += 1;
    } else {
      map.set(parsed.emailNormalized, {
        name: parsed.name,
        email: parsed.email,
        peopleCount: 1,
        missingEmail: parsed.missingEmail
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function extraDataJson(
  extra: Record<string, unknown>
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return Object.keys(extra).length > 0 ? (extra as Prisma.InputJsonValue) : Prisma.JsonNull;
}
