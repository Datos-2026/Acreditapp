import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../../.env" });
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  JWT_ACCESS_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
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
  GEMINI_MODEL: z.string().optional().default("gemma-4-31b-it")
});

export const env = envSchema.parse(process.env);
