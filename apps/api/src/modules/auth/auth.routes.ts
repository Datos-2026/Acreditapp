import { Router } from "express";
import rateLimit from "express-rate-limit";
import { loginSchema } from "@gcba/shared";
import { validateBody } from "../../middlewares/validate";
import { requireAuth } from "../../middlewares/auth";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { env } from "../../config/env";
import { login, logout, refresh } from "./auth.service";
import { prisma } from "../../lib/prisma";

const refreshCookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  maxAge: 1000 * 60 * 60 * 24 * 7
};

const router = Router();

const isProd = process.env.NODE_ENV === "production";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 50 : 400,
  standardHeaders: true,
  legacyHeaders: false
});

router.post("/login", loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await login(req.body.email, req.body.password);
    res.cookie("refreshToken", result.tokens.refreshToken, refreshCookieOptions);
    res.json({ accessToken: result.tokens.accessToken });
    void createAuditLog({
      req,
      action: "auth.login",
      entityType: "user",
      entityId: result.userId,
      actorUserId: result.userId
    }).catch((err) => logger.error({ err }, "audit auth.login"));
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken as string | undefined;
    if (!refreshToken) {
      res.status(401).json({ message: "No autenticado" });
      return;
    }
    const tokens = await refresh(refreshToken);
    res.cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);
    res.json({ accessToken: tokens.accessToken });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await logout(req.auth!.id);
    res.clearCookie("refreshToken");
    await createAuditLog({
      req,
      action: "auth.logout",
      entityType: "user",
      entityId: req.auth!.id
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth!.id },
    select: { id: true, name: true, email: true, role: true, isActive: true }
  });
  res.json(user);
});

router.post("/forgot-password", async (_req, res) => {
  res.json({ message: "Endpoint preparado para integración de email." });
});

export const authRoutes = router;
