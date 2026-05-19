import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sharedSrc = path.resolve(rootDir, "../../packages/shared/src/index.ts");

/** Dev only: browser talks to Vite; `/api` is proxied to the API (see VITE_DEV_API_PROXY). Docker/production serves `dist` from Express — no Vite server. */
const devApiTarget = process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:4000";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@gcba/shared": sharedSrc
    }
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: true
      }
    }
  }
});
