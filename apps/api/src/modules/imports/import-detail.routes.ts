import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/:id", async (req, res) => {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      rowErrors: true,
      uploadedByUser: { select: { id: true, name: true, email: true } },
      event: { select: { id: true, name: true } }
    }
  });
  res.json(batch);
});

export const importDetailRoutes = router;
