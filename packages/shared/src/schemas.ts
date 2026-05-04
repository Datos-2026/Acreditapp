import { z } from "zod";
import { isValidCuil, normalizeCuil } from "./cuil";
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

export const manualPersonSchema = z.object({
  cuilRaw: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dni: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  accreditationNotes: z.string().optional().nullable()
});

export const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(ROLE_OPTIONS),
  isActive: z.boolean().default(true)
});
