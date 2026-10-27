import "server-only";

import path from "node:path";
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { ConfigError } from "@/lib/server/env";

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * One database for the app. Production and local development use Merit's own Neon Postgres (pooled, with
 * transactions). Tests and isolated e2e runs set MERIT_DB=pglite: an in-memory Postgres with the same checked-in
 * migrations, so they never touch the real database.
 */
const MIGRATIONS = path.join(process.cwd(), "drizzle");

type Holder = { db?: Promise<Db> };
const holder = globalThis as typeof globalThis & { __meritDb?: Holder };
holder.__meritDb ??= {};

async function open(): Promise<Db> {
  if (process.env.MERIT_DB === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite({ extensions: { pg_trgm } });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new ConfigError("DATABASE_URL is not set on the server");
  return drizzleNeon(new Pool({ connectionString: url }), { schema }) as unknown as Db;
}

export function getDb(): Promise<Db> {
  holder.__meritDb!.db ??= open().catch((error) => {
    holder.__meritDb!.db = undefined;
    throw error;
  });
  return holder.__meritDb!.db;
}

/** Appends one audit event (the table rejects updates and deletes). */
export async function audit(
  db: Db,
  e: { programId?: string | null; actor: string; action: string; entity: string; entityId: string; data?: Record<string, unknown>; signature?: string | null },
) {
  await db.insert(schema.auditEvents).values({
    programId: e.programId ?? null,
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    dataJson: e.data ?? {},
    signature: e.signature ?? null,
  });
}
