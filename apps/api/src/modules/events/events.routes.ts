import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import * as XLSX from "xlsx";
import type { EventReportAiAnalysis } from "@gcba/shared";
import { normalizeCuil, manualPersonSchema, parseManualDocument, isValidCuil, dniFromCuil, normalizeDni, syntheticCuilFromDni, displayPersonDocument, documentColumnLabel } from "@gcba/shared";
import { EventKind, EventPersonStatus, EventStatus, Prisma, UserRole } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { rejectInformadorExceptReportRead } from "../../middlewares/informador-scope";
import { requireRoles } from "../../middlewares/rbac";
import { validateBody } from "../../middlewares/validate";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { AppError } from "../../middlewares/error-handler";
import { ensureEventAccess } from "./event-access";
import {
  assertEventKindForRole,
  assertRoleCanCreateEventKind,
  eventsListWhere,
  isSuperAdmin,
  VECINOS_CREATABLE_ROLES
} from "./event-kind-access";
import { ensureNotAlreadyAccredited, extraDataWithoutMesa } from "./event-logic";
import { mesasActive, normalizeEventFeatures, googleSheetsActive } from "./event-features-logic";
import { buildEventReportPayload } from "../reports/build-event-report";
import { runGeminiEventAnalysis } from "../reports/gemini-event-analysis";
import { pickDirectoryEmail, toDirectoryPersonDto } from "../directory/directory-logic";
import { toVecinoDirectoryPersonDto } from "../directory/vecino-directory-logic";
import {
  buildDirectoryLookupMap,
  buildTwoSheetsXlsxBuffer,
  personExportInclude as twoSheetsPersonInclude
} from "./two-sheets-export";
import {
  getMesaStats,
  mergeMesaIntoExtraData,
  mesaLabel,
  parseMesaNumber
} from "./mesa-assignment";
import {
  appendVecinoAccreditationToSheet,
  buildGoogleSpreadsheetUrl,
  createEventGoogleSheet,
  ensureEventGoogleSheet,
  formatGoogleSheetsError,
  getVecinoSheetError,
  isGoogleSheetsConfigured,
  isUnprovisionedSheetName,
  recordVecinoSheetError
} from "./google-sheets-sync";

const router = Router();
router.use(requireAuth);
router.use(rejectInformadorExceptReportRead);

function authIsSuperAdmin(role: string): boolean {
  return isSuperAdmin(role);
}

async function ensureAccess(eventId: string, userId: string, role: string): Promise<void> {
  await ensureEventAccess(eventId, userId, authIsSuperAdmin(role), role);
}

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
  "Notas_acreditacion",
  "Notas_evento"
] as const;

const personExportInclude = {
  person: true,
  accreditedByUser: { select: { name: true, email: true } }
} as const;

type EventPersonExportRow = Prisma.EventPersonGetPayload<{ include: typeof personExportInclude }>;

function mapEventPersonToExportRow(r: EventPersonExportRow, eventKind: EventKind): string[] {
  const origen = r.source === "manual" ? "manual" : "importado";
  const fueraDeBase = r.source === "manual" ? "si" : "no";
  const accAt = r.accreditedAt
    ? new Date(r.accreditedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "";
  const by = r.accreditedByUser?.name ?? r.accreditedByUser?.email ?? "";
  return [
    displayPersonDocument(r.person, eventKind),
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
    r.accreditationNotes ?? "",
    r.eventNotes ?? ""
  ];
}

function buildPersonExportXlsxBuffer(sheetName: string, dataRows: string[][], eventKind: EventKind): Buffer {
  const header: string[] = [...PERSON_EXPORT_HEADER];
  header[0] = documentColumnLabel(eventKind);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
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
  status: z.nativeEnum(EventStatus).default(EventStatus.draft),
  kind: z.enum(["gcba", "vecinos"]).default("gcba"),
  enableMesas: z.boolean().default(false),
  enableNotes: z.boolean().default(false),
  enableGoogleSheets: z.boolean().default(false),
  mesaCount: z.number().int().min(1).max(99).optional().nullable(),
  googleSheetName: z.string().max(100).optional().nullable()
});

const eventPatchSchema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().optional().nullable(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  location: z.string().optional().nullable(),
  status: z.nativeEnum(EventStatus).optional(),
  kind: z.enum(["gcba", "vecinos"]).optional(),
  enableMesas: z.boolean().optional(),
  enableNotes: z.boolean().optional(),
  enableGoogleSheets: z.boolean().optional(),
  mesaCount: z.number().int().min(1).max(99).optional().nullable(),
  googleSheetName: z.string().max(100).optional().nullable()
});

