import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../prisma-exports";
import { StatusCodes } from "http-status-codes";

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(StatusCodes.UNAUTHORIZED).json({ message: "No autenticado" });
      return;
    }
    if (!roles.includes(req.auth.role as UserRole)) {
      res.status(StatusCodes.FORBIDDEN).json({ message: "Sin permisos" });
      return;
    }
    next();
  };
}
