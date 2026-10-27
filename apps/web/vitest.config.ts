import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import path from "node:path";

// Live tests use the same server secrets as `next dev` (.env.local, gitignored).
function loadEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path.resolve(import.meta.dirname, ".env.local"), "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        // `vercel env pull` quotes values; strip the quotes the way Next's loader does.
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")]),
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname), "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts") } },
  // In-memory Postgres migrates on first use per file; with every file starting at once that can take a while.
  test: { include: ["test/**/*.test.ts"], environment: "node", env: loadEnvLocal(), testTimeout: 30_000, hookTimeout: 60_000 },
});