const eventNotesBodySchema = z.object({
  eventNotes: z.string().optional().nullable()
});

const meetingMinutesBodySchema = z.object({
  meetingMinutes: z.string().optional().nullable()
});

const vecinosMesaConfigSchema = z.object({
  mesaCount: z.number().int().min(1).max(99)
});

const accreditBodySchema = z.object({
  notes: z.string().optional().nullable(),
  mesa: z.coerce.number().int().min(1).max(99).optional()
});

const assignUsersSchema = z.object({
  userIds: z.array(z.string())
});

const manualFromDirectorySchema = z
  .object({
    cuilNormalized: z.string().optional(),
    dni: z.string().optional()
  })
  .refine((data) => Boolean(data.cuilNormalized || data.dni), {
    message: "Se requiere CUIL o DNI"
  });

const createEventStaffUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "Contraseña mínima de 8 caracteres"),
  role: z.enum([
    UserRole.ADMIN_EVENTO,
    UserRole.ACREDITADOR,
    UserRole.LECTURA,
    UserRole.INFORMADOR
  ])
});

const ACCREDIT_ROLES = ["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS", "ACREDITADOR"] as const;
const MANAGE_EVENT_ROLES = ["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS"] as const;

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

function googleSheetsResponseFields(event: {
  enableGoogleSheets?: boolean | null;
  googleSheetName?: string | null;
}) {
  const enableGoogleSheets = Boolean(event.enableGoogleSheets);
  const googleSheetName = isUnprovisionedSheetName(event.googleSheetName) ? null : event.googleSheetName ?? null;
  return {
    googleSheetName,
    googleSheetUrl:
      enableGoogleSheets && isGoogleSheetsConfigured() ? buildGoogleSpreadsheetUrl() : null
  };
}

function mapEventListItem(
  event: { _count: { eventPeople: number }; eventPeople: Array<{ id: string }> } & Record<string, unknown>
) {
  return {
    ...event,
    totalPeople: event._count.eventPeople,
    accreditedPeople: event.eventPeople.length,
    ...googleSheetsResponseFields({
      enableGoogleSheets: event.enableGoogleSheets as boolean | null | undefined,
      googleSheetName: event.googleSheetName as string | null | undefined
    })
  };
}

