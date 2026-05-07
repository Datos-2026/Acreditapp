const path = require("path");
const { spawnSync } = require("child_process");
const dotenv = require("dotenv");

const apiRoot = path.join(__dirname, "..");
const repoRoot = path.join(apiRoot, "..", "..");

dotenv.config({ path: path.join(repoRoot, ".env"), override: true });
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });

const dbUrl = process.env.DATABASE_URL;
const hasValidProtocol =
  typeof dbUrl === "string" &&
  (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://"));

if (!hasValidProtocol) {
  if (typeof dbUrl === "string" && dbUrl.trim().length > 0 && !dbUrl.includes("://")) {
    process.env.DATABASE_URL = `postgresql://${dbUrl.trim()}`;
    console.warn(
      "[prisma-runner] DATABASE_URL no tenía protocolo; se normalizó agregando postgresql://."
    );
  } else {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/gcba_acreditacion?schema=public";
    console.warn(
      "[prisma-runner] DATABASE_URL inválida o ausente; se usa URL placeholder solo para ejecutar Prisma CLI."
    );
  }
}

const args = process.argv.slice(2);
const result = spawnSync("npx", ["prisma", ...args], {
  cwd: apiRoot,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
