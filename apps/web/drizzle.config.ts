import { defineConfig } from "drizzle-kit";

// Migrations are generated from lib/db/schema.ts and checked in (drizzle/). Applying them to Neon uses the
// direct (unpooled) URL; tests apply the same files to an in-memory PGlite.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