router.get("/", async (req, res, next) => {
  try {
    const where = eventsListWhere(req.auth!.id, req.auth!.role);
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
    res.json(events.map(mapEventListItem));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requireRoles("SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS"),
  validateBody(eventSchema),
  async (req, res, next) => {
  try {
    const kind = (req.body.kind ?? "gcba") as EventKind;
    assertRoleCanCreateEventKind(req.auth!.role, kind);

    let googleSheetName: string | null = null;
    const enableGoogleSheets = Boolean(req.body.enableGoogleSheets);
    if (enableGoogleSheets && isGoogleSheetsConfigured()) {
      try {
        googleSheetName = await createEventGoogleSheet(req.body.name);
      } catch (err) {
        logger.warn({ err, eventName: req.body.name }, "No se pudo crear hoja en Google Sheets al crear evento");
      }
    }

    const features = normalizeEventFeatures({
      enableMesas: req.body.enableMesas,
      enableNotes: req.body.enableNotes,
      mesaCount: req.body.mesaCount
    });

    const event = await prisma.event.create({
      data: {
        name: req.body.name,
        description: req.body.description ?? null,
        startAt: req.body.startAt,
        endAt: req.body.endAt,
        location: req.body.location ?? null,
        status: req.body.status ?? EventStatus.draft,
        kind,
        slug: slugFromEventName(req.body.name),
        googleSheetName,
        enableGoogleSheets,
        ...features
      }
    });
    if (req.auth!.role === UserRole.ADMIN_VECINOS || req.auth!.role === UserRole.ADMIN_EVENTO) {
      await prisma.eventUser.create({
        data: { eventId: event.id, userId: req.auth!.id }
      });
    }
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
      prisma.event.findUnique({ where: { id: req.params.id }, select: { slug: true, name: true, kind: true } }),
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

    const dataRows = rows.map((row) => mapEventPersonToExportRow(row, event!.kind));

    const suffix = fileSuffixFromEvent(event);
    const filename = manualOnly
      ? `acreditados-fuera-de-base__${suffix}.xlsx`
      : importedOnly
        ? `acreditados-desde-base__${suffix}.xlsx`
        : `acreditados-todos__${suffix}.xlsx`;

    const buffer = buildPersonExportXlsxBuffer("Acreditados", dataRows, event!.kind);

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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);

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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const importedOnly = String(req.query.importedOnly ?? "true") === "true";

    const [event, rows] = await Promise.all([
      prisma.event.findUnique({ where: { id: req.params.id }, select: { slug: true, name: true, kind: true } }),
      prisma.eventPerson.findMany({
        where: {
          eventId: req.params.id,
          ...(importedOnly ? { source: "imported" as const } : {})
        },
        include: personExportInclude,
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
      })
    ]);

    const dataRows = rows.map((row) => mapEventPersonToExportRow(row, event!.kind));
    const suffix = fileSuffixFromEvent(event);
    const filename = importedOnly
      ? `base-evento-importada__${suffix}.xlsx`
      : `nomina-evento-completa__${suffix}.xlsx`;
    const buffer = buildPersonExportXlsxBuffer("BASE", dataRows, event!.kind);

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

type GcbaGroupDimension = "ministerio" | "rol";
type VecinoGroupDimension = "comuna" | "mesa";
type GroupableDimension = GcbaGroupDimension | VecinoGroupDimension;
type GroupScope = "accredited" | "all";

const GCBA_GROUP_LABEL: Record<GcbaGroupDimension, string> = {
  ministerio: "Ministerio",
  rol: "ROL"
};

const VECINO_GROUP_LABEL: Record<VecinoGroupDimension, string> = {
  comuna: "Comuna",
  mesa: "Mesa"
};

const NO_DATA_GROUP = "Sin dato";

/**
 * Toma solo el primer nivel cuando el valor viene compuesto, p. ej.
 * "Jefatura de Gobierno · Secretaría de Comunicación · No corresponde" → "Jefatura de Gobierno".
 * Separadores soportados: · (middle dot), • (bullet) y | (pipe).
 */
function firstSegment(value: string): string {
  const first = value.split(/\s*[·•|]\s*/)[0] ?? value;
  return first.trim();
}

function groupKeyFor(kind: EventKind, dimension: GroupableDimension, row: EventPersonExportRow): string {
  if (kind === "vecinos") {
    if (dimension === "comuna") {
      const v = (row.person.comuna ?? "").trim();
      return v.length > 0 ? v : NO_DATA_GROUP;
    }
    if (dimension === "mesa") {
      const extra = row.extraData as Record<string, unknown> | null;
      const v = String(extra?.mesa ?? "").trim();
      return v.length > 0 ? v : NO_DATA_GROUP;
    }
  }
  const raw = dimension === "ministerio" ? row.person.company : row.person.position;
  const value = firstSegment((raw ?? "").trim());
  return value.length > 0 ? value : NO_DATA_GROUP;
}

function validDimensionsForKind(kind: EventKind): GroupableDimension[] {
  return kind === "vecinos" ? ["comuna", "mesa"] : ["ministerio", "rol"];
}

function groupLabelFor(kind: EventKind, dimension: GroupableDimension): string {
  if (kind === "vecinos") return VECINO_GROUP_LABEL[dimension as VecinoGroupDimension];
  return GCBA_GROUP_LABEL[dimension as GcbaGroupDimension];
}

/** Nombre de hoja válido para Excel (máx 31, sin caracteres reservados) y único dentro del libro. */
function safeSheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
  if (base.length === 0) base = "Grupo";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, 28 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function loadGroupableRows(eventId: string, scope: GroupScope): Promise<EventPersonExportRow[]> {
  return prisma.eventPerson.findMany({
    where: {
      eventId,
      ...(scope === "accredited" ? { status: EventPersonStatus.accredited } : {})
    },
    include: personExportInclude,
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }]
  });
}

/** Conteos por dimensión (ministerio/ROL) para previsualizar el panel de descargas. */
router.get("/:id/people/breakdown", async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { kind: true }
    });
    const by = String(req.query.by ?? (event.kind === "vecinos" ? "comuna" : "ministerio")) as GroupableDimension;
    const scope = (String(req.query.scope ?? "accredited") as GroupScope);
    if (!validDimensionsForKind(event.kind).includes(by)) {
      res.status(400).json({
        message: `Parámetro by inválido (${validDimensionsForKind(event.kind).join(" | ")})`
      });
      return;
    }

    const rows = await loadGroupableRows(req.params.id, scope === "all" ? "all" : "accredited");
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = groupKeyFor(event.kind, by, row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const groups = [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key, "es"));

    res.json({ by, scope: scope === "all" ? "all" : "accredited", total: rows.length, groups, eventKind: event.kind });
  } catch (error) {
    next(error);
  }
});

