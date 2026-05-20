import { Router } from "express";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../middlewares/error-handler";
import {
  DIRECTORY_CREATE_CHUNK,
  parseDirectoryWorkbook
} from "./directory-logic";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const router = Router();
router.use(requireAuth);
router.use(requireRoles("SUPERADMIN"));

router.get("/stats", async (_req, res, next) => {
  try {
    const [total, lastUpload] = await Promise.all([
      prisma.directoryPerson.count(),
      prisma.directoryUpload.findFirst({
        orderBy: { createdAt: "desc" },
        include: { uploadedByUser: { select: { name: true, email: true } } }
      })
    ]);

    res.json({
      total,
      lastUpload: lastUpload
        ? {
            filename: lastUpload.originalFilename,
            createdAt: lastUpload.createdAt.toISOString(),
            uploadedBy: lastUpload.uploadedByUser.name ?? lastUpload.uploadedByUser.email
          }
        : null
    });
  } catch (error) {
    next(error);
  }
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      throw new AppError("Archivo requerido", 400);
    }
    const originalFilename = req.file.originalname || "dotacion.xlsx";
    if (!originalFilename.toLowerCase().endsWith(".xlsx")) {
      throw new AppError("Solo se aceptan archivos .xlsx", 400);
    }

    let parsed;
    try {
      parsed = parseDirectoryWorkbook(req.file.buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo leer el archivo";
      throw new AppError(message, 400);
    }

    if (parsed.length === 0) {
      throw new AppError("No hay filas válidas para importar", 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.directoryPerson.deleteMany();
      for (let i = 0; i < parsed.length; i += DIRECTORY_CREATE_CHUNK) {
        const chunk = parsed.slice(i, i + DIRECTORY_CREATE_CHUNK);
        await tx.directoryPerson.createMany({ data: chunk });
      }
      await tx.directoryUpload.create({
        data: {
          uploadedByUserId: req.auth!.id,
          originalFilename,
          totalRows: parsed.length
        }
      });
    });

    await createAuditLog({
      req,
      action: "directory.upload",
      entityType: "directory",
      entityId: "global",
      metadata: { rows: parsed.length, originalFilename }
    });

    res.status(201).json({ total: parsed.length, originalFilename });
  } catch (error) {
    next(error);
  }
});

export const directoryRoutes = router;
