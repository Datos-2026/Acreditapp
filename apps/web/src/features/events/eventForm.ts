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
    kind: z.enum(EVENT_KIND_OPTIONS).default("gcba")
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: "La fecha de fin debe ser posterior al inicio",
    path: ["endAt"]
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function eventFormToPayload(values: EventFormValues) {
  return {
    name: values.name,
    description: values.description || null,
    location: values.location || null,
    status: values.status,
    kind: values.kind ?? "gcba",
    startAt: new Date(values.startAt).toISOString(),
    endAt: new Date(values.endAt).toISOString()
  };
}
