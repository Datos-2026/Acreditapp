import * as XLSX from "xlsx";
import type { Prisma } from "../../prisma-exports";
import { pickDirectoryEmail } from "../directory/directory-logic";

export const TWO_SHEETS_HEADER = [
  "MINISTERIO",
  "AYN",
  "NUM_DOC",
  "LIT_PUESTO",
  "DESC_REP",
  "MAIL",
  "CUIL_SIN_GUIONES",
  "CUIL",
  "Apellido",
  "Nombre",
  "DNI",
  "Email",
  "Telefono",
  "Ministerio",
  "Rol",
  "Origen_inscripcion",
  "Fuera_de_base",
  "Acreditado_el",
  "Acreditado_por",
  "Notas_acreditacion"
] as const;

const personExportInclude = {
  person: true,
  accreditedByUser: { select: { name: true, email: true } }
} as const;

export type EventPersonTwoSheetsRow = Prisma.EventPersonGetPayload<{
  include: typeof personExportInclude;
}>;

type DirectoryLookup = {
  ministerio: string | null;
  litPuesto: string | null;
  descRep: string | null;
  mail: string | null;
  dni: string | null;
  firstName: string;
  lastName: string;
};

function formatAccreditedAt(value: Date | string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function buildAyn(lastName: string, firstName: string): string {
  return `${lastName}, ${firstName}`.trim();
}

export function mapEventPersonToTwoSheetsRow(
  r: EventPersonTwoSheetsRow,
  directory?: DirectoryLookup | null
): string[] {
  const origen = r.source === "manual" ? "manual" : "importado";
  const fueraDeBase = r.source === "manual" ? "si" : "no";
  const by = r.accreditedByUser?.name ?? r.accreditedByUser?.email ?? "";
  const dirLast = directory?.lastName ?? r.person.lastName;
  const dirFirst = directory?.firstName ?? r.person.firstName;
  const dirDni = directory?.dni ?? r.person.dni ?? "";
  const ministerioDot = directory?.ministerio ?? r.person.company ?? "";
  const mail =
    directory?.mail ??
    r.person.email ??
    "";

  return [
    ministerioDot,
    buildAyn(dirLast, dirFirst),
    dirDni,
    directory?.litPuesto ?? r.person.position ?? "",
    directory?.descRep ?? "",
    mail,
    r.person.cuilNormalized,
    r.person.cuilNormalized,
    r.person.lastName,
    r.person.firstName,
    r.person.dni ?? "",
    r.person.email ?? "",
    r.person.phone ?? "",
    r.person.company ?? "",
    r.person.position ?? "",
    origen,
    fueraDeBase,
    formatAccreditedAt(r.accreditedAt),
    by,
    r.accreditationNotes ?? ""
  ];
}

export function buildDirectoryLookupMap(
  people: Array<{
    cuilNormalized: string;
    dni: string | null;
    ministerio: string | null;
    litPuesto: string | null;
    descRep: string | null;
    emailLaboral: string | null;
    emailPersonal: string | null;
    emailMia: string | null;
    firstName: string;
    lastName: string;
  }>
): Map<string, DirectoryLookup> {
  const map = new Map<string, DirectoryLookup>();
  for (const p of people) {
    const entry: DirectoryLookup = {
      ministerio: p.ministerio,
      litPuesto: p.litPuesto,
      descRep: p.descRep,
      mail: pickDirectoryEmail(p),
      dni: p.dni,
      firstName: p.firstName,
      lastName: p.lastName
    };
    map.set(`cuil:${p.cuilNormalized}`, entry);
    if (p.dni) map.set(`dni:${p.dni}`, entry);
  }
  return map;
}

export function resolveDirectoryLookup(
  map: Map<string, DirectoryLookup>,
  person: { cuilNormalized: string; dni: string | null }
): DirectoryLookup | null {
  return map.get(`cuil:${person.cuilNormalized}`) ?? (person.dni ? map.get(`dni:${person.dni}`) : null) ?? null;
}

export function buildTwoSheetsXlsxBuffer(
  accreditedRows: EventPersonTwoSheetsRow[],
  fueraDeBaseRows: EventPersonTwoSheetsRow[],
  directoryMap: Map<string, DirectoryLookup>
): Buffer {
  const accreditedData = accreditedRows.map((r) =>
    mapEventPersonToTwoSheetsRow(r, resolveDirectoryLookup(directoryMap, r.person))
  );
  const fueraData = fueraDeBaseRows.map((r) =>
    mapEventPersonToTwoSheetsRow(r, resolveDirectoryLookup(directoryMap, r.person))
  );

  const header = Array.from(TWO_SHEETS_HEADER);
  const wb = XLSX.utils.book_new();
  const sheetAcc = XLSX.utils.aoa_to_sheet([header, ...accreditedData]);
  const sheetFuera = XLSX.utils.aoa_to_sheet([header, ...fueraData]);
  XLSX.utils.book_append_sheet(wb, sheetAcc, "ACREDITADOS");
  XLSX.utils.book_append_sheet(wb, sheetFuera, "FUERA DE BASE");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export { personExportInclude };
