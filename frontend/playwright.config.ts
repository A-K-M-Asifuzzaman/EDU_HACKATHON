import { defineConfig } from "@playwright/test";
// Run against a running app: ./scripts/launch.sh (default port 8000) or E2E_BASE_URL=http://127.0.0.1:8100 npx playwright test
export default defineConfig({
  testDir: "./tests/e2e", timeout: 60_000, retries: 1, workers: 2, reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8000", trace: "retain-on-failure", reducedMotion: "reduce", viewport: { width: 1440, height: 900 } },
});
