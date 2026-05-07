import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { normalizeCuil } from "@gcba/shared";
import { Prisma } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import { ensureEventAccess } from "../events/event-access";
import { createAuditLog } from "../../lib/audit";
import { normalizeImportCanonical, validateImportRow } from "./import-logic";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const canonicalFields = [
  "cuil",
  "cuit",
  "nombre",
  "apellido",
  "nombreCompleto",
  "dni",
  "email",
  "telefono",
  "empresa",
  "cargo",
  "observaciones"
] as const;
const REQUIRED_SHEET_NAME = "BASE";

const confirmSchema = z.object({
  eventId: z.string(),
  originalFilename: z.string(),
  sheetName: z.literal(REQUIRED_SHEET_NAME),
  rows: z.array(z.record(z.string(), z.any())),
  mapping: z.record(z.string(), z.string()).optional()
});

function autoDetectMapping(headers: string[]) {
  const normalizeHeader = (header: string) =>
    header
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/["'¿?]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const map: Record<string, string> = {};
  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    if (normalized.includes("cuil") || normalized.includes("cuit")) map[header] = "cuil";
    else if (normalized === "ayn" || normalized.includes("apellido y nombre")) map[header] = "nombreCompleto";
    else if (normalized === "nombre/s" || normalized === "nombres" || normalized === "nombre") map[header] = "nombre";
    else if (normalized === "apellido/s" || normalized === "apellidos" || normalized === "apellido")
      map[header] = "apellido";
    else if (normalized.includes("dni")) map[header] = "dni";
    else if (normalized.includes("mail") || normalized.includes("correo") || normalized === "email")
      map[header] = "email";
    else if (
      normalized.includes("telefono celular") ||
      normalized.includes("numero de telefono") ||
      normalized.includes("telefono") ||
      normalized.includes("tel")
    )
      map[header] = "telefono";
    else if (normalized === "rol") map[header] = "cargo";
    else if (normalized.includes("area")) map[header] = "cargo";
    else if (normalized.includes("empresa")) map[header] = "empresa";
    else if (normalized.includes("cargo")) map[header] = "cargo";
    else if (
      normalized.includes("obs") ||
      normalized.includes("reconocidos") ||
      normalized.includes("en cual de las siguientes fechas vas a participar")
    )
      map[header] = "observaciones";
  });
  return map;
}

const router = Router();
router.use(requireAuth);

