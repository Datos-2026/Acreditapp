import { z } from "zod";

import { EVENT_KIND_OPTIONS } from "@gcba/shared";

export const eventFormSchema = z
  .object({
    name: z.string().min(3, "Mínimo 3 caracteres"),
    description: z.string().optional(),
    startAt: z.string().min(1, "Requerido"),
    endAt: z.string().min(1, "Requerido"),
    location: z.string().optional(),
    status: z.enum(["draft", "active", "closed", "archived"]),
    kind: z.enum(EVENT_KIND_OPTIONS).default("gcba"),
    enableMesas: z.boolean().default(false),
    enableNotes: z.boolean().default(false),
    enableGoogleSheets: z.boolean().default(false),
    mesaCount: z.preprocess(
      (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
      z.number().int().min(1).max(99).optional()
    )
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: "La fecha de fin debe ser posterior al inicio",
    path: ["endAt"]
  })
  .refine((data) => !data.enableMesas || (data.mesaCount != null && data.mesaCount >= 1), {
    message: "Indicá la cantidad de mesas (1 a 99)",
    path: ["mesaCount"]
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eventFeaturesPayload(values: EventFormValues) {
  return {
    enableMesas: values.enableMesas,
    enableNotes: values.enableNotes,
    enableGoogleSheets: values.enableGoogleSheets,
    mesaCount: values.enableMesas ? (values.mesaCount ?? null) : null
  };
}

export function eventFormToPayload(values: EventFormValues) {
  return {
    name: values.name,
    description: values.description || null,
    location: values.location || null,
    status: values.status,
    kind: values.kind ?? "gcba",
    startAt: new Date(values.startAt).toISOString(),
    endAt: new Date(values.endAt).toISOString(),
    ...eventFeaturesPayload(values)
  };
}

/** Actualización parcial: no incluye `kind` (el tipo de evento no debe cambiar al editar). */
export function eventFormToPatchPayload(values: EventFormValues) {
  return {
    name: values.name,
    description: values.description || null,
    location: values.location || null,
    status: values.status,
    startAt: new Date(values.startAt).toISOString(),
    endAt: new Date(values.endAt).toISOString(),
    ...eventFeaturesPayload(values)
  };
}
