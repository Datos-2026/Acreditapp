import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const source = path.join(publicDir, "pwa-icon.svg");

if (!fs.existsSync(source)) {
  console.error("generate-pwa-icons: falta public/pwa-icon.svg");
  process.exit(1);
}

const sizes = [
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 }
];

for (const { name, size } of sizes) {
  const target = path.join(publicDir, name);
  await sharp(source).resize(size, size).png().toFile(target);
  console.log(`generate-pwa-icons: ${name}`);
}
