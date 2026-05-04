import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { StatusCodes } from "http-status-codes";
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError
} from "../generated/prisma/runtime/library";
import { logger } from "../lib/logger";

const DB_UNAVAILABLE =
  "No hay conexión con la base de datos. Si usás un Postgres remoto (ej. vpn.helio3.co), conectá la VPN o cambiá DATABASE_URL en .env. Para desarrollo local: docker compose up -d y la URL de .env.example (localhost:5432).";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = StatusCodes.BAD_REQUEST) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error(error);
  if (error instanceof ZodError) {
    res.status(StatusCodes.BAD_REQUEST).json({
      message: "Error de validación",
      issues: error.issues
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  if (error instanceof PrismaClientInitializationError) {
    res.status(StatusCodes.SERVICE_UNAVAILABLE).json({ message: DB_UNAVAILABLE, code: "P_DB_INIT" });
    return;
  }
  if (error instanceof PrismaClientKnownRequestError) {
    const connectionCodes = new Set(["P1000", "P1001", "P1002", "P1013", "P1017"]);
    if (connectionCodes.has(error.code)) {
      res
        .status(StatusCodes.SERVICE_UNAVAILABLE)
        .json({ message: DB_UNAVAILABLE, code: error.code });
      return;
    }
  }
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error interno del servidor" });
}
