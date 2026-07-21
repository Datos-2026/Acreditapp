import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { AppError } from "./error-handler";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Autenticación máquina-a-máquina con API key.
 * Acepta header `X-Api-Key` o `Authorization: Bearer <key>`.
 */
export function requireExternalApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configured = env.EXTERNAL_EVENTS_API_KEY?.trim();
  if (!configured) {
    next(new AppError("API externa de eventos no configurada (EXTERNAL_EVENTS_API_KEY)", 503));
    return;
  }

  const headerKey = req.header("x-api-key")?.trim();
  const auth = req.header("authorization")?.trim();
  const bearerKey =
    auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : undefined;
  const provided = headerKey || bearerKey;

  if (!provided || !safeEqual(provided, configured)) {
    next(new AppError("API key inválida o faltante", 401));
    return;
  }

  next();
}
