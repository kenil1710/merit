import "server-only";

import { and, isNotNull, lt, or } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { pruneRateHits } from "./rate-limit";

// Rows nothing reads again, deleted by the daily cron so the tables don't grow without bound.
export const RETENTION = {
  /** Sign-in nonces: used or expired a day ago. */
  nonceMs: 86_400_000,
  /** merit-x read intents: the check only honours unexpired ones. */
  intentMs: 7 * 86_400_000,
  /** Faucet grants: the limits look back 24 hours. */
  faucetMs: 2 * 86_400_000,
  /** Latch call log: Guardrails and metrics read recent days; keep a quarter. */
  latchCallMs: 90 * 86_400_000,
};

export async function housekeeping(db: Db, now = Date.now()): Promise<void> {
  const before = (ms: number) => new Date(now - ms);
  const n = schema.authNonces;
  await db.delete(n).where(or(lt(n.expiresAt, before(RETENTION.nonceMs)), and(isNotNull(n.usedAt), lt(n.usedAt, before(RETENTION.nonceMs)))));
  await db.delete(schema.latchIntents).where(lt(schema.latchIntents.expiresAt, before(RETENTION.intentMs)));
  await db.delete(schema.faucetGrants).where(lt(schema.faucetGrants.createdAt, before(RETENTION.faucetMs)));
  await db.delete(schema.latchCalls).where(lt(schema.latchCalls.createdAt, before(RETENTION.latchCallMs)));
  await pruneRateHits(db, now);
}
