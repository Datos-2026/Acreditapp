import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { StatusCodes } from "http-status-codes";
import { logger } from "../lib/logger";

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
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error interno del servidor" });
}
