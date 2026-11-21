// MapLibre v6 loads its web worker from a URL; copy the worker bundles from node_modules into public/ (git-ignored) before build/dev.
import { cpSync, mkdirSync, existsSync } from "node:fs";
const src = "node_modules/maplibre-gl/dist", dst = "public/maplibre";
if (!existsSync(src)) { console.warn("maplibre-gl not installed; skipping worker copy"); process.exit(0); }
mkdirSync(dst, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`${src}/${f}`, `${dst}/${f}`);
console.log("copied MapLibre worker files to public/maplibre");
