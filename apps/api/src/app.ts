import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { eventsRoutes } from "./modules/events/events.routes";
import { importsRoutes } from "./modules/imports/imports.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { importDetailRoutes } from "./modules/imports/import-detail.routes";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/events", eventsRoutes);
app.use("/api/v1/events", importsRoutes);
app.use("/api/v1/events", dashboardRoutes);
app.use("/api/v1/imports", importDetailRoutes);

app.use(errorHandler);
