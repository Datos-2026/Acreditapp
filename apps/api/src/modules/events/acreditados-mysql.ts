import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import type { EventPerson, Person, User } from "../../prisma-exports";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { ARCHIVE_SHEET_HEADER, buildArchiveSheetRow, clearVecinoSheetError, recordVecinoSheetError } from "./google-sheets-sync";

type AccreditedRow = EventPerson & {
  person: Person;
  accreditedByUser: Pick<User, "id" | "name"> | null;
};

/** Valor guardado en `googleSpreadsheetId` para indicar dump MySQL (no es un ID de Google). */
export const ACREDITADOS_MYSQL_MARKER = "ACREDITADOS";

const COLUMN_NAMES = [
  "dni",
  "cuil",
  "apellido",
  "nombre",
  "email",
  "telefono",
  "comuna",
  "direccion",
  "empresa",
  "cargo",
  "estado",
  "origen",
  "mesa",
  "acreditado_el",
  "acreditado_por",
  "escuela",
  "seccion",
  "oferta",
  "referente",
  "event_person_id"
] as const;

const INSERT_PLACEHOLDERS = COLUMN_NAMES.map(() => "?").join(", ");
const UPDATE_SET = COLUMN_NAMES.filter((c) => c !== "event_person_id")
  .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
  .join(", ");

let pool: mysql.Pool | null = null;
let databaseReady = false;

export function isAcreditadosMysqlConfigured(): boolean {
  return Boolean(
    env.ACREDITADOS_MYSQL_HOST?.trim() &&
      env.ACREDITADOS_MYSQL_USER?.trim() &&
      env.ACREDITADOS_MYSQL_PASSWORD
  );
}

export function mysqlDatabaseName(): string {
  const name = env.ACREDITADOS_MYSQL_DATABASE?.trim() || ACREDITADOS_MYSQL_MARKER;
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("Nombre de base MySQL inválido");
  }
  return name;
}

export function mysqlTableNameForEvent(slugOrName: string, eventId: string): string {
  const slugPart = slugOrName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48);
  const idPart = eventId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "id";
  return `e_${slugPart || "evento"}_${idPart}`.slice(0, 64);
}

export function isValidAcreditadosTableName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  return /^e_[a-z0-9_]{1,61}$/.test(trimmed) && trimmed.length <= 64;
}

export function formatMysqlError(err: unknown): string {
  const e = err as { code?: string; errno?: number; message?: string };
  const code = e.code ?? "";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
    return "No se pudo conectar a MySQL. ¿Está la VPN activa?";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "Acceso denegado a MySQL. Revisá usuario y contraseña.";
  }
  if (code === "PROTOCOL_CONNECTION_LOST" || code === "ECONNRESET") {
    return "Se perdió la conexión a MySQL. Reintentá en unos segundos.";
  }
  return (e.message ?? String(err)).slice(0, 400);
}

function assertTableName(tableName: string): void {
  if (!isValidAcreditadosTableName(tableName)) {
    throw new Error("Nombre de tabla MySQL inválido");
  }
}

function connectionConfig() {
  return {
    host: env.ACREDITADOS_MYSQL_HOST!.trim(),
    port: env.ACREDITADOS_MYSQL_PORT,
    user: env.ACREDITADOS_MYSQL_USER!.trim(),
    password: env.ACREDITADOS_MYSQL_PASSWORD,
    charset: "utf8mb4" as const
  };
}

export async function ensureAcreditadosDatabase(): Promise<void> {
  if (!isAcreditadosMysqlConfigured()) return;
  if (databaseReady) return;
  const db = mysqlDatabaseName();
  const conn = await mysql.createConnection(connectionConfig());
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    databaseReady = true;
    logger.info({ database: db }, "Base MySQL ACREDITADOS lista");
  } finally {
    await conn.end();
  }
}

async function getPool(): Promise<mysql.Pool> {
  if (!isAcreditadosMysqlConfigured()) {
    throw new Error("MySQL ACREDITADOS no está configurado (ACREDITADOS_MYSQL_HOST / USER / PASSWORD)");
  }
  await ensureAcreditadosDatabase();
  if (!pool) {
    pool = mysql.createPool({
      ...connectionConfig(),
      database: mysqlDatabaseName(),
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true
    });
  }
  return pool;
}

const CREATE_TABLE_SQL = `
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_person_id VARCHAR(64) NULL,
  dni VARCHAR(32) NULL,
  cuil VARCHAR(32) NULL,
  apellido VARCHAR(255) NOT NULL DEFAULT '',
  nombre VARCHAR(255) NOT NULL DEFAULT '',
  email VARCHAR(255) NULL,
  telefono VARCHAR(64) NULL,
  comuna VARCHAR(64) NULL,
  direccion TEXT NULL,
  empresa VARCHAR(255) NULL,
  cargo VARCHAR(255) NULL,
  estado VARCHAR(64) NULL,
  origen VARCHAR(64) NULL,
  mesa VARCHAR(64) NULL,
  acreditado_el VARCHAR(64) NULL,
  acreditado_por VARCHAR(255) NULL,
  escuela VARCHAR(255) NULL,
  seccion VARCHAR(255) NULL,
  oferta VARCHAR(255) NULL,
  referente VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_person (event_person_id)
`;

