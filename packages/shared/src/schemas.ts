import { z } from "zod";
import { isValidCuil, normalizeCuil, parseManualDocument } from "./cuil";
import { ROLE_OPTIONS } from "./constants";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email("Email inválido")),
  password: z.string().min(6, "Mínimo 6 caracteres")
});

export const cuilSchema = z
  .string()
  .min(1, "CUIL requerido")
  .transform(normalizeCuil)
  .refine((value) => value.length === 11, "CUIL debe tener 11 dígitos")
  .refine((value) => isValidCuil(value), "CUIL inválido");

const manualDocumentSchema = z
  .string()
  .min(1, "CUIL o DNI requerido")
  .superRefine((value, ctx) => {
    try {
      parseManualDocument(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "CUIL o DNI inválido"
      });
    }
  });

export const manualPersonSchema = z.object({
  cuilRaw: manualDocumentSchema,
  firstName: z.string().min(1, "Nombre requerido"),
  lastName: z.string().min(1, "Apellido requerido"),
  email: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v == null ? null : v)),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  accreditationNotes: z.string().optional().nullable()
});

export const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(ROLE_OPTIONS),
  isActive: z.boolean().default(true)
});
