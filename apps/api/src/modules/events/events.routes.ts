import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import * as XLSX from "xlsx";
import type { EventReportAiAnalysis } from "@gcba/shared";
import { normalizeCuil, manualPersonSchema, parseManualDocument, isValidCuil } from "@gcba/shared";
import { EventPersonStatus, EventStatus, Prisma, UserRole } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { rejectInformadorExceptReportRead } from "../../middlewares/informador-scope";
import { requireRoles } from "../../middlewares/rbac";
import { validateBody } from "../../middlewares/validate";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../middlewares/error-handler";
import { ensureEventAccess } from "./event-access";
import { ensureNotAlreadyAccredited } from "./event-logic";
import { buildEventReportPayload } from "../reports/build-event-report";
import { runGeminiEventAnalysis } from "../reports/gemini-event-analysis";
import { pickDirectoryEmail, toDirectoryPersonDto } from "../directory/directory-logic";
import {
  buildDirectoryLookupMap,
  buildTwoSheetsXlsxBuffer,
  personExportInclude as twoSheetsPersonInclude
} from "./two-sheets-export";

const router = Router();
router.use(requireAuth);
router.use(rejectInformadorExceptReportRead);

const PERSON_EXPORT_HEADER = [
  "CUIL",
  "Apellido",
  "Nombre",
  "DNI",
  "Email",
  "Telefono",
  "Ministerio",
  "Rol",
  "Origen_inscripcion",
  "Fuera_de_base",
  "Acreditado_el",
  "Acreditado_por",
  "Notas_acreditacion"
] as const;

const personExportInclude = {
  person: true,
  accreditedByUser: { select: { name: true, email: true } }
} as const;

type EventPersonExportRow = Prisma.EventPersonGetPayload<{ include: typeof personExportInclude }>;

function mapEventPersonToExportRow(r: EventPersonExportRow): string[] {
  const origen = r.source === "manual" ? "manual" : "importado";
  const fueraDeBase = r.source === "manual" ? "si" : "no";
  const accAt = r.accreditedAt
    ? new Date(r.accreditedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "";
  const by = r.accreditedByUser?.name ?? r.accreditedByUser?.email ?? "";
  return [
    r.person.cuilNormalized,
    r.person.lastName,
    r.person.firstName,
    r.person.dni ?? "",
    r.person.email ?? "",
    r.person.phone ?? "",
    r.person.company ?? "",
    r.person.position ?? "",
    origen,
    fueraDeBase,
    accAt,
    by,
    r.accreditationNotes ?? ""
  ];
}

function buildPersonExportXlsxBuffer(sheetName: string, dataRows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([Array.from(PERSON_EXPORT_HEADER), ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const eventSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  location: z.string().optional().nullable(),
  status: z.nativeEnum(EventStatus).default(EventStatus.draft)
});

const assignUsersSchema = z.object({
  userIds: z.array(z.string())
});

const manualFromDirectorySchema = z.object({
  cuilNormalized: z.string().length(11, "CUIL de 11 dígitos requerido")
});

const createEventStaffUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "Contraseña mínima de 8 caracteres"),
  role: z.enum([UserRole.ADMIN_EVENTO, UserRole.ACREDITADOR, UserRole.LECTURA, UserRole.INFORMADOR])
});

function slugFromEventName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Sufijo legible derivado del nombre del evento para incluir en nombres de archivo. */
function fileSuffixFromEvent(event: { slug?: string | null; name?: string | null } | null): string {
  if (!event) return "evento";
  const base = (event.slug && event.slug.length > 0 ? event.slug : slugFromEventName(event.name ?? "")) || "evento";
  return base.slice(0, 60) || "evento";
}

/** Lanza 409 si el evento ya está cerrado/archivado; usado para impedir acreditar después de cerrar. */
async function assertEventAcceptingAccreditations(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true }
  });
  if (!event) {
    throw new AppError("Evento no encontrado", 404);
  }
  if (event.status === EventStatus.closed || event.status === EventStatus.archived) {
    throw new AppError(
      "La acreditación del evento está cerrada. Reabrila desde Configuración para volver a acreditar.",
      409
    );
  }
}

