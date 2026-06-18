import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";
import {
  buildAccreditorPodiumStats,
  sortByAveragePerEvent,
  sortByTotalCount
} from "./podium-logic";

const router = Router();
router.use(requireAuth);
router.use(requireRoles("SUPERADMIN"));

type PodiumUserRow = {
  userId: string | null;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  isActive: boolean;
  count: number;
  eventCount: number;
  averagePerEvent: number;
};

async function enrichPodiumRows(
  stats: Array<{
    userId: string;
    count: number;
    eventCount: number;
    averagePerEvent: number;
  }>,
  limit: number
): Promise<PodiumUserRow[]> {
  const slice = stats.slice(0, limit);
  const userIds = slice.map((row) => row.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, role: true, isActive: true }
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return slice.map((row) => {
    const user = userById.get(row.userId);
    return {
      userId: row.userId,
      userName: user?.name ?? "Usuario eliminado",
      userEmail: user?.email ?? null,
      userRole: user?.role ?? null,
      isActive: user?.isActive ?? false,
      count: row.count,
      eventCount: row.eventCount,
      averagePerEvent: Number(row.averagePerEvent.toFixed(2))
    };
  });
}

/**
 * Podio histórico: volumen total y promedio por evento en el que acreditó cada persona.
 * El frontend toma las primeras tres filas de cada ranking para el podio 1°/2°/3°.
 */
router.get("/podium", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 3), 50);

    const accreditations = await prisma.eventPerson.findMany({
      where: {
        status: "accredited",
        accreditedByUserId: { not: null }
      },
      select: {
        accreditedByUserId: true,
        eventId: true
      }
    });

    const rows = accreditations
      .filter((row): row is { accreditedByUserId: string; eventId: string } =>
        Boolean(row.accreditedByUserId)
      )
      .map((row) => ({
        accreditedByUserId: row.accreditedByUserId,
        eventId: row.eventId
      }));

    const { totalAccredited, totalEventsWithAccreditations, stats } = buildAccreditorPodiumStats(rows);

    const [ranking, averageRanking] = await Promise.all([
      enrichPodiumRows(sortByTotalCount(stats), limit),
      enrichPodiumRows(sortByAveragePerEvent(stats), limit)
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      totalAccredited,
      totalEventsWithAccreditations,
      ranking,
      averageRanking
    });
  } catch (error) {
    next(error);
  }
});

export const adminRoutes = router;
