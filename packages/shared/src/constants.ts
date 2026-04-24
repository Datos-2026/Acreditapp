export const APP_TIMEZONE = "America/Argentina/Buenos_Aires";

export const ROLE_OPTIONS = [
  "SUPERADMIN",
  "ADMIN_EVENTO",
  "ACREDITADOR",
  "LECTURA"
] as const;

export type AppRole = (typeof ROLE_OPTIONS)[number];
