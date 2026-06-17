export const APP_TIMEZONE = "America/Argentina/Buenos_Aires";

export const ROLE_OPTIONS = [
  "SUPERADMIN",
  "ADMIN_EVENTO",
  "ADMIN_VECINOS",
  "ACREDITADOR",
  "LECTURA",
  "INFORMADOR"
] as const;

export type AppRole = (typeof ROLE_OPTIONS)[number];

export const EVENT_KIND_OPTIONS = ["gcba", "vecinos"] as const;
export type EventKind = (typeof EVENT_KIND_OPTIONS)[number];
