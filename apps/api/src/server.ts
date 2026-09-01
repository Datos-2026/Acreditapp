import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { ensureLocalDevWorkspace, isDevSkipAuth } from "./lib/dev-skip-auth";
import { archiveClosedEventsDue } from "./modules/events/archive-closed-events";

const host = process.env.LISTEN_HOST ?? "0.0.0.0";
const ARCHIVE_JOB_MS = 6 * 60 * 60 * 1000;

function runArchiveJob(reason: string): void {
  void archiveClosedEventsDue()
    .then((result) => {
      if (result.archived > 0 || result.failed > 0) {
        logger.info({ ...result, reason }, "Job de archivo a Google Sheets");
      }
    })
    .catch((err) => {
      logger.error({ err, reason }, "Falló el job de archivo a Google Sheets");
    });
}

app.listen(env.API_PORT, host, () => {
  logger.info({ port: env.API_PORT, host }, "Servidor escuchando");
  if (isDevSkipAuth()) {
    void ensureLocalDevWorkspace().catch((err) => {
      logger.error({ err }, "No se pudo preparar el usuario/evento local de skip-auth");
    });
  }
  if (env.ARCHIVE_CLOSED_EVENTS) {
    runArchiveJob("startup");
    setInterval(() => runArchiveJob("interval"), ARCHIVE_JOB_MS);
  } else {
    logger.info("Job de archivo automático a Sheets desactivado (ARCHIVE_CLOSED_EVENTS)");
  }
});
