import type { EventKind } from "../../prisma-exports";
import { UserRole } from "../../prisma-exports";
import type { Prisma } from "../../prisma-exports";
import { AppError } from "../../middlewares/error-handler";
import { prisma } from "../../lib/prisma";

export function isSuperAdmin(role: string): boolean {
  return role === UserRole.SUPERADMIN;
}

export function isAdminVecinos(role: string): boolean {
  return role === UserRole.ADMIN_VECINOS;
}

/** Filtro de listado de eventos según rol del usuario autenticado. */
export function eventsListWhere(userId: string, role: string): Prisma.EventWhereInput {
  if (role === UserRole.SUPERADMIN) return {};
  if (role === UserRole.ADMIN_VECINOS) {
    return {
      kind: "vecinos",
      eventUsers: { some: { userId } }
    };
  }
  return { eventUsers: { some: { userId } } };
}

export function assertRoleCanCreateEventKind(role: string, kind: EventKind): void {
  if (role === UserRole.ADMIN_VECINOS && kind !== "vecinos") {
    throw new AppError("Solo podés crear eventos de vecinos", 403);
  }
  if (role === UserRole.ADMIN_EVENTO && kind === "vecinos") {
    throw new AppError("Los administradores de evento GCBA no pueden crear eventos de vecinos", 403);
  }
}

export async function assertEventKindForRole(eventId: string, role: string): Promise<EventKind> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { kind: true }
  });
  if (!event) throw new AppError("Evento no encontrado", 404);
  if (role === UserRole.ADMIN_VECINOS && event.kind !== "vecinos") {
    throw new AppError("No tiene acceso a eventos GCBA", 403);
  }
  return event.kind;
}

/** Roles operativos que ADMIN_VECINOS puede crear. */
export const VECINOS_CREATABLE_ROLES = [
  UserRole.ACREDITADOR,
  UserRole.LECTURA,
  UserRole.INFORMADOR
] as const;
