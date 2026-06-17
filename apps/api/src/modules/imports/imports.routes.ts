import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { normalizeCuil, syntheticCuilFromDni, normalizeDni } from "@gcba/shared";
import { EventKind, Prisma } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { rejectInformadorExceptReportRead } from "../../middlewares/informador-scope";
import { requireRoles } from "../../middlewares/rbac";
import { ensureEventAccess } from "../events/event-access";
import { assertEventKindForRole } from "../events/event-kind-access";
import { createAuditLog } from "../../lib/audit";
import {
  applyImportMappedValue,
  buildImportExtraData,
  buildVecinoExtraData,
  detectUniversalImportColumn,
  importRowIdKey,
  isImportNoiseColumn,
  normalizeImportCanonical,
  normalizeImportSheetHeader,
  normalizeVecinoImportCanonical,
  validateImportRow,
  validateVecinoImportRow
} from "./import-logic";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

/** Solo columnas operativas de la planilla BASE (el resto queda fuera del mapeo). */
const gcbaCanonicalFields = [
  "cuil",
  "cuit",
  "dni",
  "nombre",
  "apellido",
  "nombreCompleto",
  "nombreApellido",
  "email",
  "telefono",
  "empresa",
  "cargo",
  "notes",
  "presente"
] as const;

const vecinoCanonicalFields = [
  "dni",
  "nombre",
  "apellido",
  "nombreCompleto",
  "nombreApellido",
  "email",
  "telefono",
  "direccion",
  "presente",
  "empresa",
  "cargo",
  "notes"
] as const;

const REQUIRED_SHEET_NAME = "BASE";

const IMPORT_ROLES = ["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS"] as const;

type ImportParsedRow = {
  rowNumber: number;
  canonical: Record<string, unknown>;
  extraData: Record<string, unknown>;
  errors: string[];
};

