import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

app.listen(env.API_PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.API_PORT}`);
});
