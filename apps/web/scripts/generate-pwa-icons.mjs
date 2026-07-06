import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "../..");
const publicDir = path.join(root, "public");
const iconoDir = path.join(repoRoot, "icono");

const sourceCandidates = [
  path.join(iconoDir, "cono.png"),
  path.join(iconoDir, "icono.png"),
  path.join(publicDir, "pwa-icon-source.png"),
  path.join(publicDir, "pwa-icon.svg")
];

const source = sourceCandidates.find((candidate) => fs.existsSync(candidate));

if (!source) {
  console.error("generate-pwa-icons: no se encontro icono en icono/ ni public/");
  process.exit(1);
}

const sizes = [
  { name: "favicon-32x32.png", size: 32 },
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 }
];

for (const { name, size } of sizes) {
  const target = path.join(publicDir, name);
  await sharp(source).resize(size, size, { fit: "cover" }).png().toFile(target);
  console.log(`generate-pwa-icons: ${name} <- ${path.basename(source)}`);
}
