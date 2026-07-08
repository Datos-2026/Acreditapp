import { AppError } from "../../middlewares/error-handler";

export type EventFeaturesInput = {
  enableMesas?: boolean;
  enableNotes?: boolean;
  mesaCount?: number | null;
};

export type NormalizedEventFeatures = {
  enableMesas: boolean;
  enableNotes: boolean;
  mesaCount: number | null;
};

export function normalizeEventFeatures(input: EventFeaturesInput): NormalizedEventFeatures {
  const enableMesas = Boolean(input.enableMesas);
  const enableNotes = Boolean(input.enableNotes);

  if (enableMesas) {
    const count = input.mesaCount;
    if (count == null || count < 1 || count > 99) {
      throw new AppError("Si activás mesas, indicá la cantidad entre 1 y 99", 400);
    }
    return { enableMesas: true, enableNotes, mesaCount: count };
  }

  return { enableMesas: false, enableNotes, mesaCount: null };
}

export function mesasActive(event: { enableMesas: boolean; mesaCount: number | null }): boolean {
  return event.enableMesas && event.mesaCount != null && event.mesaCount > 0;
}

export function googleSheetsActive(event: { enableGoogleSheets: boolean }): boolean {
  return Boolean(event.enableGoogleSheets);
}