router.post("/:id/imports/preview", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), upload.single("file"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    if (!req.file || !req.file.originalname.endsWith(".xlsx")) {
      res.status(400).json({ message: "Debe subir un archivo .xlsx" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer);
    if (!workbook.SheetNames.includes(REQUIRED_SHEET_NAME)) {
      res.status(400).json({
        message: `El archivo debe incluir la hoja '${REQUIRED_SHEET_NAME}'.`
      });
      return;
    }
    const sheetName = REQUIRED_SHEET_NAME;
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    const headers = jsonRows[0] ? Object.keys(jsonRows[0]) : [];
    const mapping = autoDetectMapping(headers);
    const cuilSet = new Set<string>();
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;

    const previewRows = jsonRows.map((row, index) => {
      const canonical: Record<string, unknown> = {};
      const extra: Record<string, unknown> = {};
      headers.forEach((header) => {
        const target = mapping[header];
        if (target && canonicalFields.includes(target as (typeof canonicalFields)[number])) {
          canonical[target] = row[header];
        } else {
          extra[header] = row[header];
        }
      });
      const normalizedCanonical = normalizeImportCanonical(canonical);
      const cuil = normalizeCuil(String(normalizedCanonical.cuil ?? ""));
      const rowErrors = validateImportRow(normalizedCanonical);
      if (cuilSet.has(cuil)) {
        duplicateRows += 1;
        rowErrors.push("CUIL duplicado en archivo");
      } else if (cuil) {
        cuilSet.add(cuil);
      }
      if (rowErrors.length > 0) invalidRows += 1;
      else validRows += 1;
      return {
        rowNumber: index + 2,
        canonical: normalizedCanonical,
        extraData: extra,
        errors: rowErrors
      };
    });

    const cuils = previewRows.map((row) => normalizeCuil(String(row.canonical.cuil ?? ""))).filter(Boolean);
    const existingInEvent = await prisma.eventPerson.findMany({
      where: {
        eventId: req.params.id,
        person: { cuilNormalized: { in: cuils } }
      },
      include: { person: true }
    });
    const existingGlobal = await prisma.person.findMany({
      where: { cuilNormalized: { in: cuils } }
    });

    res.json({
      originalFilename: req.file.originalname,
      sheetName,
      headers,
      mapping,
      previewRows: previewRows.slice(0, 200),
      summary: {
        totalRows: jsonRows.length,
        validRows,
        invalidRows,
        duplicateRows,
        existingInEvent: existingInEvent.length,
        existingGlobal: existingGlobal.length,
        newPeople: Math.max(validRows - existingGlobal.length, 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/imports/confirm", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const payload = confirmSchema.parse({ ...req.body, eventId: req.params.id });
    const parseRows = payload.rows.map((row, idx) => {
      const mapped: Record<string, unknown> = {};
      const extra: Record<string, unknown> = {};
      Object.entries(row).forEach(([key, value]) => {
        const target = payload.mapping?.[key];
        if (target && canonicalFields.includes(target as (typeof canonicalFields)[number])) {
          mapped[target] = value;
        } else if (canonicalFields.includes(key as (typeof canonicalFields)[number])) {
          mapped[key] = value;
        } else {
          extra[key] = value;
        }
      });
      const normalizedMapped = normalizeImportCanonical(mapped);
      const cuil = normalizeCuil(String(normalizedMapped.cuil ?? ""));
      const errors = validateImportRow(normalizedMapped);
      return { rowNumber: idx + 2, mapped: normalizedMapped, extra, cuil, errors };
    });

    const validRows = parseRows.filter((row) => row.errors.length === 0);
    const invalidRows = parseRows.filter((row) => row.errors.length > 0);

    const batch = await prisma.importBatch.create({
      data: {
        eventId: req.params.id,
        uploadedByUserId: req.auth!.id,
        originalFilename: payload.originalFilename,
        sheetName: payload.sheetName,
        totalRows: parseRows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        duplicateRows: 0,
        importedRows: 0
      }
    });

    for (const row of invalidRows) {
      await prisma.importBatchRowError.create({
        data: {
          importBatchId: batch.id,
          rowNumber: row.rowNumber,
          rawData: row.mapped as Prisma.InputJsonValue,
          errorMessage: row.errors.join(", ")
        }
      });
    }

    let importedRows = 0;
    for (const row of validRows) {
      const person = await prisma.person.upsert({
        where: { cuilNormalized: row.cuil },
        create: {
          cuilNormalized: row.cuil,
          cuilRaw: String(row.mapped.cuil),
          firstName: String(row.mapped.nombre),
          lastName: String(row.mapped.apellido),
          dni: row.mapped.dni ? String(row.mapped.dni) : null,
          email: row.mapped.email ? String(row.mapped.email) : null,
          phone: row.mapped.telefono ? String(row.mapped.telefono) : null,
          company: row.mapped.empresa ? String(row.mapped.empresa) : null,
          position: row.mapped.cargo ? String(row.mapped.cargo) : null,
          notes: row.mapped.observaciones ? String(row.mapped.observaciones) : null
        },
        update: {
          firstName: String(row.mapped.nombre),
          lastName: String(row.mapped.apellido),
          dni: row.mapped.dni ? String(row.mapped.dni) : undefined,
          email: row.mapped.email ? String(row.mapped.email) : undefined,
          phone: row.mapped.telefono ? String(row.mapped.telefono) : undefined,
          company: row.mapped.empresa ? String(row.mapped.empresa) : undefined,
          position: row.mapped.cargo ? String(row.mapped.cargo) : undefined,
          notes: row.mapped.observaciones ? String(row.mapped.observaciones) : undefined
        }
      });

      await prisma.eventPerson.upsert({
        where: {
          eventId_personId: { eventId: req.params.id, personId: person.id }
        },
        create: {
          eventId: req.params.id,
          personId: person.id,
          source: "imported",
          importBatchId: batch.id,
          extraData: row.extra as Prisma.InputJsonValue
        },
        update: {
          importBatchId: batch.id,
          extraData: row.extra as Prisma.InputJsonValue
        }
      });
      importedRows += 1;
    }

    const updatedBatch = await prisma.importBatch.update({
      where: { id: batch.id },
      data: { importedRows }
    });
    await createAuditLog({
      req,
      action: "import.confirm",
      entityType: "importBatch",
      entityId: batch.id,
      metadata: {
        importedRows,
        invalidRows: invalidRows.length
      }
    });
    res.status(201).json(updatedBatch);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/imports", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const imports = await prisma.importBatch.findMany({
      where: { eventId: req.params.id },
      include: { uploadedByUser: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(imports);
  } catch (error) {
    next(error);
  }
});

router.get("/detail/:importId", async (req, res, next) => {
  try {
    const item = await prisma.importBatch.findUniqueOrThrow({
      where: { id: req.params.importId },
      include: { rowErrors: true, uploadedByUser: { select: { id: true, name: true } } }
    });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

export const importsRoutes = router;