function parseWorkbookRows(buffer: Buffer, kind: EventKind) {
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames.includes(REQUIRED_SHEET_NAME)
    ? REQUIRED_SHEET_NAME
    : (workbook.SheetNames[0] ?? "");
  if (!sheetName) {
    throw new Error("El archivo no contiene hojas para importar.");
  }
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const headers = jsonRows[0] ? Object.keys(jsonRows[0]) : [];
  const mapping = kind === "vecinos" ? autoDetectVecinoMapping(headers) : autoDetectMapping(headers);
  const canonicalFields = kind === "vecinos" ? vecinoCanonicalFields : gcbaCanonicalFields;
  const idSet = new Set<string>();
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;

  const rows: ImportParsedRow[] = jsonRows.map((row, index) => {
    const canonical: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    headers.forEach((header) => {
      const target = mapping[header];
      if (target && (canonicalFields as readonly string[]).includes(target)) {
        applyImportMappedValue(canonical, target, row[header]);
      } else if (!isImportNoiseColumn(header)) {
        const raw = row[header];
        if (raw != null && String(raw).trim() !== "") {
          extra[header] = raw;
        }
      }
    });
    const normalizedCanonical =
      kind === "vecinos" ? normalizeVecinoImportCanonical(canonical) : normalizeImportCanonical(canonical);
    const rowErrors =
      kind === "vecinos" ? validateVecinoImportRow(normalizedCanonical) : validateImportRow(normalizedCanonical);
    const idKey =
      kind === "vecinos"
        ? String(normalizedCanonical.dni ?? "") || importRowIdKey(normalizedCanonical)
        : importRowIdKey(normalizedCanonical);
    if (idKey && idSet.has(idKey)) {
      duplicateRows += 1;
      rowErrors.push(
        kind === "vecinos" || normalizeDni(String(normalizedCanonical.dni ?? ""))
          ? "DNI duplicado en archivo"
          : "CUIL duplicado en archivo"
      );
    } else if (idKey) {
      idSet.add(idKey);
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

  return {
    sheetName,
    headers,
    mapping,
    rows,
    summary: {
      totalRows: jsonRows.length,
      validRows,
      invalidRows,
      duplicateRows
    }
  };
}

async function importParsedRows(
  eventId: string,
  kind: EventKind,
  uploadedByUserId: string,
  originalFilename: string,
  parsed: ReturnType<typeof parseWorkbookRows>
) {
  const validRows = parsed.rows.filter((row) => row.errors.length === 0);
  const invalidRows = parsed.rows.filter((row) => row.errors.length > 0);

  const batch = await prisma.importBatch.create({
    data: {
      eventId,
      uploadedByUserId,
      originalFilename,
      sheetName: parsed.sheetName,
      totalRows: parsed.rows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      duplicateRows: parsed.summary.duplicateRows,
      importedRows: 0
    }
  });

  for (const row of invalidRows) {
    await prisma.importBatchRowError.create({
      data: {
        importBatchId: batch.id,
        rowNumber: row.rowNumber,
        rawData: row.canonical as Prisma.InputJsonValue,
        errorMessage: row.errors.join(", ")
      }
    });
  }

  let importedRows = 0;
  for (const row of validRows) {
    const mapped = row.canonical;
    const firstName = String(mapped.nombre ?? "").trim();
    const lastName = String(mapped.apellido ?? "").trim();

    if (kind === "vecinos") {
      const dni = normalizeDni(String(mapped.dni ?? ""))!;
      const cuil = syntheticCuilFromDni(dni);
      const extraPayload = buildVecinoExtraData(mapped, row.extraData);
      const existingByDni = await prisma.person.findFirst({ where: { dni } });
      const person = existingByDni
        ? await prisma.person.update({
            where: { id: existingByDni.id },
            data: {
              firstName,
              lastName,
              dni,
              email: mapped.email ? String(mapped.email) : undefined,
              phone: mapped.telefono ? String(mapped.telefono) : undefined,
              address: mapped.direccion ? String(mapped.direccion) : undefined,
              company: mapped.empresa ? String(mapped.empresa) : undefined,
              position: mapped.cargo ? String(mapped.cargo) : undefined
            }
          })
        : await prisma.person.upsert({
            where: { cuilNormalized: cuil },
            create: {
              cuilNormalized: cuil,
              cuilRaw: dni,
              dni,
              firstName,
              lastName,
              email: mapped.email ? String(mapped.email) : null,
              phone: mapped.telefono ? String(mapped.telefono) : null,
              address: mapped.direccion ? String(mapped.direccion) : null,
              company: mapped.empresa ? String(mapped.empresa) : null,
              position: mapped.cargo ? String(mapped.cargo) : null
            },
            update: {
              firstName,
              lastName,
              dni,
              email: mapped.email ? String(mapped.email) : undefined,
              phone: mapped.telefono ? String(mapped.telefono) : undefined,
              address: mapped.direccion ? String(mapped.direccion) : undefined,
              company: mapped.empresa ? String(mapped.empresa) : undefined,
              position: mapped.cargo ? String(mapped.cargo) : undefined
            }
          });

      await prisma.eventPerson.upsert({
        where: { eventId_personId: { eventId, personId: person.id } },
        create: {
          eventId,
          personId: person.id,
          source: "imported",
          importBatchId: batch.id,
          extraData: extraPayload as Prisma.InputJsonValue
        },
        update: {
          importBatchId: batch.id,
          extraData: extraPayload as Prisma.InputJsonValue
        }
      });
    } else {
      const cuil = normalizeCuil(String(mapped.cuil ?? ""));
      const dni = normalizeDni(String(mapped.dni ?? ""));
      const extraPayload = buildImportExtraData(mapped, row.extraData, ["presente"]);
      const person = await prisma.person.upsert({
        where: { cuilNormalized: cuil },
        create: {
          cuilNormalized: cuil,
          cuilRaw: dni ?? String(mapped.cuil ?? cuil),
          dni,
          firstName,
          lastName,
          email: mapped.email ? String(mapped.email) : null,
          phone: mapped.telefono ? String(mapped.telefono) : null,
          company: mapped.empresa ? String(mapped.empresa) : null,
          position: mapped.cargo ? String(mapped.cargo) : null,
          notes: mapped.notes ? String(mapped.notes) : null
        },
        update: {
          firstName,
          lastName,
          dni: dni ?? undefined,
          email: mapped.email ? String(mapped.email) : undefined,
          phone: mapped.telefono ? String(mapped.telefono) : undefined,
          company: mapped.empresa ? String(mapped.empresa) : undefined,
          position: mapped.cargo ? String(mapped.cargo) : undefined,
          notes: mapped.notes ? String(mapped.notes) : undefined
        }
      });

      await prisma.eventPerson.upsert({
        where: { eventId_personId: { eventId, personId: person.id } },
        create: {
          eventId,
          personId: person.id,
          source: "imported",
          importBatchId: batch.id,
          extraData:
            Object.keys(extraPayload).length > 0
              ? (extraPayload as Prisma.InputJsonValue)
              : Prisma.JsonNull
        },
        update: {
          importBatchId: batch.id,
          extraData:
            Object.keys(extraPayload).length > 0
              ? (extraPayload as Prisma.InputJsonValue)
              : Prisma.JsonNull
        }
      });
    }
    importedRows += 1;
  }

  return prisma.importBatch.update({
    where: { id: batch.id },
    data: { importedRows }
  });
}

function autoDetectVecinoMapping(headers: string[]) {
  const map: Record<string, string> = {};
  headers.forEach((header) => {
    const normalized = normalizeImportSheetHeader(header);
    const universal = detectUniversalImportColumn(normalized);
    if (universal) {
      map[header] = universal;
      return;
    }
    if (normalized === "apellido" || normalized === "apellidos" || normalized.startsWith("apellido")) {
      map[header] = "apellido";
      return;
    }
    if (normalized === "nombre" || normalized === "nombres") {
      map[header] = "nombre";
      return;
    }
    if (normalized.includes("direccion") || normalized.includes("domicilio")) {
      map[header] = "direccion";
      return;
    }
    if (normalized.includes("mail") || normalized.includes("correo") || normalized === "email") {
      map[header] = "email";
      return;
    }
    if (
      normalized.includes("telefono") ||
      normalized.includes("celular") ||
      normalized.includes("numero de telefono") ||
      normalized.includes("numero telefono")
    ) {
      map[header] = "telefono";
      return;
    }
  });
  return map;
}

function autoDetectMapping(headers: string[]) {
  const map: Record<string, string> = {};
  headers.forEach((header) => {
    const normalized = normalizeImportSheetHeader(header);
    const universal = detectUniversalImportColumn(normalized);
    if (universal) {
      map[header] = universal;
      return;
    }
    if (
      normalized === "apellido/s" ||
      normalized === "apellidos" ||
      normalized === "apellido" ||
      /^apellido\/s$/.test(normalized)
    ) {
      map[header] = "apellido";
      return;
    }
    if (
      normalized === "nombre/s" ||
      normalized === "nombres" ||
      normalized === "nombre" ||
      /^nombre\/s$/.test(normalized)
    ) {
      map[header] = "nombre";
      return;
    }
    if (normalized.includes("secretaria") && normalized.includes("formas parte")) {
      map[header] = "empresa";
      return;
    }
    if (normalized.includes("direccion") && normalized.includes("formas parte")) {
      map[header] = "empresa";
      return;
    }
    if (
      normalized.includes("de que area formas parte") ||
      normalized.includes("de que area") ||
      (normalized.includes("area") && normalized.includes("parte") && !normalized.includes("secretaria"))
    ) {
      map[header] = "empresa";
      return;
    }
    if (normalized === "rol" || /^rol\b/.test(normalized)) {
      map[header] = "cargo";
      return;
    }
    if (normalized.includes("reconocidos")) {
      map[header] = "cargo";
      return;
    }
    if (
      normalized.includes("pregunta") ||
      normalized.includes("tema que te interese") ||
      normalized.includes("abordar durante el encuentro")
    ) {
      map[header] = "notes";
      return;
    }
    if (normalized.includes("mail") || normalized.includes("correo") || normalized === "email") {
      map[header] = "email";
      return;
    }
    if (normalized.includes("numero de telefono") || normalized.includes("numero telefono")) {
      map[header] = "telefono";
      return;
    }
  });
  return map;
}

const router = Router();
router.use(requireAuth);
router.use(rejectInformadorExceptReportRead);

router.post("/:id/imports/preview", requireRoles(...IMPORT_ROLES), upload.single("file"), async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN", req.auth!.role);
    const kind = await assertEventKindForRole(req.params.id, req.auth!.role);
    if (!req.file || !req.file.originalname.endsWith(".xlsx")) {
      res.status(400).json({ message: "Debe subir un archivo .xlsx" });
      return;
    }

    const parsed = parseWorkbookRows(req.file.buffer, kind);
    if (kind === "vecinos") {
      const dnis = parsed.rows
        .map((row) => normalizeDni(String(row.canonical.dni ?? "")))
        .filter((d): d is string => Boolean(d));
      const existingInEvent = await prisma.eventPerson.findMany({
        where: { eventId: req.params.id, person: { dni: { in: dnis } } },
        include: { person: true }
      });
      const existingGlobal = await prisma.person.findMany({ where: { dni: { in: dnis } } });
      res.json({
        originalFilename: req.file.originalname,
        sheetName: parsed.sheetName,
        headers: parsed.headers,
        mapping: parsed.mapping,
        previewRows: parsed.rows,
        summary: {
          ...parsed.summary,
          existingInEvent: existingInEvent.length,
          existingGlobal: existingGlobal.length,
          newPeople: Math.max(parsed.summary.validRows - existingGlobal.length, 0)
        }
      });
      return;
    }

    const cuils = parsed.rows.map((row) => normalizeCuil(String(row.canonical.cuil ?? ""))).filter(Boolean);
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
      sheetName: parsed.sheetName,
      headers: parsed.headers,
      mapping: parsed.mapping,
      previewRows: parsed.rows,
      summary: {
        ...parsed.summary,
        existingInEvent: existingInEvent.length,
        existingGlobal: existingGlobal.length,
        newPeople: Math.max(parsed.summary.validRows - existingGlobal.length, 0)
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("no contiene hojas")) {
      res.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

router.post(
  "/:id/imports/confirm",
  requireRoles(...IMPORT_ROLES),
  upload.single("file"),
  async (req, res, next) => {
    try {
      await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN", req.auth!.role);
      const kind = await assertEventKindForRole(req.params.id, req.auth!.role);
      if (!req.file || !req.file.originalname.endsWith(".xlsx")) {
        res.status(400).json({ message: "Debe subir el archivo .xlsx" });
        return;
      }

      const parsed = parseWorkbookRows(req.file.buffer, kind);
      const updatedBatch = await importParsedRows(
        req.params.id,
        kind,
        req.auth!.id,
        req.file.originalname,
        parsed
      );
      await createAuditLog({
        req,
        action: "import.confirm",
        entityType: "importBatch",
        entityId: updatedBatch.id,
        metadata: {
          importedRows: updatedBatch.importedRows,
          invalidRows: updatedBatch.invalidRows,
          totalRows: updatedBatch.totalRows
        }
      });
      res.status(201).json(updatedBatch);
    } catch (error) {
      if (error instanceof Error && error.message.includes("no contiene hojas")) {
        res.status(400).json({ message: error.message });
        return;
      }
      next(error);
    }
  }
);

router.get("/:id/imports", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN", req.auth!.role);
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
