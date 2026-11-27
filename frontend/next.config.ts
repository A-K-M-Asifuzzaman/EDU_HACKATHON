import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Static export: the FastAPI service serves frontend/out on a single port (production).
// In `next dev` the client calls the API directly (NEXT_PUBLIC_API_BASE, default http://127.0.0.1:8000).
// The interface's own commit, stamped at build time (the footer shows it next to the API's commit from /api/health).
const frontendCommit = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
})();
const config: NextConfig = { output: "export", trailingSlash: true, images: { unoptimized: true }, reactStrictMode: true, env: { NEXT_PUBLIC_FRONTEND_COMMIT: frontendCommit } };
export default config;
