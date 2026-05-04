import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { PrismaClient, UserRole } from "../src/prisma-exports";
import { normalizeCuil } from "@gcba/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const prisma = new PrismaClient();

async function createUser(name: string, email: string, role: UserRole, password = "Password123!") {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash, isActive: true },
    create: { name, email, role, passwordHash, isActive: true }
  });
}

async function main() {
  const superadmin = await createUser("Super Admin", "superadmin@gcba.local", "SUPERADMIN");
  const ignacioSuperadmin = await createUser(
    "Ignacio",
    "ignaciorave21@gmail.com",
    "SUPERADMIN",
    "Ignacio21"
  );
  const admin1 = await createUser("Admin Evento 1", "admin1@gcba.local", "ADMIN_EVENTO");
  const admin2 = await createUser("Admin Evento 2", "admin2@gcba.local", "ADMIN_EVENTO");
  const accred1 = await createUser("Acreditador Uno", "acred1@gcba.local", "ACREDITADOR");
  const accred2 = await createUser("Acreditador Dos", "acred2@gcba.local", "ACREDITADOR");
  const accred3 = await createUser("Acreditador Tres", "acred3@gcba.local", "ACREDITADOR");
  const lector = await createUser("Usuario Lectura", "lectura@gcba.local", "LECTURA");

  const events = await Promise.all([
    prisma.event.upsert({
      where: { slug: "evento-20-7" },
      update: {},
      create: {
        name: "Evento 20/7",
        slug: "evento-20-7",
        description: "Operativo de acreditación institucional",
        startAt: new Date("2026-07-20T08:00:00-03:00"),
        endAt: new Date("2026-07-20T18:00:00-03:00"),
        status: "active",
        location: "Centro de Convenciones"
      }
    }),
    prisma.event.upsert({
      where: { slug: "expo-empleo" },
      update: {},
      create: {
        name: "Expo Empleo",
        slug: "expo-empleo",
        description: "Evento de empleo y capacitación",
        startAt: new Date("2026-08-10T09:00:00-03:00"),
        endAt: new Date("2026-08-10T17:00:00-03:00"),
        status: "draft",
        location: "La Rural"
      }
    }),
    prisma.event.upsert({
      where: { slug: "feria-innovacion" },
      update: {},
      create: {
        name: "Feria Innovación",
        slug: "feria-innovacion",
        description: "Encuentro de innovación pública",
        startAt: new Date("2026-09-01T08:30:00-03:00"),
        endAt: new Date("2026-09-01T16:30:00-03:00"),
        status: "closed",
        location: "Parque de la Innovación"
      }
    })
  ]);

  const users = [superadmin, ignacioSuperadmin, admin1, admin2, accred1, accred2, accred3, lector];
  for (const event of events) {
    for (const user of users) {
      await prisma.eventUser.upsert({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
        update: {},
        create: { eventId: event.id, userId: user.id }
      });
    }
  }

  const samplePeople = [
    ["20-12345678-3", "Juan", "Perez", "30111222"],
    ["27-22222222-6", "Maria", "Gomez", "27111222"],
    ["23-33333333-9", "Lucas", "Diaz", "33111222"],
    ["20-44444444-6", "Ana", "Lopez", "44111222"],
    ["20-55555555-3", "Pedro", "Sosa", "55111222"],
    ["27-66666666-6", "Carla", "Roman", "66111222"]
  ] as const;

  const importBatch = await prisma.importBatch.create({
    data: {
      eventId: events[0].id,
      uploadedByUserId: admin1.id,
      originalFilename: "base-evento-20-7.xlsx",
      sheetName: "Personas",
      totalRows: 6,
      validRows: 6,
      invalidRows: 0,
      duplicateRows: 0,
      importedRows: 6
    }
  });

  const importBatch2 = await prisma.importBatch.create({
    data: {
      eventId: events[1].id,
      uploadedByUserId: admin2.id,
      originalFilename: "expo-empleo.xlsx",
      sheetName: "Invitados",
      totalRows: 4,
      validRows: 3,
      invalidRows: 1,
      duplicateRows: 0,
      importedRows: 3
    }
  });

  for (let index = 0; index < samplePeople.length; index += 1) {
    const [cuilRaw, firstName, lastName, dni] = samplePeople[index];
    const person = await prisma.person.upsert({
      where: { cuilNormalized: normalizeCuil(cuilRaw) },
      update: { firstName, lastName, dni },
      create: {
        cuilRaw,
        cuilNormalized: normalizeCuil(cuilRaw),
        firstName,
        lastName,
        dni,
        email: `${firstName.toLowerCase()}@mail.com`,
        company: "GCBA",
        position: "Participante"
      }
    });
    const targetEvent = index % 2 === 0 ? events[0] : events[1];
    const eventPerson = await prisma.eventPerson.upsert({
      where: { eventId_personId: { eventId: targetEvent.id, personId: person.id } },
      update: {},
      create: {
        eventId: targetEvent.id,
        personId: person.id,
        source: "imported",
        importBatchId: targetEvent.id === events[0].id ? importBatch.id : importBatch2.id,
        status: index < 3 ? "accredited" : "pending",
        accreditedAt: index < 3 ? new Date() : null,
        accreditedByUserId: index < 3 ? accred1.id : null
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: index < 3 ? accred1.id : admin1.id,
        action: index < 3 ? "eventPerson.accredit" : "import.confirm",
        entityType: "eventPerson",
        entityId: eventPerson.id,
        metadata: { source: eventPerson.source }
      }
    });
  }

  const manual = await prisma.person.upsert({
    where: { cuilNormalized: normalizeCuil("20-77777777-0") },
    update: {},
    create: {
      cuilRaw: "20-77777777-0",
      cuilNormalized: normalizeCuil("20-77777777-0"),
      firstName: "Nadia",
      lastName: "FueraBase",
      dni: "77111222"
    }
  });
  const manualEventPerson = await prisma.eventPerson.upsert({
    where: { eventId_personId: { eventId: events[0].id, personId: manual.id } },
    update: { status: "accredited", accreditedByUserId: accred2.id, accreditedAt: new Date() },
    create: {
      eventId: events[0].id,
      personId: manual.id,
      source: "manual",
      status: "accredited",
      accreditedByUserId: accred2.id,
      accreditedAt: new Date()
    }
  });
  await prisma.auditLog.create({
    data: {
      userId: accred2.id,
      action: "eventPerson.manualCreate",
      entityType: "eventPerson",
      entityId: manualEventPerson.id
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
