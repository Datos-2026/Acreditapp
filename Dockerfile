# Producción: un solo proceso en :3000 (Express + estático de Vite build).
# Variables en runtime: DATABASE_URL, JWT_*, CORS_ORIGIN (URL pública), COOKIE_SECURE si hay HTTPS.
# SKIP_DB_MIGRATE=1 si las migraciones las corre otro job (ej. initContainer).
FROM node:22-alpine

LABEL org.opencontainers.image.title="gcba-acreditacion"
LABEL org.opencontainers.image.description="API + SPA estática"

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/scripts ./apps/api/scripts

RUN npm ci

COPY . .

RUN npm run db:generate -w @gcba/api

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build -w @gcba/web
RUN npm run build -w @gcba/api

COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

WORKDIR /app/apps/api
ENTRYPOINT ["/entrypoint.sh"]
