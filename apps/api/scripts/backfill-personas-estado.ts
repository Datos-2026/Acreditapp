import { closeBaseAcreditadosPool, ensureBaseAcreditadosSchema } from "../src/modules/base-acreditados/mysql";
import {
  backfillPersonaEstadoYEventosFromLegacy,
  getBaseAcreditadosStats
} from "../src/modules/base-acreditados/service";

async function main(): Promise<void> {
  await ensureBaseAcreditadosSchema();
  const backfill = await backfillPersonaEstadoYEventosFromLegacy();
  const stats = await getBaseAcreditadosStats();
  console.log(JSON.stringify({ backfill, stats }, null, 2));
}

main()
  .then(() => closeBaseAcreditadosPool())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await closeBaseAcreditadosPool();
    process.exitCode = 1;
  });
