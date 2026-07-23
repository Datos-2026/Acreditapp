import { Router } from "express";
import { z } from "zod";
import { EventKind, EventStatus, Prisma } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { AppError } from "../../middlewares/error-handler";
import { requireExternalApiKey } from "../../middlewares/external-api-key";
import { validateBody } from "../../middlewares/validate";

const router = Router();

router.use(requireExternalApiKey);

const createExternalEventSchema = z
  .object({
    /** Título del evento (único campo obligatorio). */
    name: z.string().min(3, "El título debe tener al menos 3 caracteres").max(200),
    description: z.string().max(2000).optional().nullable(),
    location: z.string().max(300).optional().nullable(),
    kind: z.enum(["gcba", "vecinos"]).optional().default("gcba"),
    status: z.nativeEnum(EventStatus).optional().default(EventStatus.draft),
    /** ISO datetime. Si no se envía, usa ahora. */
    startAt: z.string().datetime().optional(),
    /** ISO datetime. Si no se envía, usa startAt + 8 horas. */
    endAt: z.string().datetime().optional(),
    /** Habilitar asignación por mesas en la terminal. */
    enableMesas: z.boolean().optional().default(false),
    /** Cantidad de mesas (requerida si enableMesas es true). */
    mesaCount: z.number().int().min(1).max(100).optional().nullable(),
    /** Habilitar notas operativas post-acreditación. */
    enableNotes: z.boolean().optional().default(false),
    /** Enviar acreditados a Google Sheets. */
    enableGoogleSheets: z.boolean().optional().default(false)
  })
  .superRefine((data, ctx) => {
    if (data.enableMesas && (data.mesaCount == null || data.mesaCount < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mesaCount es obligatorio (mínimo 1) cuando enableMesas es true",
        path: ["mesaCount"]
      });
    }
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

async function uniqueSlugFromName(name: string): Promise<string> {
  const base = slugFromEventName(name) || "evento";
  let candidate = base.slice(0, 80);
  let n = 2;
  while (await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
    n += 1;
    if (n > 100) {
      candidate = `${base.slice(0, 60)}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}

/**
 * POST /api/v1/external/events
 * Crea un evento desde otro sistema. Solo requiere `name` (título).
 *
 * Headers:
 *   X-Api-Key: <EXTERNAL_EVENTS_API_KEY>
 *   Content-Type: application/json
 *
 * Body mínimo:
 *   { "name": "Mi evento" }
 */
router.post("/events", validateBody(createExternalEventSchema), async (req, res, next) => {
  try {
    const name = String(req.body.name).trim();
    const startAt = req.body.startAt ? new Date(req.body.startAt) : new Date();
    const endAt = req.body.endAt
      ? new Date(req.body.endAt)
      : new Date(startAt.getTime() + 8 * 60 * 60 * 1000);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new AppError("Fechas inválidas", 400);
    }
    if (endAt <= startAt) {
      throw new AppError("endAt debe ser posterior a startAt", 400);
    }

    const slug = await uniqueSlugFromName(name);
    const kind = (req.body.kind ?? "gcba") as EventKind;
    const status = (req.body.status ?? EventStatus.draft) as EventStatus;

    const enableMesas = Boolean(req.body.enableMesas);
    const enableNotes = Boolean(req.body.enableNotes);
    const enableGoogleSheets = Boolean(req.body.enableGoogleSheets);
    const mesaCount =
      enableMesas && req.body.mesaCount != null ? Number(req.body.mesaCount) : null;

    const event = await prisma.event.create({
      data: {
        name,
        slug,
        description: req.body.description ?? null,
        location: req.body.location ?? null,
        startAt,
        endAt,
        kind,
        status,
        enableMesas,
        enableNotes,
        enableGoogleSheets,
        mesaCount
      }
    });

    await createAuditLog({
      req,
      action: "event.create.external",
      entityType: "event",
      entityId: event.id,
      metadata: {
        source: "external_api",
        name: event.name,
        slug: event.slug,
        enableMesas,
        enableNotes,
        enableGoogleSheets,
        mesaCount
      }
    });

    logger.info({ eventId: event.id, name: event.name }, "Evento creado vía API externa");

    res.status(201).json({
      id: event.id,
      name: event.name,
      slug: event.slug,
      status: event.status,
      kind: event.kind,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      description: event.description,
      location: event.location,
      enableMesas: event.enableMesas,
      enableNotes: event.enableNotes,
      enableGoogleSheets: event.enableGoogleSheets,
      mesaCount: event.mesaCount,
      createdAt: event.createdAt.toISOString()
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      next(new AppError("Ya existe un evento con ese nombre o identificador", 409));
      return;
    }
    next(error);
  }
});

export const externalRoutes = router;
