import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { ensureLocalDevWorkspace, isDevSkipAuth } from "./lib/dev-skip-auth";
import { archiveClosedEventsDue, reconcileAcreditadosMysql } from "./modules/events/archive-closed-events";
import { ensureAcreditadosDatabase, isAcreditadosMysqlConfigured } from "./modules/events/acreditados-mysql";
import {
  ensureBaseAcreditadosSchema,
  isBaseAcreditadosConfigured
} from "./modules/base-acreditados/mysql";
import { reconcileClosedEventsToBase } from "./modules/base-acreditados/sync";

const host = process.env.LISTEN_HOST ?? "0.0.0.0";
const ARCHIVE_JOB_MS = 6 * 60 * 60 * 1000;

function runArchiveJob(reason: string): void {
  void archiveClosedEventsDue()
    .then((result) => {
      if (result.archived > 0 || result.failed > 0) {
        logger.info({ ...result, reason }, "Job de archivo a MySQL ACREDITADOS");
      }
    })
    .catch((err) => {
      logger.error({ err, reason }, "Falló el job de archivo a MySQL ACREDITADOS");
    });
}

app.listen(env.API_PORT, host, () => {
  logger.info({ port: env.API_PORT, host }, "Servidor escuchando");
  if (isAcreditadosMysqlConfigured()) {
    void ensureAcreditadosDatabase()
      .then(() => reconcileAcreditadosMysql())
      .catch((err) => {
        logger.error({ err }, "No se pudo crear/verificar la base MySQL ACREDITADOS");
      });
  }
  if (isBaseAcreditadosConfigured()) {
    void ensureBaseAcreditadosSchema()
      .then(() => reconcileClosedEventsToBase())
      .then((result) => {
        logger.info(result, "Reconciliación de eventos cerrados con BASE_ACREDITADOS terminada");
      })
      .catch((err) => {
        logger.error({ err }, "No se pudo reconciliar BASE_ACREDITADOS");
      });
  }
  if (isDevSkipAuth()) {
    void ensureLocalDevWorkspace().catch((err) => {
      logger.error({ err }, "No se pudo preparar el usuario/evento local de skip-auth");
    });
  }
  if (env.ARCHIVE_CLOSED_EVENTS) {
    runArchiveJob("startup");
    setInterval(() => runArchiveJob("interval"), ARCHIVE_JOB_MS);
  } else {
    logger.info("Job de archivo automático a MySQL ACREDITADOS desactivado (ARCHIVE_CLOSED_EVENTS)");
  }
});
