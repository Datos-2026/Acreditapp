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
      estado VARCHAR(64) NULL,
      eventos_asistidos TEXT NULL,
      estado_registro TEXT NULL,
      observaciones_calidad TEXT NULL,
      fuentes_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_persona_identity (identity_key),
      KEY idx_persona_cuil (cuil),
      KEY idx_persona_dni (dni)
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
    const [columnRows] = await db.query("SHOW COLUMNS FROM personas");
    const existing = new Set((columnRows as Array<{ Field: string }>).map((row) => row.Field));
    if (!existing.has("estado")) {
      await db.query("ALTER TABLE personas ADD COLUMN estado VARCHAR(64) NULL AFTER en_dotacion");
    }
    if (!existing.has("eventos_asistidos")) {
      await db.query("ALTER TABLE personas ADD COLUMN eventos_asistidos TEXT NULL AFTER estado");
    }
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

export async function baseTableExists(tableName: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_]+$/.test(tableName)) return false;
  const rows = await baseQuery<RowDataPacket[]>("SHOW TABLES LIKE ?", [tableName]);
  return rows.length > 0;
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

