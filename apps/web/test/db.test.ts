// The schema, migrations and append-only audit table, on an in-memory Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(new PGlite({ extensions: { pg_trgm } }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
}, 60_000);

describe("database", () => {
  it("applies every migration and keeps Rialo addresses exactly as given", async () => {
    const [u] = await db.insert(schema.users).values({ walletAddress: "BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF" }).returning();
    expect(u.walletAddress).toBe("BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF");
  });

  it("makes audit_events append-only", async () => {
    const [e] = await db.insert(schema.auditEvents).values({ actor: "system", action: "test", entity: "x", entityId: "1" }).returning();
    const reason = (p: Promise<unknown>) => p.then(() => "allowed", (err: Error & { cause?: Error }) => String(err.cause?.message ?? err.message));
    expect(await reason(db.update(schema.auditEvents).set({ action: "changed" }).where(eq(schema.auditEvents.id, e.id)))).toMatch(/append-only \(UPDATE blocked\)/);
    expect(await reason(db.delete(schema.auditEvents).where(eq(schema.auditEvents.id, e.id)))).toMatch(/append-only \(DELETE blocked\)/);
  });

  it("has pg_trgm for near-duplicate checks", async () => {
    const r = await db.execute<{ s: number }>("select similarity('rialo reactive timers', 'rialo reactive timer') as s" as never);
    expect(Number((r as unknown as { rows: { s: number }[] }).rows[0].s)).toBeGreaterThan(0.7);
  });
});
