const KEY = "gcba:lastEventId";

export function getLastEventId(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setLastEventId(eventId: string): void {
  try {
    localStorage.setItem(KEY, eventId);
  } catch {
    /* ignore */
  }
}

export function clearLastEventId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
