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

/** Quita mesa del extraData al deshacer una acreditación. */
export function extraDataWithoutMesa(
  extraData: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!extraData || typeof extraData !== "object") return null;
  const { mesa: _mesa, ...rest } = extraData;
  return Object.keys(rest).length > 0 ? rest : null;
}