/** Estado de Google Sheets (eventos con enableGoogleSheets). */
router.get("/:id/sheets/stats", async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { enableGoogleSheets: true, googleSheetName: true }
    });
    if (!event.enableGoogleSheets) {
      res.status(400).json({ message: "Este evento no tiene Google Sheets habilitado" });
      return;
    }
    res.json({
      sheetsConfigured: isGoogleSheetsConfigured(),
      googleSheetsEnabled: googleSheetsActive(event) && isGoogleSheetsConfigured(),
      googleSheetName: isUnprovisionedSheetName(event.googleSheetName) ? null : event.googleSheetName,
      googleSheetUrl: googleSheetsActive(event) ? buildGoogleSpreadsheetUrl() : null,
      lastSheetError: getVecinoSheetError(req.params.id)
    });
  } catch (error) {
    next(error);
  }
});

/** Estado de mesas (eventos con enableMesas y mesaCount configurado). */
router.get("/:id/mesas/stats", async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { kind: true, enableMesas: true, enableGoogleSheets: true, mesaCount: true, googleSheetName: true }
    });
    if (!event.enableMesas) {
      res.status(400).json({ message: "Este evento no tiene mesas habilitadas" });
      return;
    }
    if (!event.mesaCount || event.mesaCount < 1) {
      res.json({
        mesaCount: null,
        mesas: [],
        totalAccredited: 0,
        totalAssigned: 0,
        unassignedAccredited: 0,
        autoAssignEnabled: false,
        sheetsConfigured: isGoogleSheetsConfigured(),
        googleSheetsEnabled: googleSheetsActive(event) && isGoogleSheetsConfigured(),
        googleSheetName: isUnprovisionedSheetName(event.googleSheetName) ? null : event.googleSheetName,
        lastSheetError: getVecinoSheetError(req.params.id)
      });
      return;
    }
    const stats = await getMesaStats(req.params.id, event.mesaCount);
    res.json({
      ...stats,
      autoAssignEnabled: true,
      sheetsConfigured: isGoogleSheetsConfigured(),
      googleSheetsEnabled: googleSheetsActive(event) && isGoogleSheetsConfigured(),
      googleSheetName: isUnprovisionedSheetName(event.googleSheetName) ? null : event.googleSheetName,
      lastSheetError: getVecinoSheetError(req.params.id)
    });
  } catch (error) {
    next(error);
  }
});

/** Configurar cantidad de mesas al iniciar acreditación. */
router.patch(
  "/:id/mesas/config",
  requireRoles(...ACCREDIT_ROLES),
  validateBody(vecinosMesaConfigSchema),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { enableMesas: true }
      });
      if (!event.enableMesas) {
        res.status(400).json({ message: "Este evento no tiene mesas habilitadas" });
        return;
      }
      const updated = await prisma.event.update({
        where: { id: req.params.id },
        data: { mesaCount: req.body.mesaCount, enableMesas: true }
      });
      await createAuditLog({
        req,
        action: "event.mesaConfig",
        entityType: "event",
        entityId: updated.id,
        metadata: { mesaCount: req.body.mesaCount }
      });
      res.json({ mesaCount: updated.mesaCount });
    } catch (error) {
      next(error);
    }
  }
);

