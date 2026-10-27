import { defineConfig } from "@playwright/test";

// End-to-end tests run against a dev server on real Rialo DevNet (no mocks).
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // A separate server and in-memory database, so test campaigns never reach
  // the Neon database the real app reads.
  webServer: process.env.MERIT_E2E_URL
    ? undefined
    : { command: "next dev -p 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 120_000, env: { MERIT_DB: "pglite", MERIT_E2E: "1" } },
  use: { baseURL: process.env.MERIT_E2E_URL ?? "http://localhost:3100", screenshot: "only-on-failure", trace: "retain-on-failure" },
  // Outside the app folder: writes inside it make `next dev` recompile and reload pages mid-test.
  outputDir: "../../.e2e-results",
});
