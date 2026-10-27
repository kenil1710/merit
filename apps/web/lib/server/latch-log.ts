import "server-only";

import { getDb, schema } from "@/lib/db";

export type LatchCall = typeof schema.latchCalls.$inferInsert;

/**
 * Writes one row to latch_calls. A logging failure never fails the call it describes. Unit tests skip it unless
 * they opt in with MERIT_LATCH_LOG=1, so live tests don't write to the real database.
 */
export async function recordLatchCall(row: LatchCall): Promise<void> {
  if (process.env.VITEST && process.env.MERIT_LATCH_LOG !== "1") return;
  try {
    await (await getDb()).insert(schema.latchCalls).values(row);
  } catch (error) {
    console.warn(`latch_calls: not recorded (${(error as Error).message.slice(0, 120)})`);
  }
}
