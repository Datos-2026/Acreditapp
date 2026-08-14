export type ParsedReferente = {
  name: string;
  email: string | null;
  phone: string | null;
  emailNormalized: string;
  missingEmail: boolean;
};

export function normalizeReferenteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeReferenteNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parsea "Nombre | mail | teléfono" (orden libre de mail/tel). */
export function parseReferenteCell(raw: unknown): ParsedReferente | null {
  const text = raw == null ? "" : String(raw).trim();
  if (!text) return null;
  const parts = text.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let email: string | null = null;
  let phone: string | null = null;
  const nameParts: string[] = [];
  for (const part of parts) {
    if (!email && part.includes("@")) {
      email = part;
      continue;
    }
    const digits = part.replace(/\D/g, "");
    if (!phone && digits.length >= 8 && digits.length <= 15) {
      phone = digits;
      continue;
    }
    nameParts.push(part);
  }

  const name = nameParts.join(" ").trim() || (email ? email.split("@")[0] : "");
  if (!name && !email) return null;
  const missingEmail = !email;
  const emailNormalized = email
    ? normalizeReferenteEmail(email)
    : `nombre:${normalizeReferenteNameKey(name)}`;
  return {
    name: name || emailNormalized,
    email,
    phone,
    emailNormalized,
    missingEmail
  };
}

export function splitReferenteName(name: string): { firstName: string; lastName: string } {
  const clean = name.trim();
  if (!clean) return { firstName: "—", lastName: "—" };
  if (clean.includes(",")) {
    const [last, first] = clean.split(",", 2);
    return {
      lastName: last.trim() || "—",
      firstName: (first ?? "").trim() || "—"
    };
  }
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return { firstName: tokens[0], lastName: "—" };
  return {
    firstName: tokens.slice(0, -1).join(" "),
    lastName: tokens[tokens.length - 1]
  };
}

/**
 * CUIL sintético (prefijo 99) para referentes identificados por email.
 * Distinto del sintético por DNI (prefijo 00).
 */
export function syntheticCuilFromEmail(email: string): string {
  const key = normalizeReferenteEmail(email);
  let h1 = 2166136261;
  let h2 = 16777619;
  for (let i = 0; i < key.length; i++) {
    h1 ^= key.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ key.charCodeAt(i), 2246822519);
  }
  const a = (h1 >>> 0) % 100000;
  const b = (h2 >>> 0) % 10000;
  return `99${String(a).padStart(5, "0")}${String(b).padStart(4, "0")}`;
}
