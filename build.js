// Build script: copy the static app files into ./public for deployment.
// Run with `bun run build`.

import { rm, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = "public";

// The files the app actually serves/loads (see index.html).
const STATIC_FILES = [
  "index.html",
  "styles.css",
  "theme.js",
  "schema.js",
  "sessions.js",
  "forms.js",
  "app.js",
];

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

for (const file of STATIC_FILES) {
  await copyFile(file, join(OUT_DIR, file));
  console.log(`copied ${file} -> ${join(OUT_DIR, file)}`);
}

console.log(`\nBuilt ${STATIC_FILES.length} files into ./${OUT_DIR}`);