router.get("/", async (req, res, next) => {
  try {
    const where =
      req.auth!.role === "SUPERADMIN"
        ? {}
        : {
            eventUsers: {
              some: { userId: req.auth!.id }
            }
          };
    const events = await prisma.event.findMany({
      where,
      include: {
        _count: {
          select: { eventPeople: true }
        },
        eventPeople: {
          where: { status: EventPersonStatus.accredited },
          select: { id: true }
        }
      },
      orderBy: { startAt: "desc" }
    });
    res.json(
      events.map((event: { _count: { eventPeople: number }; eventPeople: Array<{ id: string }> } & Record<string, unknown>) => ({
        ...event,
        totalPeople: event._count.eventPeople,
        accreditedPeople: event.eventPeople.length
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.post("/", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), validateBody(eventSchema), async (req, res, next) => {
  try {
    const event = await prisma.event.create({
      data: {
        ...req.body,
        slug: slugFromEventName(req.body.name)
      }
    });
    await createAuditLog({
      req,
      action: "event.create",
      entityType: "event",
      entityId: event.id
    });
    res.status(201).json(event);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      next(new AppError("Ya existe un evento con ese nombre o identificador", 409));
      return;
    }
    next(error);
  }
});

/** XLSX de acreditados. ?manualOnly=true → solo manual (fuera de base). ?importedOnly=true → solo desde base importada. */
router.get("/:id/export/accredited", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const manualOnly = String(req.query.manualOnly ?? "false") === "true";
    const importedOnly = String(req.query.importedOnly ?? "false") === "true";

    if (manualOnly && importedOnly) {
      res.status(400).json({ message: "No usar manualOnly e importedOnly a la vez" });
      return;
    }

    const sourceFilter =
      manualOnly ? ({ source: "manual" as const } as const)
      : importedOnly ? ({ source: "imported" as const } as const)
      : ({} as const);

    const [event, rows] = await Promise.all([
      prisma.event.findUnique({ where: { id: req.params.id }, select: { slug: true, name: true } }),
      prisma.eventPerson.findMany({
        where: {
          eventId: req.params.id,
          status: EventPersonStatus.accredited,
          ...sourceFilter
        },
        include: personExportInclude,
        orderBy: [{ accreditedAt: "desc" }, { updatedAt: "desc" }]
      })
    ]);

    const dataRows = rows.map(mapEventPersonToExportRow);

    const suffix = fileSuffixFromEvent(event);
    const filename = manualOnly
      ? `acreditados-fuera-de-base__${suffix}.xlsx`
      : importedOnly
        ? `acreditados-desde-base__${suffix}.xlsx`
        : `acreditados-todos__${suffix}.xlsx`;

    const buffer = buildPersonExportXlsxBuffer("Acreditados", dataRows);

    await createAuditLog({
      req,
      action: "event.export.accredited",
      entityType: "event",
      entityId: req.params.id,
      metadata: { manualOnly, importedOnly, rows: rows.length, format: "xlsx" }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/** XLSX con hojas ACREDITADOS y FUERA DE BASE (columnas dotación + operativas). */
router.get("/:id/export/two-sheets", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");

    const [event, accreditedRows] = await Promise.all([
      prisma.event.findUnique({ where: { id: req.params.id }, select: { slug: true, name: true } }),
      prisma.eventPerson.findMany({
        where: {
          eventId: req.params.id,
          status: EventPersonStatus.accredited
        },
        include: twoSheetsPersonInclude,
        orderBy: [{ accreditedAt: "desc" }, { updatedAt: "desc" }]
      })
    ]);

    const fueraDeBaseRows = accreditedRows.filter((r) => r.source === "manual");

    /** Lookup del directorio solo para las filas de FUERA DE BASE (la hoja ACREDITADOS no lleva columnas de dotación). */
    const cuils = [...new Set(fueraDeBaseRows.map((r) => r.person.cuilNormalized))];
    const dnis = [
      ...new Set(
        fueraDeBaseRows.map((r) => r.person.dni).filter((d): d is string => Boolean(d))
      )
    ];

    const directoryRows = await prisma.directoryPerson.findMany({
      where: {
        OR: [
          { cuilNormalized: { in: cuils } },
          ...(dnis.length > 0 ? [{ dni: { in: dnis } }] : [])
        ]
      }
    });
    const directoryMap = buildDirectoryLookupMap(directoryRows);
    const buffer = buildTwoSheetsXlsxBuffer(accreditedRows, fueraDeBaseRows, directoryMap);

    await createAuditLog({
      req,
      action: "event.export.twoSheets",
      entityType: "event",
      entityId: req.params.id,
      metadata: {
        accredited: accreditedRows.length,
        fueraDeBase: fueraDeBaseRows.length,
        format: "xlsx"
      }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="acreditacion-2-hojas__${fileSuffixFromEvent(event)}.xlsx"`
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/** XLSX de la nómina del evento (base importada). Mismas columnas que exportación de acreditados. */
router.get("/:id/export/people", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const importedOnly = String(req.query.importedOnly ?? "true") === "true";

    const [event, rows] = await Promise.all([
      prisma.event.findUnique({ where: { id: req.params.id }, select: { slug: true, name: true } }),
      prisma.eventPerson.findMany({
        where: {
          eventId: req.params.id,
          ...(importedOnly ? { source: "imported" as const } : {})
        },
        include: personExportInclude,
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
      })
    ]);

    const dataRows = rows.map(mapEventPersonToExportRow);
    const suffix = fileSuffixFromEvent(event);
    const filename = importedOnly
      ? `base-evento-importada__${suffix}.xlsx`
      : `nomina-evento-completa__${suffix}.xlsx`;
    const buffer = buildPersonExportXlsxBuffer("BASE", dataRows);

    await createAuditLog({
      req,
      action: "event.export.people",
      entityType: "event",
      entityId: req.params.id,
      metadata: { importedOnly, rows: rows.length, format: "xlsx" }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/** Informe post-evento: métricas + análisis IA guardado (si existe). */
router.get("/:id/report", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const payload = await buildEventReportPayload(req.params.id);
    if (!payload) {
      res.status(404).json({ message: "Evento no encontrado" });
      return;
    }
    const cache = await prisma.eventReportAiCache.findUnique({
      where: { eventId: req.params.id }
    });
    const aiAnalysis = cache?.analysis ? (cache.analysis as unknown as EventReportAiAnalysis) : null;
    res.json({
      ...payload,
      aiAnalysis: aiAnalysis && isValidAiAnalysisShape(aiAnalysis) ? aiAnalysis : null,
      aiAnalysisUpdatedAt: cache?.updatedAt.toISOString() ?? null
    });
  } catch (error) {
    next(error);
  }
});

function isValidAiAnalysisShape(x: EventReportAiAnalysis): boolean {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.executiveSummary === "string" &&
    Array.isArray(x.keyFindings)
  );
}

/** Genera o devuelve análisis cacheado. Body: `{ regenerate?: true }` fuerza nueva llamada a Gemini. */
router.post("/:id/report/ai", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const eventId = req.params.id;
    const regenerate = Boolean(req.body?.regenerate);

    const payload = await buildEventReportPayload(eventId);
    if (!payload) {
      res.status(404).json({ message: "Evento no encontrado" });
      return;
    }

    if (!regenerate) {
      const cached = await prisma.eventReportAiCache.findUnique({ where: { eventId } });
      if (cached?.analysis && isValidAiAnalysisShape(cached.analysis as EventReportAiAnalysis)) {
        res.json({
          ok: true as const,
          analysis: cached.analysis as unknown as EventReportAiAnalysis,
          fromCache: true as const
        });
        return;
      }
    }

    try {
      const analysis = await runGeminiEventAnalysis(payload);
      await prisma.eventReportAiCache.upsert({
        where: { eventId },
        create: { eventId, analysis: analysis as unknown as Prisma.InputJsonValue },
        update: { analysis: analysis as unknown as Prisma.InputJsonValue }
      });
      res.json({ ok: true as const, analysis, fromCache: false as const });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      res.status(200).json({
        ok: false as const,
        error: message,
        analysis: null,
        fromCache: false as const
      });
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { eventPeople: true }
        },
        eventPeople: {
          where: { status: EventPersonStatus.accredited },
          select: { id: true }
        },
        eventUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true
              }
            }
          }
        }
      }
    });
    res.json({
      ...event,
      totalPeople: event._count.eventPeople,
      accreditedPeople: event.eventPeople.length
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), validateBody(eventSchema.partial()), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const data: Prisma.EventUpdateInput = { ...req.body };
    if (typeof req.body.name === "string") {
      data.slug = slugFromEventName(req.body.name);
    }
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data
    });
    await createAuditLog({
      req,
      action: "event.update",
      entityType: "event",
      entityId: event.id,
      metadata: req.body
    });
    res.json(event);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      next(new AppError("Ya existe un evento con ese nombre o identificador", 409));
      return;
    }
    next(error);
  }
});

router.delete("/:id", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true }
    });
    if (!event) {
      res.status(404).json({ message: "Evento no encontrado" });
      return;
    }
    await prisma.event.delete({ where: { id: req.params.id } });
    await createAuditLog({
      req,
      action: "event.delete",
      entityType: "event",
      entityId: event.id,
      metadata: { name: event.name }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/:id/users", requireRoles("SUPERADMIN"), validateBody(assignUsersSchema), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    await prisma.eventUser.deleteMany({ where: { eventId: req.params.id } });
    await prisma.eventUser.createMany({
      data: req.body.userIds.map((userId: string) => ({
        eventId: req.params.id,
        userId
      }))
    });
    await createAuditLog({
      req,
      action: "event.assignUsers",
      entityType: "event",
      entityId: req.params.id,
      metadata: { userIds: req.body.userIds }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Crea un usuario operativo y lo agrega al acceso del evento en una sola transacción. */
router.post(
  "/:id/users/create-and-assign",
  requireRoles("SUPERADMIN"),
  validateBody(createEventStaffUserSchema),
  async (req, res, next) => {
    const eventId = req.params.id;
    try {
      await ensureEventAccess(eventId, req.auth!.id, req.auth!.role === "SUPERADMIN");

      const email = req.body.email.trim().toLowerCase();
      const { user, assignedUserIds } = await prisma.$transaction(async (tx) => {
        const passwordHash = await bcrypt.hash(req.body.password, 12);
        const created = await tx.user.create({
          data: {
            name: req.body.name.trim(),
            email,
            role: req.body.role,
            isActive: true,
            passwordHash
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true
          }
        });

        const existing = await tx.eventUser.findMany({
          where: { eventId },
          select: { userId: true }
        });
        const userIds = [...new Set([...existing.map((e) => e.userId), created.id])];

        await tx.eventUser.deleteMany({ where: { eventId } });
        await tx.eventUser.createMany({
          data: userIds.map((userId) => ({ eventId, userId }))
        });

        return { user: created, assignedUserIds: userIds };
      });

      await createAuditLog({
        req,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        metadata: { role: user.role, eventId, withEventAccess: true }
      });
      await createAuditLog({
        req,
        action: "event.assignUsers",
        entityType: "event",
        entityId: eventId,
        metadata: { userIds: assignedUserIds }
      });

      res.status(201).json(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        next(new AppError("Ya existe un usuario con ese email", 409));
        return;
      }
      next(error);
    }
  }
);

router.get("/:id/people", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const q = String(req.query.q ?? "").trim();
    const status = req.query.status as EventPersonStatus | undefined;
    const source = req.query.source as "imported" | "manual" | undefined;
    const accreditedByUserId = req.query.accreditedByUserId as string | undefined;

    const qDigits = q ? normalizeCuil(q) : "";
    const orFilters: Prisma.EventPersonWhereInput[] = [];
    if (q) {
      if (qDigits.length > 0) {
        orFilters.push({ person: { cuilNormalized: { contains: qDigits } } });
      }
      orFilters.push(
        { person: { firstName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
        { person: { lastName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
        { person: { dni: { contains: q, mode: Prisma.QueryMode.insensitive } } }
      );
    }

    const where = {
      eventId: req.params.id,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(accreditedByUserId ? { accreditedByUserId } : {}),
      ...(orFilters.length > 0 ? { OR: orFilters } : {})
    };

    const [total, rows] = await Promise.all([
      prisma.eventPerson.count({ where }),
      prisma.eventPerson.findMany({
        where,
        include: {
          person: true,
          accreditedByUser: { select: { id: true, name: true } }
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({ total, page, pageSize, rows });
  } catch (error) {
    next(error);
  }
});

const bulkDeletePeopleScopes = ["all", "accredited", "pending", "imported", "accredited_imported"] as const;
type BulkDeletePeopleScope = (typeof bulkDeletePeopleScopes)[number];

/** Elimina personas del evento en lote. ?scope=all|accredited|pending|imported */
router.delete(
  "/:id/people/bulk",
  requireRoles("SUPERADMIN", "ADMIN_EVENTO"),
  async (req, res, next) => {
    try {
      await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
      const scope = String(req.query.scope ?? "") as BulkDeletePeopleScope;
      if (!bulkDeletePeopleScopes.includes(scope)) {
        res.status(400).json({
          message: "Parámetro scope requerido: all, accredited, pending, imported o accredited_imported"
        });
        return;
      }

      const where: Prisma.EventPersonWhereInput = { eventId: req.params.id };
      if (scope === "accredited") where.status = EventPersonStatus.accredited;
      else if (scope === "pending") where.status = EventPersonStatus.pending;
      else if (scope === "imported") where.source = "imported";
      else if (scope === "accredited_imported") {
        where.status = EventPersonStatus.accredited;
        where.source = "imported";
      }

      const deleted = await prisma.eventPerson.deleteMany({ where });
      await createAuditLog({
        req,
        action: "eventPerson.bulkDelete",
        entityType: "event",
        entityId: req.params.id,
        metadata: { scope, deleted: deleted.count }
      });
      res.json({ deleted: deleted.count, scope });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:id/people/:eventPersonId",
  requireRoles("SUPERADMIN", "ADMIN_EVENTO"),
  async (req, res, next) => {
    try {
      await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
      const eventPerson = await prisma.eventPerson.findUnique({
        where: { id: req.params.eventPersonId },
        include: { person: { select: { firstName: true, lastName: true, cuilNormalized: true } } }
      });
      if (!eventPerson || eventPerson.eventId !== req.params.id) {
        res.status(404).json({ message: "Persona no encontrada en este evento" });
        return;
      }

      await prisma.eventPerson.delete({ where: { id: eventPerson.id } });
      await createAuditLog({
        req,
        action: "eventPerson.delete",
        entityType: "eventPerson",
        entityId: eventPerson.id,
        metadata: {
          eventId: req.params.id,
          cuil: eventPerson.person.cuilNormalized,
          status: eventPerson.status
        }
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/people/search", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const raw = String(req.query.cuil ?? req.query.dni ?? "").trim();
    const digits = normalizeCuil(raw);
    let personWhere: Prisma.PersonWhereInput;
    if (digits.length === 11) {
      if (!isValidCuil(digits)) throw new AppError("CUIL inválido", 400);
      personWhere = { cuilNormalized: digits };
    } else if (digits.length >= 6 && digits.length <= 8) {
      personWhere = { dni: digits };
    } else {
      throw new AppError("Ingresá un CUIL válido (11 dígitos) o un DNI (6 a 8 dígitos)", 400);
    }

    const eventPerson = await prisma.eventPerson.findFirst({
      where: {
        eventId: req.params.id,
        person: personWhere
      },
      include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
    });

    if (eventPerson) {
      res.json({ inEvent: true, eventPerson });
      return;
    }

    const directoryWhere: Prisma.DirectoryPersonWhereInput =
      digits.length === 11 ? { cuilNormalized: digits } : { dni: digits };

    const directoryPerson = await prisma.directoryPerson.findFirst({
      where: directoryWhere
    });

    if (directoryPerson) {
      res.json({
        inEvent: false,
        fromDirectory: true,
        directoryPerson: toDirectoryPersonDto(directoryPerson)
      });
      return;
    }

    res.status(404).json({ message: "No encontrado en este evento ni en el directorio GCBA" });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/people/manual-from-directory",
  requireRoles("SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"),
  validateBody(manualFromDirectorySchema),
  async (req, res, next) => {
    try {
      await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
      await assertEventAcceptingAccreditations(req.params.id);
      const cuilNormalized = normalizeCuil(req.body.cuilNormalized);
      if (!isValidCuil(cuilNormalized)) throw new AppError("CUIL inválido", 400);

      const directoryPerson = await prisma.directoryPerson.findUnique({
        where: { cuilNormalized }
      });
      if (!directoryPerson) {
        throw new AppError("No está en el directorio GCBA", 404);
      }

      const email = pickDirectoryEmail(directoryPerson);
      const existing = await prisma.person.findFirst({
        where: {
          OR: [
            { cuilNormalized },
            ...(directoryPerson.dni ? [{ dni: directoryPerson.dni }] : [])
          ]
        }
      });

      const person = existing
        ? await prisma.person.update({
            where: { id: existing.id },
            data: {
              cuilNormalized,
              cuilRaw: cuilNormalized,
              firstName: directoryPerson.firstName,
              lastName: directoryPerson.lastName,
              dni: directoryPerson.dni ?? existing.dni,
              email: email ?? existing.email,
              company: directoryPerson.ministerio ?? existing.company,
              position: directoryPerson.litPuesto ?? existing.position
            }
          })
        : await prisma.person.create({
            data: {
              cuilNormalized,
              cuilRaw: cuilNormalized,
              firstName: directoryPerson.firstName,
              lastName: directoryPerson.lastName,
              dni: directoryPerson.dni,
              email,
              company: directoryPerson.ministerio,
              position: directoryPerson.litPuesto
            }
          });

      const eventPerson = await prisma.eventPerson.upsert({
        where: {
          eventId_personId: {
            eventId: req.params.id,
            personId: person.id
          }
        },
        update: { source: "manual" },
        create: {
          eventId: req.params.id,
          personId: person.id,
          source: "manual"
        },
        include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
      });

      await createAuditLog({
        req,
        action: "eventPerson.manualFromDirectory",
        entityType: "eventPerson",
        entityId: eventPerson.id,
        metadata: { cuilNormalized }
      });

      res.status(201).json(eventPerson);
    } catch (error) {
      next(error);
    }
  }
);

router.post("/:id/people/manual", requireRoles("SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"), validateBody(manualPersonSchema), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    await assertEventAcceptingAccreditations(req.params.id);
    const doc = parseManualDocument(req.body.cuilRaw);
    const existing = await prisma.person.findFirst({
      where: {
        OR: [
          { cuilNormalized: doc.cuilNormalized },
          ...(doc.dni ? [{ dni: doc.dni }] : [])
        ]
      }
    });

    const personData = {
      cuilRaw: doc.cuilRaw,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      notes: req.body.notes,
      dni: doc.dni ?? existing?.dni ?? null
    };

    const person = existing
      ? await prisma.person.update({
          where: { id: existing.id },
          data: {
            ...personData,
            cuilNormalized: existing.cuilNormalized.length === 11 && isValidCuil(existing.cuilNormalized)
              ? existing.cuilNormalized
              : doc.cuilNormalized
          }
        })
      : await prisma.person.create({
          data: {
            cuilNormalized: doc.cuilNormalized,
            ...personData
          }
        });

    const eventPerson = await prisma.eventPerson.upsert({
      where: {
        eventId_personId: {
          eventId: req.params.id,
          personId: person.id
        }
      },
      update: {},
      create: {
        eventId: req.params.id,
        personId: person.id,
        source: "manual"
      },
      include: { person: true }
    });

    await createAuditLog({
      req,
      action: "eventPerson.manualCreate",
      entityType: "eventPerson",
      entityId: eventPerson.id
    });
    res.status(201).json(eventPerson);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/people/:eventPersonId/accredit", requireRoles("SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    await assertEventAcceptingAccreditations(req.params.id);
    const current = await prisma.eventPerson.findUniqueOrThrow({
      where: { id: req.params.eventPersonId }
    });
    if (current.eventId !== req.params.id) throw new AppError("Registro fuera de evento", 400);
    ensureNotAlreadyAccredited(current.status);

    const eventPerson = await prisma.eventPerson.update({
      where: { id: req.params.eventPersonId },
      data: {
        status: "accredited",
        accreditedAt: new Date(),
        accreditedByUserId: req.auth!.id,
        accreditationNotes: req.body?.notes ?? null
      },
      include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
    });
    await createAuditLog({
      req,
      action: "eventPerson.accredit",
      entityType: "eventPerson",
      entityId: eventPerson.id
    });
    res.json(eventPerson);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/people/:eventPersonId/reaccredit", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    await assertEventAcceptingAccreditations(req.params.id);
    const reason = z.string().min(5).parse(req.body?.reason);
    const eventPerson = await prisma.eventPerson.findUniqueOrThrow({
      where: { id: req.params.eventPersonId }
    });

    await prisma.accreditationOverride.create({
      data: {
        eventPersonId: eventPerson.id,
        reason,
        createdByUserId: req.auth!.id
      }
    });
    const updated = await prisma.eventPerson.update({
      where: { id: eventPerson.id },
      data: {
        status: "accredited",
        accreditedAt: new Date(),
        accreditedByUserId: req.auth!.id,
        accreditationNotes: reason
      },
      include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
    });
    await createAuditLog({
      req,
      action: "eventPerson.reaccredit",
      entityType: "eventPerson",
      entityId: updated.id,
      metadata: { reason }
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/activity", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const activity = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "event", entityId: req.params.id },
          { entityType: "eventPerson" }
        ]
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(activity);
  } catch (error) {
    next(error);
  }
});

export const eventsRoutes = router;
