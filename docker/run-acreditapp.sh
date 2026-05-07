#!/usr/bin/env bash
# Run the local image `acreditapp:latest` with Helio / dev-like env (API + static SPA on API_PORT).
set -euo pipefail

IMAGE="${IMAGE:-acreditapp:latest}"
NAME="${NAME:-acreditapp-run}"
HOST_PORT="${HOST_PORT:-4000}"

exec docker container run --rm -it \
  --name "${NAME}" \
  -p "${HOST_PORT}:${HOST_PORT}" \
  -e DATABASE_URL='postgresql://postgres:88cbb2c0-beef-470a-b6b6-639c8f27da62@vpn.helio3.co:5433/acreditapp?schema=public&sslmode=disable' \
  -e API_PORT="${HOST_PORT}" \
  -e WEB_PORT=5173 \
  -e JWT_ACCESS_SECRET=dev_access_secret_change_me \
  -e JWT_REFRESH_SECRET=dev_refresh_secret_change_me \
  -e ACCESS_TOKEN_TTL_MINUTES=15 \
  -e REFRESH_TOKEN_TTL_DAYS=7 \
  -e CORS_ORIGIN=http://localhost:5173 \
  -e COOKIE_SECURE=false \
  -e GEMINI_API_KEY=AIzaSyBf1BiO5lVK97QLZ9jU3Qi_NkqeeXfWuxE \
  -e GEMINI_MODEL=gemma-4-31b-it \
  "${IMAGE}"
