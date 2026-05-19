import { z } from "zod";
import { parseManualDocument } from "@gcba/shared";

/** Validación de alta manual en el front (CUIL o DNI). No usar cuilSchema. */
export const manualPersonFormSchema = z.object({
  cuilRaw: z
    .string()
    .trim()
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
    }),
  firstName: z.string().trim().min(1, "Nombre requerido"),
  lastName: z.string().trim().min(1, "Apellido requerido"),
  email: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v == null ? null : v)),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  accreditationNotes: z.string().optional().nullable()
});

export type ManualPersonFormValues = z.infer<typeof manualPersonFormSchema>;
