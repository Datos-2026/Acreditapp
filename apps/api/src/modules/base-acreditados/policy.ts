export function shouldSyncToBaseOnStatusChange(previousStatus: string, nextStatus: string): boolean {
  return nextStatus === "closed" && previousStatus !== "closed";
}

/** Quién entra a BASE_ACREDITADOS al cerrar: importados todos; manual solo acreditado + match dotación. */
export function shouldIncludeEventPersonInBaseSync(
  person: { source: string; status: string },
  inDotacion: boolean
): boolean {
  const source = String(person.source);
  const status = String(person.status);
  if (source === "imported") return true;
  if (source === "manual") return status === "accredited" && inDotacion;
  return false;
}

export function attendanceFlagsForEventPerson(person: { source: string; status: string }): {
  registered: true;
  attended: boolean;
  outOfBase: boolean;
  status: string;
} {
  const source = String(person.source);
  const accredited = String(person.status) === "accredited";
  const outOfBase = source === "manual";
  return {
    registered: true,
    attended: accredited,
    outOfBase,
    status: outOfBase ? "Fuera de base" : accredited ? "Acreditado" : "Pendiente"
  };
}
