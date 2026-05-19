const NON_DIGIT_REGEX = /\D/g;

export function normalizeCuil(cuil: string): string {
  return cuil.replace(NON_DIGIT_REGEX, "");
}

export function formatCuil(cuil: string): string {
  const normalized = normalizeCuil(cuil);
  if (normalized.length !== 11) return normalized;
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 10)}-${normalized.slice(10)}`;
}

export function isValidCuil(cuil: string): boolean {
  const normalized = normalizeCuil(cuil);
  if (!/^\d{11}$/.test(normalized)) return false;

  const coefficients = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = normalized.split("").map(Number);
  const sum = coefficients.reduce((acc, coef, idx) => acc + coef * digits[idx], 0);
  const remainder = 11 - (sum % 11);
  const verifier = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  return verifier === digits[10];
}

export type ManualDocument = {
  cuilNormalized: string;
  dni: string | null;
  cuilRaw: string;
};

/** CUIL válido (11 dígitos) o DNI (7–8 dígitos) para altas manuales / fuera de base. */
export function parseManualDocument(raw: string): ManualDocument {
  const trimmed = raw.trim();
  const digits = normalizeCuil(trimmed);

  if (digits.length === 11) {
    if (!isValidCuil(digits)) {
      throw new Error("CUIL inválido");
    }
    return { cuilNormalized: digits, dni: null, cuilRaw: trimmed };
  }

  if (digits.length >= 7 && digits.length <= 8) {
    return {
      cuilNormalized: `00${digits.padStart(9, "0")}`,
      dni: digits,
      cuilRaw: trimmed
    };
  }

  throw new Error("Ingresá un CUIL válido (11 dígitos) o un DNI (7 u 8 dígitos)");
}
