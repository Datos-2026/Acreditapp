import { createHash } from "node:crypto";

export type IdentityQuality = "cuil" | "dni" | "email" | "telefono" | "sin_clave_confiable";

export type IdentityInput = {
  cuil?: unknown;
  dni?: unknown;
  email?: unknown;
  phone?: unknown;
  fallbackSeed?: unknown;
};

export type ResolvedIdentity = {
  key: string;
  quality: IdentityQuality;
  cuil: string | null;
  dni: string | null;
  email: string | null;
  phone: string | null;
};

export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text : null;
}

export function normalizeEmail(value: unknown): string | null {
  const email = normalizeText(value)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizePhone(value: unknown): string | null {
  const phone = digits(value);
  return phone.length >= 8 ? phone : null;
}

export function normalizeDni(value: unknown): string | null {
  const dni = digits(value).replace(/^0+/, "");
  return dni.length >= 6 && dni.length <= 8 ? dni : null;
}

export function isValidCuil(value: unknown): boolean {
  const cuil = digits(value);
  if (cuil.length !== 11 || /^(\d)\1+$/.test(cuil)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(cuil[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const check = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  return check === Number(cuil[10]);
}

function hash(value: unknown): string {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function resolveIdentity(input: IdentityInput): ResolvedIdentity {
  const rawCuil = digits(input.cuil);
  const cuil = isValidCuil(rawCuil) ? rawCuil : null;
  const explicitDni = normalizeDni(input.dni);
  const dni = explicitDni ?? (cuil ? normalizeDni(cuil.slice(2, 10)) : null);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  if (cuil) return { key: `cuil:${cuil}`, quality: "cuil", cuil, dni, email, phone };
  if (dni) return { key: `dni:${dni}`, quality: "dni", cuil: null, dni, email, phone };
  if (email) return { key: `email:${email}`, quality: "email", cuil: null, dni: null, email, phone };
  if (phone) return { key: `telefono:${phone}`, quality: "telefono", cuil: null, dni: null, email: null, phone };
  return {
    key: `fila:${hash(input.fallbackSeed).slice(0, 40)}`,
    quality: "sin_clave_confiable",
    cuil: null,
    dni: null,
    email: null,
    phone: null
  };
}

export function normalizeEventFingerprint(name: unknown, date: unknown): string {
  const normalizedName =
    normalizeText(name)
      ?.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || "evento";
  const parsed = date instanceof Date ? date : new Date(String(date ?? ""));
  const datePart = Number.isNaN(parsed.getTime()) ? "sin-fecha" : parsed.toISOString().slice(0, 10);
  return `${normalizedName}|${datePart}`;
}

