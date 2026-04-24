import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { userSchema } from "@gcba/shared";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import { validateBody } from "../../middlewares/validate";
import { createAuditLog } from "../../lib/audit";

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
      data
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

export const usersRoutes = router;
