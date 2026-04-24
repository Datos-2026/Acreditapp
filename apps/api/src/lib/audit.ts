import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditInput = {
  req: Request;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createAuditLog(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.req.auth?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      ip: input.req.ip ?? null,
      userAgent: input.req.headers["user-agent"] ?? null
    }
  });
}