/** XLSX con una hoja por grupo (ministerio o ROL) + hoja Resumen con los conteos. */
router.get("/:id/export/grouped", async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const eventMeta = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { slug: true, name: true, kind: true }
    });
    const by = String(req.query.by ?? (eventMeta.kind === "vecinos" ? "comuna" : "ministerio")) as GroupableDimension;
    const scope = (String(req.query.scope ?? "accredited") as GroupScope);
    if (!validDimensionsForKind(eventMeta.kind).includes(by)) {
      res.status(400).json({
        message: `Parámetro by inválido (${validDimensionsForKind(eventMeta.kind).join(" | ")})`
      });
      return;
    }
    const normalizedScope: GroupScope = scope === "all" ? "all" : "accredited";

    const rows = await loadGroupableRows(req.params.id, normalizedScope);

    const groups = new Map<string, EventPersonExportRow[]>();
    for (const row of rows) {
      const key = groupKeyFor(eventMeta.kind, by, row);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    const sortedGroups = [...groups.entries()].sort(
      (a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0], "es")
    );

    const workbook = XLSX.utils.book_new();
    const usedSheetNames = new Set<string>();

    const summaryAoa: (string | number)[][] = [
      [groupLabelFor(eventMeta.kind, by), "Cantidad"],
      ...sortedGroups.map(([name, gr]) => [name, gr.length] as (string | number)[]),
      ["TOTAL", rows.length]
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(summaryAoa),
      safeSheetName("Resumen", usedSheetNames)
    );

    for (const [name, gr] of sortedGroups) {
      const header: string[] = [...PERSON_EXPORT_HEADER];
      header[0] = documentColumnLabel(eventMeta.kind);
      const aoa = [header, ...gr.map((row) => mapEventPersonToExportRow(row, eventMeta.kind))];
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(aoa),
        safeSheetName(name, usedSheetNames)
      );
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const suffix = fileSuffixFromEvent(eventMeta);
    const scopeLabel = normalizedScope === "all" ? "personas" : "acreditados";
    const filename = `${scopeLabel}-por-${by}__${suffix}.xlsx`;

    await createAuditLog({
      req,
      action: "event.export.grouped",
      entityType: "event",
      entityId: req.params.id,
      metadata: { by, scope: normalizedScope, groups: sortedGroups.length, rows: rows.length, format: "xlsx" }
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
      accreditedPeople: event.eventPeople.length,
      ...googleSheetsResponseFields(event)
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireRoles(...MANAGE_EVENT_ROLES), validateBody(eventPatchSchema), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    if (req.auth!.role === UserRole.ADMIN_VECINOS && req.body.kind && req.body.kind !== "vecinos") {
      throw new AppError("No podés cambiar el tipo de evento a GCBA", 403);
    }
    const data: Prisma.EventUpdateInput = { ...req.body };
    if (!Object.prototype.hasOwnProperty.call(req.body, "kind")) {
      delete data.kind;
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body, "enableMesas") ||
      Object.prototype.hasOwnProperty.call(req.body, "enableNotes") ||
      Object.prototype.hasOwnProperty.call(req.body, "mesaCount")
    ) {
      const current = await prisma.event.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { enableMesas: true, enableNotes: true, mesaCount: true }
      });
      const features = normalizeEventFeatures({
        enableMesas: req.body.enableMesas ?? current.enableMesas,
        enableNotes: req.body.enableNotes ?? current.enableNotes,
        mesaCount: req.body.mesaCount ?? current.mesaCount
      });
      data.enableMesas = features.enableMesas;
      data.enableNotes = features.enableNotes;
      data.mesaCount = features.mesaCount;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "enableGoogleSheets")) {
      data.enableGoogleSheets = Boolean(req.body.enableGoogleSheets);
    }
    const currentForSheets = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { name: true, enableGoogleSheets: true, googleSheetName: true }
    });
    const nextEnableSheets = Object.prototype.hasOwnProperty.call(req.body, "enableGoogleSheets")
      ? Boolean(req.body.enableGoogleSheets)
      : currentForSheets.enableGoogleSheets;
    if (
      nextEnableSheets &&
      isGoogleSheetsConfigured() &&
      isUnprovisionedSheetName(currentForSheets.googleSheetName)
    ) {
      try {
        data.googleSheetName = await createEventGoogleSheet(
          typeof req.body.name === "string" ? req.body.name : currentForSheets.name
        );
      } catch (err) {
        logger.warn({ err, eventId: req.params.id }, "No se pudo crear hoja en Google Sheets al actualizar evento");
      }
    }
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

