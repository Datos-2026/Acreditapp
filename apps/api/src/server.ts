import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

const host = process.env.LISTEN_HOST ?? "0.0.0.0";

app.listen(env.API_PORT, host, () => {
  logger.info({ port: env.API_PORT, host }, "Servidor escuchando");
});
