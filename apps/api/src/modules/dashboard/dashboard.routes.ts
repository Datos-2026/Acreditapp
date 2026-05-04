import { Router } from "express";
import { subDays } from "date-fns";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { ensureEventAccess } from "../events/event-access";

const router = Router();
router.use(requireAuth);

function buildTimelineBuckets(dates: Array<Date | null>): Array<{ bucket: string; count: number }> {
  const map = new Map<string, number>();
  for (const date of dates) {
    if (!date) continue;
    const bucket = new Date(date);
    bucket.setMinutes(0, 0, 0);
    const key = bucket.toISOString();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([bucket, count]) => ({ bucket, count }));
}

router.get("/:id/stats", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const eventId = req.params.id;
    const since24h = subDays(new Date(), 1);
    const [
      total,
      accredited,
      manual,
      importedInBase,
      pendingImported,
      accreditedImported,
      accreditedManual,
      accreditedLast24h,
      accreditorGroups,
      importBatchCount,
      latest
    ] = await Promise.all([
      prisma.eventPerson.count({ where: { eventId } }),
      prisma.eventPerson.count({ where: { eventId, status: "accredited" } }),
      prisma.eventPerson.count({ where: { eventId, source: "manual" } }),
      prisma.eventPerson.count({ where: { eventId, source: "imported" } }),
      prisma.eventPerson.count({ where: { eventId, source: "imported", status: "pending" } }),
      prisma.eventPerson.count({ where: { eventId, source: "imported", status: "accredited" } }),
      prisma.eventPerson.count({ where: { eventId, source: "manual", status: "accredited" } }),
      prisma.eventPerson.count({
        where: {
          eventId,
          status: "accredited",
          accreditedAt: { gte: since24h }
        }
      }),
      prisma.eventPerson.groupBy({
        by: ["accreditedByUserId"],
        where: { eventId, status: "accredited", accreditedByUserId: { not: null } },
        _count: true
      }),
      prisma.importBatch.count({ where: { eventId } }),
      prisma.auditLog.findMany({
        where: { entityType: "eventPerson" },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);
    res.json({
      totalBase: total,
      accredited,
      pending: Math.max(total - accredited, 0),
      manual,
      importedInBase,
      pendingImported,
      accreditedImported,
      accreditedManual,
      accreditedToday: accreditedLast24h,
      accreditationPercent: total > 0 ? Number(((accredited / total) * 100).toFixed(2)) : 0,
      accreditationPercentImportedBase:
        importedInBase > 0 ? Number(((accreditedImported / importedInBase) * 100).toFixed(2)) : 0,
      accreditorsActive: accreditorGroups.length,
      importBatches: importBatchCount,
      latest
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/stats/by-user", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const byUser = await prisma.eventPerson.groupBy({
      by: ["accreditedByUserId"],
      where: {
        eventId: req.params.id,
        status: "accredited",
        accreditedByUserId: { not: null }
      },
      _count: { _all: true }
    });
    const users = await prisma.user.findMany({
      where: { id: { in: byUser.map((entry) => entry.accreditedByUserId!).filter(Boolean) } },
      select: { id: true, name: true }
    });
    res.json(
      byUser
        .map((entry: { accreditedByUserId: string | null; _count: { _all: number } }) => ({
          userId: entry.accreditedByUserId,
          count: entry._count._all,
          userName: users.find((u: { id: string; name: string }) => u.id === entry.accreditedByUserId)?.name ?? "Desconocido"
        }))
        .sort((a: { count: number }, b: { count: number }) => b.count - a.count)
    );
  } catch (error) {
    next(error);
  }
});

router.get("/:id/stats/timeline", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const accreditations = await prisma.eventPerson.findMany({
      where: { eventId: req.params.id, status: "accredited", accreditedAt: { not: null } },
      select: { accreditedAt: true }
    });
    res.json(buildTimelineBuckets(accreditations.map((item) => item.accreditedAt)));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/dashboard", async (req, res, next) => {
  try {
    await ensureEventAccess(req.params.id, req.auth!.id, req.auth!.role === "SUPERADMIN");
    const [stats, ranking, accreditations] = await Promise.all([
      prisma.eventPerson.groupBy({
        by: ["status", "source"],
        where: { eventId: req.params.id },
        _count: { _all: true }
      }),
      prisma.eventPerson.groupBy({
        by: ["accreditedByUserId"],
        where: { eventId: req.params.id, status: "accredited", accreditedByUserId: { not: null } },
        _count: { _all: true }
      }),
      prisma.eventPerson.findMany({
        where: { eventId: req.params.id, status: "accredited", accreditedAt: { not: null } },
        select: { accreditedAt: true }
      })
    ]);
    res.json({
      stats,
      ranking,
      timeline: buildTimelineBuckets(accreditations.map((item) => item.accreditedAt))
    });
  } catch (error) {
    next(error);
  }
});

export const dashboardRoutes = router;