async function createTableIfNotExists(tableName: string): Promise<void> {
  assertTableName(tableName);
  const db = await getPool();
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${CREATE_TABLE_SQL}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

function rowToParams(eventPerson: AccreditedRow): string[] {
  const cells = buildArchiveSheetRow(eventPerson).map((cell) => String(cell ?? ""));
  return [...cells, eventPerson.id];
}

export async function ensureEventAcreditadosTable(event: {
  id: string;
  name: string;
  slug?: string | null;
  googleSheetName?: string | null;
  googleSpreadsheetId?: string | null;
}): Promise<{ tableName: string; spreadsheetId: typeof ACREDITADOS_MYSQL_MARKER }> {
  const stored = event.googleSheetName?.trim() ?? "";
  const tableName = isValidAcreditadosTableName(stored)
    ? stored
    : mysqlTableNameForEvent(event.slug || event.name, event.id);

  await createTableIfNotExists(tableName);

  if (stored !== tableName || event.googleSpreadsheetId !== ACREDITADOS_MYSQL_MARKER) {
    const { prisma } = await import("../../lib/prisma");
    await prisma.event.update({
      where: { id: event.id },
      data: {
        googleSheetName: tableName,
        googleSpreadsheetId: ACREDITADOS_MYSQL_MARKER
      }
    });
  }

  logger.info(
    { eventId: event.id, tableName, database: mysqlDatabaseName() },
    "Tabla MySQL ACREDITADOS lista para el evento"
  );
  return { tableName, spreadsheetId: ACREDITADOS_MYSQL_MARKER };
}

export async function dumpEventPeopleToMysql(tableName: string, rows: AccreditedRow[]): Promise<void> {
  assertTableName(tableName);
  await createTableIfNotExists(tableName);
  const db = await getPool();
  await db.query(`TRUNCATE TABLE \`${tableName}\``);
  if (rows.length === 0) return;

  const chunkSize = 200;
  const colList = COLUMN_NAMES.map((c) => `\`${c}\``).join(", ");
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => `(${INSERT_PLACEHOLDERS})`).join(", ");
    const params = chunk.flatMap(rowToParams);
    await db.query(`INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`, params);
  }
}

export async function appendAccreditationToAcreditadosMysql(
  eventId: string,
  tableName: string,
  eventPerson: AccreditedRow
): Promise<void> {
  assertTableName(tableName);
  await createTableIfNotExists(tableName);
  const db = await getPool();
  const colList = COLUMN_NAMES.map((c) => `\`${c}\``).join(", ");
  try {
    await db.query(
      `INSERT INTO \`${tableName}\` (${colList}) VALUES (${INSERT_PLACEHOLDERS})
       ON DUPLICATE KEY UPDATE ${UPDATE_SET}`,
      rowToParams(eventPerson)
    );
    clearVecinoSheetError(eventId);
    logger.info(
      { eventId, tableName, eventPersonId: eventPerson.id },
      "Acreditación enviada a MySQL ACREDITADOS"
    );
  } catch (err) {
    const message = formatMysqlError(err);
    recordVecinoSheetError(eventId, message);
    logger.error({ err, eventId, tableName, eventPersonId: eventPerson.id }, "Falló envío a MySQL ACREDITADOS");
    throw err;
  }
}

const EXPORT_COLUMNS = COLUMN_NAMES.filter((c) => c !== "event_person_id");

export async function fetchAcreditadosMysqlRows(tableName: string): Promise<string[][]> {
  assertTableName(tableName);
  const db = await getPool();
  const colList = EXPORT_COLUMNS.map((c) => `\`${c}\``).join(", ");
  try {
    const [rows] = await db.query(
      `SELECT ${colList} FROM \`${tableName}\` ORDER BY apellido ASC, nombre ASC, id ASC`
    );
    return (rows as Array<Record<string, unknown>>).map((row) =>
      EXPORT_COLUMNS.map((col) => {
        const value = row[col];
        if (value == null) return "";
        if (value instanceof Date) {
          return value.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
        }
        return String(value);
      })
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ER_NO_SUCH_TABLE") {
      throw new Error("Este evento no tiene tabla en MySQL ACREDITADOS.");
    }
    throw err;
  }
}

export function buildAcreditadosMysqlXlsxBuffer(dataRows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[...ARCHIVE_SHEET_HEADER], ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "ACREDITADOS");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
