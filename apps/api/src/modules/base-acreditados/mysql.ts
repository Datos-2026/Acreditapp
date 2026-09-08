import { createHash } from "node:crypto";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { env } from "../../config/env";

let pool: Pool | null = null;
let ready = false;
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "PROTOCOL_CONNECTION_LOST"
]);

function isTransientMysqlError(error: unknown): boolean {
  return TRANSIENT_CODES.has(String((error as { code?: string })?.code ?? ""));
}

async function resetPool(): Promise<void> {
  const current = pool;
  pool = null;
  ready = false;
  if (current) await current.end().catch(() => undefined);
}

async function withMysqlRetry<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientMysqlError(error) || attempt === attempts) throw error;
      await resetPool();
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`${label} MySQL inválido`);
  return value;
}

export function baseAcreditadosDatabaseName(): string {
  return safeIdentifier(env.BASE_ACREDITADOS_MYSQL_DATABASE.trim(), "Nombre de BASE_ACREDITADOS");
}

export function dotacionDatabaseName(): string {
  return safeIdentifier(env.DOTACION_MYSQL_DATABASE.trim(), "Nombre de DOTACION");
}

export function dotacionTableName(): string {
  return safeIdentifier(env.DOTACION_MYSQL_TABLE.trim(), "Nombre de tabla DOTACION");
}

export function isBaseAcreditadosConfigured(): boolean {
  return Boolean(
    env.ACREDITADOS_MYSQL_HOST?.trim() &&
      env.ACREDITADOS_MYSQL_USER?.trim() &&
      env.ACREDITADOS_MYSQL_PASSWORD
  );
}

function connectionConfig() {
  return {
    host: env.ACREDITADOS_MYSQL_HOST!.trim(),
    port: env.ACREDITADOS_MYSQL_PORT,
    user: env.ACREDITADOS_MYSQL_USER!.trim(),
    password: env.ACREDITADOS_MYSQL_PASSWORD,
    charset: "utf8mb4" as const,
    connectTimeout: 15_000
  };
}

