import { prisma } from "../src/lib/prisma";
import { closeBaseAcreditadosPool, ensureBaseAcreditadosSchema } from "../src/modules/base-acreditados/mysql";
import { reconcileClosedEventsToBase } from "../src/modules/base-acreditados/sync";

async function close(): Promise<void> {
  await Promise.allSettled([closeBaseAcreditadosPool(), prisma.$disconnect()]);
}

async function main(): Promise<void> {
  await ensureBaseAcreditadosSchema();
  const result = await reconcileClosedEventsToBase();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(close)
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await close();
    process.exitCode = 1;
  });
