#!/bin/sh
set -e
cd /app/apps/api

if [ "${SKIP_DB_MIGRATE:-0}" != "1" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] prisma migrate deploy"
  npm run db:migrate
fi

exec npx tsx src/server.ts
