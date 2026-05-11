import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

/** Path dentro del router montado en `/api/v1/events` (sin query). */
function scopedEventsPath(req: Request): string {
  const full = (req.originalUrl ?? req.url ?? "").split("?")[0];
  const base = req.baseUrl ?? "";
  if (base && full.startsWith(base)) {
    const rest = full.slice(base.length);
    return rest && rest.length > 0 ? rest : "/";
  }
  return full || "/";
}

/**
 * Rol INFORMADOR: solo listado de eventos (GET /) y lectura del informe (GET /:id/report).
 * Debe ir después de `requireAuth`.
 */
export function rejectInformadorExceptReportRead(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== "INFORMADOR") {
    next();
    return;
  }

  const p = scopedEventsPath(req);
  if (req.method === "GET" && (p === "/" || p === "")) {
    next();
    return;
  }
  if (req.method === "GET" && /^\/[^/]+\/report\/?$/.test(p)) {
    next();
    return;
  }

  res.status(StatusCodes.FORBIDDEN).json({
    message: "Los usuarios con rol Informador solo pueden ver el informe de los eventos asignados."
  });
}
