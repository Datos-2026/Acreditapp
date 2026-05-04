import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** En dev, un solo origen en el navegador: Vite (5173) y `/api/*` se reenvía al backend (4000). */
const devApiTarget = process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:4000";

export default defineConfig({
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
