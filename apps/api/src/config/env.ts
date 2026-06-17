import dotenv from "dotenv";
import { z } from "zod";
import { logger } from "../lib/logger";

dotenv.config({ path: "../../.env" });
dotenv.config();

function parseGoogleServiceAccountJson(raw: string | undefined): Record<string, string> | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      logger.warn("GOOGLE_SERVICE_ACCOUNT_JSON no contiene client_email o private_key");
      return null;
    }
    return {
      type: String(parsed.type ?? "service_account"),
      project_id: String(parsed.project_id ?? ""),
      private_key_id: String(parsed.private_key_id ?? ""),
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      client_email: parsed.client_email,
      client_id: String(parsed.client_id ?? ""),
      auth_uri: String(parsed.auth_uri ?? "https://accounts.google.com/o/oauth2/auth"),
      token_uri: String(parsed.token_uri ?? "https://oauth2.googleapis.com/token"),
      auth_provider_x509_cert_url: String(
        parsed.auth_provider_x509_cert_url ?? "https://www.googleapis.com/oauth2/v1/certs"
      ),
      client_x509_cert_url: String(parsed.client_x509_cert_url ?? "")
    };
  } catch (err) {
    logger.warn({ err }, "No se pudo parsear GOOGLE_SERVICE_ACCOUNT_JSON al iniciar la API");
    return null;
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  JWT_ACCESS_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  /** Orígenes permitidos separados por coma (ej. `http://localhost:5173,http://127.0.0.1:5173`). */
  CORS_ORIGIN: z
    .string()
    .default(
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
    ),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /** Solo servidor. Informe post-evento (Gemini). Opcional: sin clave, el análisis IA no se genera. */
  GEMINI_API_KEY: z.string().optional(),
  /**
   * Modelo para el informe IA (Gemini API). Por defecto: Gemma 4 31B instruct.
   * @see https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
   */
  GEMINI_MODEL: z.string().optional().default("gemma-4-31b-it"),
  /**
   * JSON de cuenta de servicio de Google (stringificado) para sincronizar acreditados vecinos a Sheets.
   * Compartí el spreadsheet con el client_email de la cuenta.
   */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  /** ID del libro de Google Sheets único para todos los eventos vecinos (una hoja por evento). */
  GOOGLE_SPREADSHEET_ID: z.string().optional()
});

const raw = envSchema.parse(process.env);

function expandLocalViteOrigins(origins: string[]): string[] {
  const out = new Set(origins);
  for (const o of origins) {
    try {
      const u = new URL(o);
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      if (port !== "5173" && port !== "3000") continue;
      const host = u.hostname.toLowerCase();
      if (host === "localhost") out.add(`http://127.0.0.1:${port}`);
      if (host === "127.0.0.1") out.add(`http://localhost:${port}`);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

const googleServiceAccountCredentials = parseGoogleServiceAccountJson(raw.GOOGLE_SERVICE_ACCOUNT_JSON);

if (raw.GOOGLE_SPREADSHEET_ID?.trim() && !googleServiceAccountCredentials) {
  logger.warn(
    "GOOGLE_SPREADSHEET_ID está definido pero GOOGLE_SERVICE_ACCOUNT_JSON no es válido; Google Sheets deshabilitado"
  );
}

export const env = {
  ...raw,
  GOOGLE_SERVICE_ACCOUNT_CREDENTIALS: googleServiceAccountCredentials,
  CORS_ORIGINS: expandLocalViteOrigins(
    raw.CORS_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
};
