/**
 * Prisma writes JS/wasm/binaries under `src/generated`; `tsc` does not emit them into `dist/`.
 * Copy that tree next to compiled `dist/src/*.js` so `require("./generated/prisma/client")` resolves.
 */
const fs = require("fs");
const path = require("path");

const apiRoot = path.join(__dirname, "..");
const srcGen = path.join(apiRoot, "src", "generated");
const destGen = path.join(apiRoot, "dist", "src", "generated");

if (!fs.existsSync(srcGen)) {
  console.error("copy-prisma-generated: missing %s — run `npm run db:generate -w @gcba/api` first", srcGen);
  process.exit(1);
}

fs.mkdirSync(path.dirname(destGen), { recursive: true });
fs.cpSync(srcGen, destGen, { recursive: true });
console.log("copy-prisma-generated: %s -> %s", srcGen, destGen);
