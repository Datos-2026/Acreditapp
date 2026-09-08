import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  closeBaseAcreditadosPool,
  dropBaseAcreditadosDatabase,
  ensureBaseAcreditadosSchema
} from "../src/modules/base-acreditados/mysql";
import {
  getBaseAcreditadosStats,
  importHistoricalWorkbook,
  loadDotacionIndex,
  previewHistoricalWorkbook
} from "../src/modules/base-acreditados/service";
import {
  importExistingAcreditadosTables,
  reconcileClosedEventsToBase
} from "../src/modules/base-acreditados/sync";

async function close(): Promise<void> {
  await Promise.allSettled([closeBaseAcreditadosPool(), prisma.$disconnect()]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rebuild = args.includes("--rebuild");
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) {
    throw new Error(
      'Uso: npm run base-acreditados:import -- "C:\\ruta\\archivo.xlsx" [--dry-run] [--rebuild]'
    );
  }
  const filename = resolve(input);
  const buffer = await readFile(filename);
  if (!filename.toLowerCase().endsWith(".xlsx")) throw new Error("El archivo debe ser .xlsx");

  const preview = previewHistoricalWorkbook(buffer);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, filename, ...preview }, null, 2));
    return;
  }

  if (rebuild) await dropBaseAcreditadosDatabase();
  await ensureBaseAcreditadosSchema();
  const dotacion = await loadDotacionIndex();
  const historical = await importHistoricalWorkbook(buffer, filename, dotacion);
  const mysqlEvents = await importExistingAcreditadosTables(dotacion);
  const appEvents = await reconcileClosedEventsToBase();
  const validation = await getBaseAcreditadosStats();
  console.log(
    JSON.stringify(
      {
        database: "BASE_ACREDITADOS",
        dotacion: {
          database: dotacion.database,
          table: dotacion.table,
          rows: dotacion.rows
        },
        historical,
        mysqlEvents,
        appEvents,
        validation
      },
      null,
      2
    )
  );
}

main()
  .then(close)
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await close();
    process.exitCode = 1;
  });

