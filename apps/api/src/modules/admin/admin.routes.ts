import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";
import { requireRoles } from "../../middlewares/rbac";

const router = Router();
router.use(requireAuth);
router.use(requireRoles("SUPERADMIN"));

/**
 * Podio histórico: los acreditadores con más acreditaciones sumando todos los eventos.
 * Devuelve hasta `limit` filas (por defecto 10) ordenadas descendente.
 * El frontend toma las primeras tres para mostrar el podio 1°/2°/3°.
 */
router.get("/podium", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 3), 50);

    const grouped = await prisma.eventPerson.groupBy({
      by: ["accreditedByUserId"],
      where: {
        status: "accredited",
        accreditedByUserId: { not: null }
      },
      _count: { _all: true }
    });

    const userIds = grouped
      .map((row) => row.accreditedByUserId)
      .filter((id): id is string => Boolean(id));

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true, isActive: true }
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const ranking = grouped
      .map((row) => {
        const user = userById.get(row.accreditedByUserId ?? "");
        return {
          userId: row.accreditedByUserId,
          userName: user?.name ?? "Usuario eliminado",
          userEmail: user?.email ?? null,
          userRole: user?.role ?? null,
          isActive: user?.isActive ?? false,
          count: row._count._all
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const totalAccredited = await prisma.eventPerson.count({
      where: { status: "accredited", accreditedByUserId: { not: null } }
    });

    res.json({
      generatedAt: new Date().toISOString(),
      totalAccredited,
      ranking
    });
  } catch (error) {
    next(error);
  }
});

export const adminRoutes = router;
