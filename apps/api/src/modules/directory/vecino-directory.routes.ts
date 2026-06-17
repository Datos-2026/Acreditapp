import { Router } from "express";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../middlewares/error-handler";
import {
  VECINO_DIRECTORY_CREATE_CHUNK,
  parseVecinoDirectoryWorkbook
} from "./vecino-directory-logic";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const router = Router();
router.use(requireAuth);
router.use(requireRoles("SUPERADMIN", "ADMIN_VECINOS"));

router.get("/stats", async (_req, res, next) => {
  try {
    const [total, lastUpload] = await Promise.all([
      prisma.vecinoDirectoryPerson.count(),
      prisma.vecinoDirectoryUpload.findFirst({
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
    if (!req.file?.buffer) throw new AppError("Archivo requerido", 400);
    const originalFilename = req.file.originalname || "vecinos.xlsx";
    if (!originalFilename.toLowerCase().endsWith(".xlsx")) {
      throw new AppError("Solo se aceptan archivos .xlsx", 400);
    }

    let parsed;
    try {
      parsed = parseVecinoDirectoryWorkbook(req.file.buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo leer el archivo";
      throw new AppError(message, 400);
    }

    if (parsed.length === 0) throw new AppError("No hay filas válidas para importar", 400);

    await prisma.$transaction(async (tx) => {
      await tx.vecinoDirectoryPerson.deleteMany();
      for (let i = 0; i < parsed.length; i += VECINO_DIRECTORY_CREATE_CHUNK) {
        const chunk = parsed.slice(i, i + VECINO_DIRECTORY_CREATE_CHUNK);
        await tx.vecinoDirectoryPerson.createMany({ data: chunk });
      }
      await tx.vecinoDirectoryUpload.create({
        data: {
          uploadedByUserId: req.auth!.id,
          originalFilename,
          totalRows: parsed.length
        }
      });
    });

    await createAuditLog({
      req,
      action: "vecinoDirectory.upload",
      entityType: "vecinoDirectory",
      entityId: "global",
      metadata: { rows: parsed.length, originalFilename }
    });

    res.status(201).json({ total: parsed.length, originalFilename });
  } catch (error) {
    next(error);
  }
});

export const vecinoDirectoryRoutes = router;
