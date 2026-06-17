import fs from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { errorHandler } from "./middlewares/error-handler";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { eventsRoutes } from "./modules/events/events.routes";
import { importsRoutes } from "./modules/imports/imports.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { importDetailRoutes } from "./modules/imports/import-detail.routes";
import { directoryRoutes } from "./modules/directory/directory.routes";
import { vecinoDirectoryRoutes } from "./modules/directory/vecino-directory.routes";
import { adminRoutes } from "./modules/admin/admin.routes";

export const app = express();

/** Evita 500 de express-rate-limit cuando hay `X-Forwarded-For` (VPN, proxy) sin trust proxy. */
app.set("trust proxy", 1);

app.use(
  helmet({
    /** index.html carga fuentes de Google; CSP por defecto las bloqueaba al servir el SPA desde Express. */
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"]
      }
    }
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (env.CORS_ORIGINS.includes(origin)) {
        callback(null, origin);
        return;
      }
      // No pasar Error: en cors eso dispara el errorHandler y devuelve 500.
      callback(null, false);
    },
    credentials: true,
    // Exponer Content-Disposition para que el front pueda leer el nombre de archivo en descargas.
    exposedHeaders: ["Content-Disposition"]
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "up" });
  } catch {
    res.status(503).json({ ok: false, database: "down", message: "Revisá DATABASE_URL, VPN o docker compose." });
  }
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/events", eventsRoutes);
app.use("/api/v1/events", importsRoutes);
app.use("/api/v1/events", dashboardRoutes);
app.use("/api/v1/imports", importDetailRoutes);
app.use("/api/v1/directory", directoryRoutes);
app.use("/api/v1/vecino-directory", vecinoDirectoryRoutes);
app.use("/api/v1/admin", adminRoutes);

/** Built to `dist/src/*.js` → three levels up to the `apps/` workspace folder. */
const __dirnameApp = __dirname;
const webDistPath =
  process.env.WEB_DIST_PATH ?? path.resolve(__dirnameApp, "../../../web/dist");
const spaIndexPath = path.join(webDistPath, "index.html");

if (fs.existsSync(spaIndexPath)) {
  app.use(express.static(webDistPath, { index: false }));
  logger.info({ webDistPath }, "Sirviendo frontend estático");
}

const spaFallback: RequestHandler = (req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ message: "Recurso no encontrado" });
    return;
  }
  if (fs.existsSync(spaIndexPath)) {
    res.sendFile(spaIndexPath);
    return;
  }
  next();
};

app.get("*", spaFallback);
app.head("*", spaFallback);

app.use(errorHandler);
