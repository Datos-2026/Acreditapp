import { UserRole } from "../../prisma-exports";
import { AppError } from "../../middlewares/error-handler";
import { prisma } from "../../lib/prisma";

export async function ensureEventAccess(
  eventId: string,
  userId: string,
  isSuperAdmin: boolean,
  userRole?: string
): Promise<void> {
  if (isSuperAdmin) return;

  if (userRole === UserRole.ADMIN_VECINOS) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { kind: true }
    });
    if (!event || event.kind !== "vecinos") {
      throw new AppError("No tiene acceso a eventos GCBA", 403);
    }
  }

  const assignment = await prisma.eventUser.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId
      }
    }
  });
  if (!assignment) {
    throw new AppError("No tiene acceso al evento", 403);
  }
}
