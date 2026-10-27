import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

const TTL_MS = 10 * 60_000;
type Purpose = (typeof schema.noncePurpose.enumValues)[number];

/** A single-use nonce bound to one subject (the wallet signing in, or the user linking a wallet). */
export async function issueNonce(db: Db, purpose: Purpose, subject: string) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);
  // Long-expired nonces are dropped on the way, so the table stays small.
  await db.delete(schema.authNonces).where(lt(schema.authNonces.expiresAt, new Date(Date.now() - 86_400_000)));
  await db.insert(schema.authNonces).values({ nonce, purpose, subject, expiresAt });
  return { nonce, expiresAt };
}

/**
 * Marks a nonce used in one UPDATE, so two concurrent replays can't both win. False when it doesn't exist, expired,
 * was used, has another purpose, or was issued to another subject.
 */
export async function consumeNonce(db: Db, nonce: string, purpose: Purpose, subject: string): Promise<boolean> {
  const rows = await db
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authNonces.nonce, nonce),
        eq(schema.authNonces.purpose, purpose),
        eq(schema.authNonces.subject, subject),
        isNull(schema.authNonces.usedAt),
        gt(schema.authNonces.expiresAt, new Date()),
      ),
    )
    .returning({ nonce: schema.authNonces.nonce });
  return rows.length === 1;
}
