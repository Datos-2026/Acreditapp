import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { ensureLocalDevWorkspace, isDevSkipAuth } from "./lib/dev-skip-auth";

const host = process.env.LISTEN_HOST ?? "0.0.0.0";

app.listen(env.API_PORT, host, () => {
  logger.info({ port: env.API_PORT, host }, "Servidor escuchando");
  if (isDevSkipAuth()) {
    void ensureLocalDevWorkspace().catch((err) => {
      logger.error({ err }, "No se pudo preparar el usuario/evento local de skip-auth");
    });
  }
});
