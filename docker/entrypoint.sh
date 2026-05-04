#!/bin/sh
set -e
cd /app/apps/api

if [ "${SKIP_DB_MIGRATE:-0}" != "1" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] prisma migrate deploy"
  npx prisma migrate deploy --schema prisma/schema.prisma
fi

exec node dist/src/server.js
