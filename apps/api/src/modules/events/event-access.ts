import { AppError } from "../../middlewares/error-handler";
import { prisma } from "../../lib/prisma";

export async function ensureEventAccess(eventId: string, userId: string, isSuperAdmin: boolean): Promise<void> {
  if (isSuperAdmin) return;
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
