import "server-only";

import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema, type Db } from "@/lib/db";

// Fixed-window limits counted in Postgres, so every server instance agrees on them. Each call counts against every
// rule it names (say per owner, per wallet, per IP and for everyone) and is allowed only when all are under their
// limit. If the database can't be reached the request is refused: the limits guard paid model calls.

export type Rule = { key: string; limit: number; windowMs: number };

export async function hit(db: Db, rule: Rule, now = Date.now()): Promise<boolean> {
  const t = schema.rateHits;
  const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs);
  const [row] = await db
    .insert(t)
    .values({ key: rule.key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [t.key, t.windowStart], set: { count: sql`${t.count} + 1` } })
    .returning({ count: t.count });
  return row.count <= rule.limit;
}

export async function allow(...rules: Rule[]): Promise<boolean> {
  try {
    const db = await getDb();
    const now = Date.now();
    const results = await Promise.all(rules.map((rule) => hit(db, rule, now)));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

/** Shorthand for one rule. */
export const rule = (key: string, limit: number, windowMs: number): Rule => ({ key, limit, windowMs });

/** Counters older than a day are never read again (the longest window is a day). */
export async function pruneRateHits(db: Db, now = Date.now()): Promise<void> {
  await db.delete(schema.rateHits).where(lt(schema.rateHits.windowStart, new Date(now - 2 * 86_400_000)));
}

export function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** The caller's IP, hashed, for a rate-limit key: the counters never store a raw address. */
export const ipKey = (request: NextRequest) => createHash("sha256").update(`merit-rate:${clientKey(request)}`).digest("hex").slice(0, 32);
