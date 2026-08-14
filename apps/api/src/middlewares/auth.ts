import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env";
import { ensureLocalDevWorkspace, isDevSkipAuth } from "../lib/dev-skip-auth";

type AccessPayload = {
  sub: string;
  role: string;
  email: string;
  name: string;
};

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
      req.auth = {
        id: payload.sub,
        role: payload.role as never,
        email: payload.email,
        name: payload.name
      };
      next();
      return;
    } catch {
      if (!isDevSkipAuth()) {
        res.status(StatusCodes.UNAUTHORIZED).json({ message: "Token inválido" });
        return;
      }
    }
  }

  if (isDevSkipAuth()) {
    void ensureLocalDevWorkspace()
      .then((user) => {
        req.auth = {
          id: user.id,
          role: user.role,
          email: user.email,
          name: user.name
        };
        next();
      })
      .catch(next);
    return;
  }

  res.status(StatusCodes.UNAUTHORIZED).json({ message: "No autenticado" });
}
