import bcrypt from "bcrypt";
import { syntheticCuilFromDni } from "@gcba/shared";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { logger } from "./logger";

/** Slug fijo: el listado de producción lo oculta. */
export const LOCAL_DEV_EVENT_SLUG = "local-dev-only";

const LOCAL_DEV_EMAIL = "dev.local@localhost";

export function isDevSkipAuth(): boolean {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") {
    return false;
  }
  return Boolean(env.DEV_SKIP_AUTH);
}

export type LocalDevUser = {
  id: string;
  role: "SUPERADMIN";
  email: string;
  name: string;
};

let cachedUser: LocalDevUser | null = null;
let ensurePromise: Promise<LocalDevUser> | null = null;

export async function ensureLocalDevWorkspace(): Promise<LocalDevUser> {
  if (cachedUser) return cachedUser;
  if (!ensurePromise) {
    ensurePromise = provisionLocalDevWorkspace().finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

async function provisionLocalDevWorkspace(): Promise<LocalDevUser> {
  const passwordHash = await bcrypt.hash("local-dev-only", 10);
  const user = await prisma.user.upsert({
    where: { email: LOCAL_DEV_EMAIL },
    update: { name: "Dev Local", role: "SUPERADMIN", isActive: true },
    create: {
      name: "Dev Local",
      email: LOCAL_DEV_EMAIL,
      role: "SUPERADMIN",
      passwordHash,
      isActive: true
    }
  });

  const event = await prisma.event.upsert({
    where: { slug: LOCAL_DEV_EVENT_SLUG },
    update: {
      name: "Evento local (solo dev)",
      status: "active",
      enableReferentes: true
    },
    create: {
      name: "Evento local (solo dev)",
      slug: LOCAL_DEV_EVENT_SLUG,
      description: "Sandbox local. No aparece en producción.",
      startAt: new Date(),
      endAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      status: "active",
      location: "Local",
      kind: "gcba",
      enableReferentes: true
    }
  });

  await prisma.eventUser.upsert({
    where: { eventId_userId: { eventId: event.id, userId: user.id } },
    update: {},
    create: { eventId: event.id, userId: user.id }
  });

  const peopleCount = await prisma.eventPerson.count({ where: { eventId: event.id } });
  if (peopleCount === 0) {
    const samples = [
      { dni: "90000001", firstName: "Ana", lastName: "Local" },
      { dni: "90000002", firstName: "Bruno", lastName: "Prueba" },
      { dni: "90000003", firstName: "Carla", lastName: "Dev" }
    ];
    for (const sample of samples) {
      const cuilNormalized = syntheticCuilFromDni(sample.dni);
      const person = await prisma.person.upsert({
        where: { cuilNormalized },
        update: { firstName: sample.firstName, lastName: sample.lastName, dni: sample.dni },
        create: {
          cuilNormalized,
          cuilRaw: cuilNormalized,
          dni: sample.dni,
          firstName: sample.firstName,
          lastName: sample.lastName,
          company: "Dev",
          position: "Prueba local"
        }
      });
      await prisma.eventPerson.upsert({
        where: { eventId_personId: { eventId: event.id, personId: person.id } },
        update: {},
        create: {
          eventId: event.id,
          personId: person.id,
          source: "imported",
          status: "pending"
        }
      });
    }
  }

  const localUser: LocalDevUser = {
    id: user.id,
    role: "SUPERADMIN",
    email: user.email,
    name: user.name
  };
  cachedUser = localUser;
  logger.info({ eventSlug: LOCAL_DEV_EVENT_SLUG, email: LOCAL_DEV_EMAIL }, "Dev skip-auth listo");
  return localUser;
}
