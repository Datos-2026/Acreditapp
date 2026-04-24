import { AppError } from "../../middlewares/error-handler";

export function ensureNotAlreadyAccredited(status: "pending" | "accredited"): void {
  if (status === "accredited") {
    throw new AppError("Persona ya acreditada", 409);
  }
}

export function buildCuilSearch(cuilNormalized: string) {
  return {
    person: {
      cuilNormalized
    }
  };
}
