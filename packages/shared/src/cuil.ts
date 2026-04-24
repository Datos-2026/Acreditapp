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
