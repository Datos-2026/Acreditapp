import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { EventReportAiAnalysis } from "@gcba/shared";
import { normalizeCuil, manualPersonSchema } from "@gcba/shared";
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

const router = Router();
router.use(requireAuth);
router.use(rejectInformadorExceptReportRead);

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

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV de acreditados. ?manualOnly=true → solo manual (fuera de base). ?importedOnly=true → solo desde base importada. */
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

    const rows = await prisma.eventPerson.findMany({
      where: {
        eventId: req.params.id,
        status: EventPersonStatus.accredited,
        ...sourceFilter
      },
      include: {
        person: true,
        accreditedByUser: { select: { name: true, email: true } }
      },
      orderBy: [{ accreditedAt: "desc" }, { updatedAt: "desc" }]
    });

    const header = [
      "CUIL",
      "Apellido",
      "Nombre",
      "DNI",
      "Email",
      "Telefono",
      "Empresa",
      "Cargo",
      "Origen_inscripcion",
      "Fuera_de_base",
      "Acreditado_el",
      "Acreditado_por",
      "Notas_acreditacion"
    ];

    const lines = rows.map((r) => {
      const origen = r.source === "manual" ? "manual" : "importado";
      const fueraDeBase = r.source === "manual" ? "si" : "no";
      const accAt = r.accreditedAt ? new Date(r.accreditedAt).toISOString() : "";
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
      ]
        .map(csvCell)
        .join(",");
    });

    const filename = manualOnly
      ? "acreditados-fuera-de-base.csv"
      : importedOnly
        ? "acreditados-desde-base.csv"
        : "acreditados-todos.csv";
    await createAuditLog({
      req,
      action: "event.export.accredited",
      entityType: "event",
      entityId: req.params.id,
      metadata: { manualOnly, importedOnly, rows: rows.length }
    });

    const body = "\uFEFF" + header.map(csvCell).join(",") + "\n" + lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
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

    const where = {
      eventId: req.params.id,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(accreditedByUserId ? { accreditedByUserId } : {}),
      ...(q
        ? {
            OR: [
              { person: { cuilNormalized: { contains: normalizeCuil(q) } } },
              { person: { firstName: { contains: q } } },
              { person: { lastName: { contains: q } } },
              { person: { dni: { contains: q } } }
            ]
          }
        : {})
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

router.get("/:id/people/search", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const cuil = normalizeCuil(String(req.query.cuil ?? ""));
    if (cuil.length !== 11) throw new AppError("CUIL inválido", 400);

    const person = await prisma.eventPerson.findFirst({
      where: {
        eventId: req.params.id,
        person: { cuilNormalized: cuil }
      },
      include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
    });

    if (!person) {
      res.status(404).json({ message: "No encontrado en este evento" });
      return;
    }
    res.json(person);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/people/manual", requireRoles("SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"), validateBody(manualPersonSchema), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const cuilNormalized = normalizeCuil(req.body.cuilRaw);
    const person = await prisma.person.upsert({
      where: { cuilNormalized },
      update: {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone,
        notes: req.body.notes
      },
      create: {
        cuilNormalized,
        cuilRaw: req.body.cuilRaw,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone,
        notes: req.body.notes
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