router.delete("/:id", requireRoles(...MANAGE_EVENT_ROLES), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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

router.post("/:id/users", requireRoles("SUPERADMIN", "ADMIN_VECINOS"), validateBody(assignUsersSchema), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    await assertEventKindForRole(req.params.id, req.auth!.role);
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
  requireRoles("SUPERADMIN", "ADMIN_VECINOS"),
  validateBody(createEventStaffUserSchema),
  async (req, res, next) => {
    const eventId = req.params.id;
    try {
      await ensureAccess(eventId, req.auth!.id, req.auth!.role);
      await assertEventKindForRole(eventId, req.auth!.role);
      if (
        req.auth!.role === UserRole.ADMIN_VECINOS &&
        !VECINOS_CREATABLE_ROLES.includes(req.body.role)
      ) {
        throw new AppError("Rol no permitido para administrador de vecinos", 403);
      }

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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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

const bulkUnaccreditScopes = ["accredited", "accredited_imported"] as const;
type BulkUnaccreditScope = (typeof bulkUnaccreditScopes)[number];

function isBulkUnaccreditScope(scope: BulkDeletePeopleScope): scope is BulkUnaccreditScope {
  return (bulkUnaccreditScopes as readonly string[]).includes(scope);
}

function buildUnaccreditData(extraData: Record<string, unknown> | null | undefined) {
  const cleaned = extraDataWithoutMesa(extraData);
  return {
    status: EventPersonStatus.pending,
    accreditedAt: null,
    accreditedByUserId: null,
    accreditationNotes: null,
    eventNotes: null,
    extraData:
      cleaned && Object.keys(cleaned).length > 0 ? (cleaned as Prisma.InputJsonValue) : Prisma.JsonNull
  };
}

/** Elimina personas del evento en lote, o revierte acreditaciones según scope. */
router.delete(
  "/:id/people/bulk",
  requireRoles(...MANAGE_EVENT_ROLES),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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

      if (isBulkUnaccreditScope(scope)) {
        const rows = await prisma.eventPerson.findMany({
          where,
          select: { id: true, extraData: true }
        });
        if (rows.length > 0) {
          await prisma.$transaction(
            rows.map((row) =>
              prisma.eventPerson.update({
                where: { id: row.id },
                data: buildUnaccreditData(row.extraData as Record<string, unknown> | null)
              })
            )
          );
        }
        await createAuditLog({
          req,
          action: "eventPerson.bulkUnaccredit",
          entityType: "event",
          entityId: req.params.id,
          metadata: { scope, unaccredited: rows.length }
        });
        res.json({ unaccredited: rows.length, scope });
        return;
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
  requireRoles(...MANAGE_EVENT_ROLES),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { kind: true }
    });
    const raw = String(req.query.cuil ?? req.query.dni ?? "").trim();
    const digits = normalizeCuil(raw);

    if (event.kind === "vecinos") {
      const dni = normalizeDni(raw);
      if (!dni) {
        throw new AppError("Ingresá un DNI válido (6 a 8 dígitos)", 400);
      }
      const cuilSynthetic = syntheticCuilFromDni(dni);
      const personWhere: Prisma.PersonWhereInput = {
        OR: [{ dni }, { cuilNormalized: cuilSynthetic }]
      };

      const eventPerson = await prisma.eventPerson.findFirst({
        where: { eventId: req.params.id, person: personWhere },
        include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
      });
      if (eventPerson) {
        res.json({ inEvent: true, eventPerson });
        return;
      }

      const vecinoDirectoryPerson = await prisma.vecinoDirectoryPerson.findUnique({ where: { dni } });
      if (vecinoDirectoryPerson) {
        res.json({
          inEvent: false,
          fromDirectory: true,
          directoryKind: "vecinos",
          directoryPerson: toVecinoDirectoryPersonDto(vecinoDirectoryPerson)
        });
        return;
      }

      res.status(404).json({ message: "No encontrado en este evento ni en el directorio de vecinos" });
      return;
    }

    let personWhere: Prisma.PersonWhereInput;
    if (digits.length === 11) {
      if (!isValidCuil(digits)) throw new AppError("CUIL inválido", 400);
      const dni = dniFromCuil(digits);
      personWhere = dni
        ? { OR: [{ cuilNormalized: digits }, { dni }] }
        : { cuilNormalized: digits };
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

    const directoryDni = digits.length === 11 ? dniFromCuil(digits) : digits;
    const directoryWhere: Prisma.DirectoryPersonWhereInput =
      digits.length === 11
        ? directoryDni
          ? { OR: [{ cuilNormalized: digits }, { dni: directoryDni }] }
          : { cuilNormalized: digits }
        : { dni: digits };

    const directoryPerson = await prisma.directoryPerson.findFirst({
      where: directoryWhere
    });

    if (directoryPerson) {
      res.json({
        inEvent: false,
        fromDirectory: true,
        directoryKind: "gcba",
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
  requireRoles(...ACCREDIT_ROLES),
  validateBody(manualFromDirectorySchema),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
      await assertEventAcceptingAccreditations(req.params.id);
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { kind: true }
      });

      if (event.kind === "vecinos") {
        const dni =
          normalizeDni(String(req.body.dni ?? "")) ??
          (req.body.cuilNormalized ? normalizeDni(dniFromCuil(req.body.cuilNormalized) ?? "") : null);
        if (!dni) throw new AppError("DNI inválido", 400);

        const directoryPerson = await prisma.vecinoDirectoryPerson.findUnique({ where: { dni } });
        if (!directoryPerson) throw new AppError("No está en el directorio de vecinos", 404);

        const cuilNormalized = syntheticCuilFromDni(dni);
        const existing = await prisma.person.findFirst({
          where: { OR: [{ dni }, { cuilNormalized }] }
        });

        const person = existing
          ? await prisma.person.update({
              where: { id: existing.id },
              data: {
                cuilNormalized,
                cuilRaw: dni,
                dni,
                firstName: directoryPerson.firstName,
                lastName: directoryPerson.lastName,
                email: directoryPerson.email ?? existing.email,
                phone: directoryPerson.phone ?? existing.phone,
                address: directoryPerson.address ?? existing.address,
                comuna: directoryPerson.comuna ?? existing.comuna
              }
            })
          : await prisma.person.create({
              data: {
                cuilNormalized,
                cuilRaw: dni,
                dni,
                firstName: directoryPerson.firstName,
                lastName: directoryPerson.lastName,
                email: directoryPerson.email,
                phone: directoryPerson.phone,
                address: directoryPerson.address,
                comuna: directoryPerson.comuna
              }
            });

        const eventPerson = await prisma.eventPerson.upsert({
          where: { eventId_personId: { eventId: req.params.id, personId: person.id } },
          update: {},
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
          metadata: { dni, kind: "vecinos" }
        });

        res.status(201).json(eventPerson);
        return;
      }

      const cuilNormalized = normalizeCuil(String(req.body.cuilNormalized ?? ""));
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
        update: {},
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

router.post("/:id/people/manual", requireRoles(...ACCREDIT_ROLES), validateBody(manualPersonSchema), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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

router.post("/:id/people/:eventPersonId/accredit", requireRoles(...ACCREDIT_ROLES), validateBody(accreditBodySchema), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
    await assertEventAcceptingAccreditations(req.params.id);
    const [current, event] = await Promise.all([
      prisma.eventPerson.findUniqueOrThrow({ where: { id: req.params.eventPersonId } }),
      prisma.event.findUniqueOrThrow({
        where: { id: req.params.id },
        select: {
          id: true,
          kind: true,
          name: true,
          startAt: true,
          enableMesas: true,
          enableGoogleSheets: true,
          mesaCount: true,
          googleSheetName: true
        }
      })
    ]);
    if (current.eventId !== req.params.id) throw new AppError("Registro fuera de evento", 400);
    ensureNotAlreadyAccredited(current.status);

    let extraData = (current.extraData as Record<string, unknown> | null) ?? {};
    let assignedMesa: number | null = null;

    if (mesasActive(event)) {
      const mesaNum =
        typeof req.body.mesa === "number" ? req.body.mesa : parseMesaNumber(req.body.mesa);
      if (!mesaNum || mesaNum < 1 || mesaNum > (event.mesaCount ?? 0)) {
        throw new AppError(`Seleccioná una mesa entre 1 y ${event.mesaCount}`, 400);
      }
      assignedMesa = mesaNum;
      extraData = mergeMesaIntoExtraData(extraData, mesaNum);
    }

    const eventPerson = await prisma.eventPerson.update({
      where: { id: req.params.eventPersonId },
      data: {
        status: "accredited",
        accreditedAt: new Date(),
        accreditedByUserId: req.auth!.id,
        accreditationNotes: req.body?.notes ?? null,
        extraData: Object.keys(extraData).length > 0 ? (extraData as Prisma.InputJsonValue) : Prisma.JsonNull
      },
      include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
    });

    if (googleSheetsActive(event) && isGoogleSheetsConfigured()) {
      void (async () => {
        try {
          const sheetName = await ensureEventGoogleSheet(event);
          if (sheetName) await appendVecinoAccreditationToSheet(req.params.id, sheetName, eventPerson);
        } catch (err) {
          recordVecinoSheetError(req.params.id, formatGoogleSheetsError(err));
          logger.warn({ err, eventPersonId: eventPerson.id }, "Falló envío a Google Sheets");
        }
      })();
    }

    await createAuditLog({
      req,
      action: "eventPerson.accredit",
      entityType: "eventPerson",
      entityId: eventPerson.id,
      metadata: assignedMesa != null ? { assignedMesa: mesaLabel(assignedMesa) } : undefined
    });
    res.json(eventPerson);
  } catch (error) {
    next(error);
  }
});

/** Revierte una acreditación: la persona vuelve a pendiente y permanece en la nómina. */
router.post(
  "/:id/people/:eventPersonId/unaccredit",
  requireRoles(...ACCREDIT_ROLES),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
      const current = await prisma.eventPerson.findUniqueOrThrow({
        where: { id: req.params.eventPersonId }
      });
      if (current.eventId !== req.params.id) throw new AppError("Registro fuera de evento", 400);
      if (current.status !== EventPersonStatus.accredited) {
        throw new AppError("La persona no está acreditada", 400);
      }

      const eventPerson = await prisma.eventPerson.update({
        where: { id: current.id },
        data: buildUnaccreditData(current.extraData as Record<string, unknown> | null),
        include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
      });

      await createAuditLog({
        req,
        action: "eventPerson.unaccredit",
        entityType: "eventPerson",
        entityId: eventPerson.id
      });
      res.json(eventPerson);
    } catch (error) {
      next(error);
    }
  }
);

/** Acta / minuta general del encuentro (pestaña Notas generales). */
router.patch(
  "/:id/meeting-minutes",
  requireRoles(...ACCREDIT_ROLES),
  validateBody(meetingMinutesBodySchema),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { enableNotes: true }
      });
      if (!event.enableNotes) {
        throw new AppError("Este evento no tiene notas habilitadas", 400);
      }

      const meetingMinutes =
        req.body.meetingMinutes == null || String(req.body.meetingMinutes).trim() === ""
          ? null
          : String(req.body.meetingMinutes);

      const updated = await prisma.event.update({
        where: { id: req.params.id },
        data: { meetingMinutes }
      });

      await createAuditLog({
        req,
        action: "event.updateMeetingMinutes",
        entityType: "event",
        entityId: updated.id
      });
      res.json({ id: updated.id, meetingMinutes: updated.meetingMinutes });
    } catch (error) {
      next(error);
    }
  }
);

