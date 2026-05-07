FROM node:22-alpine

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

RUN npm run build -w @gcba/shared && npm run build -w @gcba/web && npm run build -w @gcba/api \
  && test -f /app/apps/web/dist/index.html

COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

WORKDIR /app/apps/api
ENTRYPOINT ["/entrypoint.sh"]
