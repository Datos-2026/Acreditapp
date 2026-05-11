import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { userSchema } from "@gcba/shared";
import { Prisma, UserRole } from "../../prisma-exports";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import { validateBody } from "../../middlewares/validate";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../middlewares/error-handler";

const router = Router();

const createUserSchema = userSchema.extend({
  password: z.string().min(8, "Contraseña mínima de 8 caracteres")
});

const patchUserSchema = userSchema.partial().extend({
  password: z.string().min(8).optional()
});

router.use(requireAuth);

router.get("/", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(users);
});

router.post("/", requireRoles("SUPERADMIN"), validateBody(createUserSchema), async (req, res, next) => {
  try {
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = await prisma.user.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        isActive: req.body.isActive ?? true,
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
    await createAuditLog({
      req,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      metadata: { role: user.role }
    });
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      next(new AppError("Ya existe un usuario con ese email", 409));
      return;
    }
    next(error);
  }
});

router.get("/:id", requireRoles("SUPERADMIN", "ADMIN_EVENTO"), async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json(user);
});

router.patch("/:id", requireRoles("SUPERADMIN"), validateBody(patchUserSchema), async (req, res, next) => {
  try {
    const data: Record<string, unknown> = { ...req.body };
    if (req.body.password) {
      data.passwordHash = await bcrypt.hash(req.body.password, 12);
      delete data.password;
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await createAuditLog({
      req,
      action: "user.update",
      entityType: "user",
      entityId: user.id,
      metadata: req.body
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

/** Acreditadores, admins de evento y lectura; no otras cuentas superadmin. */
const DELETABLE_ROLES: UserRole[] = [
  UserRole.ACREDITADOR,
  UserRole.ADMIN_EVENTO,
  UserRole.LECTURA,
  UserRole.INFORMADOR
];

router.delete("/:id", requireRoles("SUPERADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id;
    if (id === req.auth!.id) {
      next(new AppError("No podés eliminar tu propio usuario", 400));
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true }
    });
    if (!target) {
      next(new AppError("Usuario no encontrado", 404));
      return;
    }
    if (!DELETABLE_ROLES.includes(target.role)) {
      next(new AppError("No se pueden eliminar cuentas superadmin", 400));
      return;
    }

    const imports = await prisma.importBatch.count({ where: { uploadedByUserId: id } });
    if (imports > 0) {
      next(
        new AppError(
          "No se puede eliminar: este usuario tiene importaciones registradas. Contactá a soporte o reasigná antes.",
          409
        )
      );
      return;
    }

    await prisma.user.delete({ where: { id } });
    await createAuditLog({
      req,
      action: "user.delete",
      entityType: "user",
      entityId: id,
      metadata: { email: target.email, role: target.role }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export const usersRoutes = router;
