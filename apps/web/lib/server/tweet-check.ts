import "server-only";

import { timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

/**
 * What merit-x's custom_code filter asks before it lets an X post read through: is every id a post Merit is working
 * on? Yes when Merit announced it is about to read it (an unexpired intent), or it is a submission that is still
 * open (pending, processing, escalated, approved or partial: it can still be judged again or verified by REX), or
 * any submission from the last two weeks. Anything else is no, so a merit-x token alone can't read arbitrary posts.
 */

/** How long Merit's own announced read stays valid. Covers a judgment and the REX verification right after it. */
export const INTENT_TTL_MS = 30 * 60_000;
export const RECENT_MS = 14 * 86_400_000;
export const MAX_IDS = 10;
const OPEN = ["pending", "processing", "escalated", "approved", "partial"] as const;

/** Parses "1,2,3" (the endpoint's path segment). Null when it isn't 1–10 numeric post ids. */
export function parseIds(raw: string): string[] | null {
  const ids = decodeURIComponent(raw).split(",");
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => /^\d{1,20}$/.test(id))) return null;
  return [...new Set(ids)];
}

/** The post id of a merit-x lookup path (/2/tweets/<id>, with or without a query), else null. */
export function postIdOf(path: string): string | null {
  return /^\/2\/tweets\/(\d{1,20})(?:\?.*)?$/.exec(path)?.[1] ?? null;
}

export async function recordIntent(db: Db, postId: string, campaign: string, now = new Date()): Promise<void> {
  await db.insert(schema.latchIntents).values({ postId, campaign, expiresAt: new Date(now.getTime() + INTENT_TTL_MS) });
}

/** The ids among `ids` that Merit would read now. */
export async function knownPosts(db: Db, ids: string[], now = new Date()): Promise<Set<string>> {
  const intents = await db
    .select({ id: schema.latchIntents.postId })
    .from(schema.latchIntents)
    .where(and(inArray(schema.latchIntents.postId, ids), gt(schema.latchIntents.expiresAt, now)));
  const s = schema.submissions;
  const submitted = await db
    .select({ id: s.resourceId })
    .from(s)
    .where(and(eq(s.sourceType, "x_post"), inArray(s.resourceId, ids), or(inArray(s.status, [...OPEN]), gt(s.createdAt, new Date(now.getTime() - RECENT_MS)))));
  return new Set([...intents, ...submitted].map((r) => r.id));
}

/** Constant-time check of the key the merit-check latch injects. False when the server has no key (fail closed). */
export function checkKeyMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
