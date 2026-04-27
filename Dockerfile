FROM node:22-alpine

WORKDIR /app

# Dependencias mínimas para Prisma + Node en Alpine
RUN apk add --no-cache libc6-compat openssl

# Copiamos primero manifiestos para cachear instalación
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci

# Copiamos el resto del proyecto
COPY . .

# Genera cliente Prisma (necesario para API)
RUN npm run db:generate -w @gcba/api

EXPOSE 4000 5173

# Ejecuta API + WEB (sin docker-compose)
CMD ["npm", "run", "dev"]
