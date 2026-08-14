import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");
const sharedSrc = path.resolve(rootDir, "../../packages/shared/src/index.ts");

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const apiPort = rootEnv.API_PORT || process.env.API_PORT || "4000";
  const webPort = Number(rootEnv.WEB_PORT || process.env.WEB_PORT || 5173);
  /** Dev only: browser talks to Vite; `/api` is proxied to the API. */
  const devApiTarget = process.env.VITE_DEV_API_PROXY ?? `http://127.0.0.1:${apiPort}`;

  return {
  base: "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        name: "GCBA | Acreditación",
        short_name: "Acreditación",
        description: "Terminal de acreditación de eventos GCBA",
        theme_color: "#153244",
        background_color: "#153244",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        lang: "es-AR",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  resolve: {
    alias: {
      "@gcba/shared": sharedSrc
    }
  },
  server: {
    port: webPort,
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: true
      }
    }
  }
  };
});
