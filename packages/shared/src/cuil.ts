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

/**
 * Extrae el DNI (8 dígitos centrales) de un CUIL de 11 dígitos, quitando ceros a la izquierda.
 * Útil para emparejar a una misma persona cuando el prefijo de género (20/23/24/27)
 * o el dígito verificador difieren entre la base del evento y el directorio.
 */
export function dniFromCuil(cuil: string): string | null {
  const normalized = normalizeCuil(cuil);
  if (normalized.length !== 11) return null;
  const dni = normalized.slice(2, 10).replace(/^0+/, "");
  return dni.length >= 6 ? dni : null;
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

  if (digits.length >= 6 && digits.length <= 8) {
    return {
      cuilNormalized: `00${digits.padStart(9, "0")}`,
      dni: digits,
      cuilRaw: trimmed
    };
  }

  if (digits.length === 9 || digits.length === 10) {
    throw new Error("El DNI debe tener entre 6 y 8 dígitos (sin puntos ni guiones)");
  }

  throw new Error("Ingresá un CUIL válido (11 dígitos) o un DNI (6 a 8 dígitos)");
}
