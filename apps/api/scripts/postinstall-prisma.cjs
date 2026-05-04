/**
 * En Docker, `npm ci` corre antes de `COPY` del código: no existe prisma/schema.prisma aún.
 * El Dockerfile ejecuta `npm run db:generate` después de copiar el repo.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const apiRoot = path.join(__dirname, "..");
const schema = path.join(apiRoot, "prisma", "schema.prisma");

if (!fs.existsSync(schema)) {
  console.log(
    "[@gcba/api postinstall] Sin prisma/schema.prisma en este momento; se omite prisma generate."
  );
  process.exit(0);
}

execSync("npx prisma generate --schema prisma/schema.prisma", {
  stdio: "inherit",
  cwd: apiRoot,
  env: process.env
});
