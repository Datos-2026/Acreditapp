import { prisma } from "../src/lib/prisma";
import { closeBaseAcreditadosPool, ensureBaseAcreditadosSchema } from "../src/modules/base-acreditados/mysql";
import { backfillPersonaEstadoYEventosFromLegacy, getBaseAcreditadosStats } from "../src/modules/base-acreditados/service";
import { reconcileClosedEventsToBase } from "../src/modules/base-acreditados/sync";

async function close(): Promise<void> {
  await Promise.allSettled([closeBaseAcreditadosPool(), prisma.$disconnect()]);
}

async function main(): Promise<void> {
  await ensureBaseAcreditadosSchema();
  const backfill = await backfillPersonaEstadoYEventosFromLegacy();
  const result = await reconcileClosedEventsToBase();
  const stats = await getBaseAcreditadosStats();
  console.log(JSON.stringify({ backfill, result, stats }, null, 2));
}

main()
  .then(close)
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await close();
    process.exitCode = 1;
  });
