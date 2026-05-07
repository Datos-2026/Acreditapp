import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Dev only: browser talks to Vite; `/api` is proxied to the API (see VITE_DEV_API_PROXY). Docker/production serves `dist` from Express — no Vite server. */
const devApiTarget = process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:4000";

export default defineConfig({
  base: "/",
  plugins: [react()],
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