export async function ensureBaseAcreditadosSchema(): Promise<void> {
  if (!isBaseAcreditadosConfigured()) {
    throw new Error("BASE_ACREDITADOS no está configurada: faltan credenciales MySQL");
  }
  if (ready) return;
  await withMysqlRetry(async () => {
    const database = baseAcreditadosDatabaseName();
    const connection = await mysql.createConnection(connectionConfig());
    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } finally {
      await connection.end();
    }
    const db = await getBaseAcreditadosPool(false);
    const statements = [
    `CREATE TABLE IF NOT EXISTS cargas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(40) NOT NULL,
      source_name VARCHAR(255) NOT NULL,
      source_hash CHAR(64) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'processing',
      total_rows INT UNSIGNED NOT NULL DEFAULT 0,
      details_json JSON NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      UNIQUE KEY uq_carga_hash (source_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS raw_columnas (
      table_name VARCHAR(64) NOT NULL,
      column_name VARCHAR(64) NOT NULL,
      original_header VARCHAR(255) NOT NULL,
      PRIMARY KEY (table_name, column_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS personas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      identity_key VARCHAR(255) NOT NULL,
      calidad_identidad VARCHAR(30) NOT NULL,
      cuil VARCHAR(20) NULL,
      dni VARCHAR(20) NULL,
      nombre VARCHAR(255) NULL,
      apellido VARCHAR(255) NULL,
      telefono VARCHAR(64) NULL,
      email_form TEXT NULL,
      mail_personal TEXT NULL,
      mail_mia TEXT NULL,
      mail_laboral TEXT NULL,
      fecha_nacimiento VARCHAR(40) NULL,
      sexo VARCHAR(40) NULL,
      domicilio_laboral TEXT NULL,
      domicilio_personal TEXT NULL,
      area_form TEXT NULL,
      rol_form TEXT NULL,
      area_dotacion TEXT NULL,
      rol_dotacion TEXT NULL,
      desc_rep TEXT NULL,
      path_nombres TEXT NULL,
      en_dotacion BOOLEAN NOT NULL DEFAULT FALSE,
      estado_registro TEXT NULL,
      observaciones_calidad TEXT NULL,
      fuentes_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_persona_identity (identity_key),
      KEY idx_persona_cuil (cuil),
      KEY idx_persona_dni (dni)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS eventos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      fingerprint VARCHAR(500) NOT NULL,
      nombre VARCHAR(500) NOT NULL,
      tipo VARCHAR(255) NULL,
      fecha DATE NULL,
      app_event_id VARCHAR(64) NULL,
      mysql_table_name VARCHAR(64) NULL,
      fuentes_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_evento_fingerprint (fingerprint),
      UNIQUE KEY uq_evento_app (app_event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS persona_aliases (
      alias_key VARCHAR(255) NOT NULL PRIMARY KEY,
      persona_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_alias_persona (persona_id),
      CONSTRAINT fk_alias_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS asistencias (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      persona_id BIGINT UNSIGNED NOT NULL,
      evento_id BIGINT UNSIGNED NOT NULL,
      inscripto BOOLEAN NULL,
      asistio BOOLEAN NOT NULL DEFAULT TRUE,
      fuera_de_base BOOLEAN NULL,
      estado VARCHAR(255) NULL,
      fecha_acreditacion DATETIME NULL,
      fuentes_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_asistencia_persona_evento (persona_id, evento_id),
      CONSTRAINT fk_asistencia_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      CONSTRAINT fk_asistencia_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS event_sync (
      event_id VARCHAR(64) NOT NULL PRIMARY KEY,
      event_status VARCHAR(30) NOT NULL,
      row_count INT UNSIGNED NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      synced_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];
    for (const statement of statements) await db.query(statement);
    ready = true;
  });
}

async function getBaseAcreditadosPool(ensure = true): Promise<Pool> {
  if (ensure) await ensureBaseAcreditadosSchema();
  if (!pool) {
    pool = mysql.createPool({
      ...connectionConfig(),
      database: baseAcreditadosDatabaseName(),
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true
    });
  }
  return pool;
}

export async function baseQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  return withMysqlRetry(async () => {
    const db = await getBaseAcreditadosPool();
    const [rows] = await db.query(sql, params);
    return rows as T;
  });
}

export async function baseExecute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  return withMysqlRetry(async () => {
    const db = await getBaseAcreditadosPool();
    const [result] = await db.query(sql, params);
    return result as ResultSetHeader;
  });
}

export async function createCarga(
  sourceType: string,
  sourceName: string,
  sourceHash: string
): Promise<{ id: number; alreadyCompleted: boolean }> {
  const existing = await baseQuery<(RowDataPacket & { id: number; status: string })[]>(
    "SELECT id, status FROM cargas WHERE source_hash = ? LIMIT 1",
    [sourceHash]
  );
  if (existing[0]) return { id: Number(existing[0].id), alreadyCompleted: existing[0].status === "completed" };
  const result = await baseExecute(
    "INSERT INTO cargas (source_type, source_name, source_hash) VALUES (?, ?, ?)",
    [sourceType, sourceName, sourceHash]
  );
  return { id: result.insertId, alreadyCompleted: false };
}

export async function completeCarga(id: number, totalRows: number, details: unknown): Promise<void> {
  await baseExecute(
    "UPDATE cargas SET status = 'completed', total_rows = ?, details_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    [totalRows, JSON.stringify(details), id]
  );
}

export function rawTableName(sheetName: string): string {
  const normalized = sheetName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52);
  return safeIdentifier(`raw_${normalized || "hoja"}`, "Nombre de tabla raw");
}

function rawColumnName(header: string, used: Set<string>): string {
  const base =
    header
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 52) || "columna";
  let candidate = base;
  if (used.has(candidate)) {
    candidate = `${base.slice(0, 43)}_${createHash("sha1").update(header).digest("hex").slice(0, 8)}`;
  }
  used.add(candidate);
  return safeIdentifier(candidate, "Nombre de columna raw");
}

export async function prepareRawTable(
  sheetName: string,
  headers: string[]
): Promise<{ tableName: string; columns: Map<string, string> }> {
  const tableName = rawTableName(sheetName);
  const used = new Set<string>();
  const columns = new Map(headers.map((header) => [header, rawColumnName(header, used)]));
  await baseExecute(
    `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      carga_id BIGINT UNSIGNED NOT NULL,
      fila_excel INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_raw_carga_fila (carga_id, fila_excel),
      CONSTRAINT \`fk_${tableName}_carga\` FOREIGN KEY (carga_id) REFERENCES cargas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  const existingRows = await baseQuery<(RowDataPacket & { Field: string })[]>(
    `SHOW COLUMNS FROM \`${tableName}\``
  );
  const existing = new Set(existingRows.map((row) => row.Field));
  for (const [header, column] of columns) {
    if (!existing.has(column)) await baseExecute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${column}\` TEXT NULL`);
    await baseExecute(
      `INSERT INTO raw_columnas (table_name, column_name, original_header) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE original_header = VALUES(original_header)`,
      [tableName, column, header]
    );
  }
  return { tableName, columns };
}

export async function insertRawRows(
  tableName: string,
  columns: Map<string, string>,
  cargaId: number,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  safeIdentifier(tableName, "Nombre de tabla raw");
  const entries = [...columns.entries()];
  const names = ["carga_id", "fila_excel", ...entries.map(([, column]) => column)];
  const quoted = names.map((name) => `\`${safeIdentifier(name, "Columna raw")}\``).join(", ");
  const chunkSize = 150;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => `(${names.map(() => "?").join(", ")})`).join(", ");
    const values = chunk.flatMap((row, index) => [
      cargaId,
      offset + index + 2,
      ...entries.map(([header]) => {
        const value = row[header];
        if (value == null || value === "") return null;
        return value instanceof Date ? value.toISOString() : String(value);
      })
    ]);
    await baseExecute(
      `INSERT INTO \`${tableName}\` (${quoted}) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE ${entries
         .map(([, column]) => `\`${column}\` = VALUES(\`${column}\`)`)
         .join(", ")}`,
      values
    );
  }
}

export async function openMysqlServerConnection() {
  return mysql.createConnection(connectionConfig());
}

export async function dropBaseAcreditadosDatabase(): Promise<void> {
  const database = baseAcreditadosDatabaseName();
  if (["ACREDITADOS", "PADRON", "MYSQL"].includes(database.toUpperCase())) {
    throw new Error(`Se rechazó borrar la base protegida ${database}`);
  }
  await resetPool();
  const connection = await mysql.createConnection(connectionConfig());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await connection.end();
  }
}

export async function closeBaseAcreditadosPool(): Promise<void> {
  await resetPool();
}