/** Nota operativa post-acreditación por persona (pestaña Notas). */
router.patch(
  "/:id/people/:eventPersonId/notes",
  requireRoles(...ACCREDIT_ROLES),
  validateBody(eventNotesBodySchema),
  async (req, res, next) => {
    try {
      await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
      const [event, current] = await Promise.all([
        prisma.event.findUniqueOrThrow({
          where: { id: req.params.id },
          select: { enableNotes: true }
        }),
        prisma.eventPerson.findUniqueOrThrow({
          where: { id: req.params.eventPersonId }
        })
      ]);
      if (!event.enableNotes) {
        throw new AppError("Este evento no tiene notas habilitadas", 400);
      }
      if (current.eventId !== req.params.id) throw new AppError("Registro fuera de evento", 400);
      if (current.status !== EventPersonStatus.accredited) {
        throw new AppError("Solo se pueden asignar notas a personas acreditadas", 400);
      }

      const note =
        req.body.eventNotes == null || String(req.body.eventNotes).trim() === ""
          ? null
          : String(req.body.eventNotes).trim();

      const eventPerson = await prisma.eventPerson.update({
        where: { id: current.id },
        data: { eventNotes: note },
        include: { person: true, accreditedByUser: { select: { id: true, name: true } } }
      });

      await createAuditLog({
        req,
        action: "eventPerson.updateNotes",
        entityType: "eventPerson",
        entityId: eventPerson.id
      });
      res.json(eventPerson);
    } catch (error) {
      next(error);
    }
  }
);

router.post("/:id/people/:eventPersonId/reaccredit", requireRoles(...MANAGE_EVENT_ROLES), async (req, res, next) => {
  try {
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
    await ensureAccess(req.params.id, req.auth!.id, req.auth!.role);
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
