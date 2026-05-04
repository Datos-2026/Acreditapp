# Imagen de producción: API + frontend estático en un solo proceso (puerto 3000).
# Build del web con VITE_API_URL=/api/v1 para que el browser llame al mismo origen.
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci

COPY . .

RUN npm run db:generate -w @gcba/api

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build -w @gcba/web
RUN npm run build -w @gcba/api

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

WORKDIR /app/apps/api
CMD ["node", "dist/src/server.js"]
