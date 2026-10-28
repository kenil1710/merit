import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { KELVIN_PER_RLO } from "@/lib/merit/constants";

// The DevNet faucet through Merit's relay, limited in Postgres so every server instance agrees: one grant per
// wallet per day, a few per IP per day, and none for a wallet that already holds 1 RLO.

export const FAUCET_WALLET_WINDOW_MS = 24 * 3_600_000;
export const FAUCET_PER_IP_PER_DAY = 3;
export const FAUCET_ENOUGH_KELVIN = KELVIN_PER_RLO;

export const hashIp = (ip: string) => createHash("sha256").update(`merit-faucet:${ip}`).digest("hex");

export type FaucetVerdict =
  | { ok: true }
  | { ok: false; reason: "wallet" | "ip" | "balance"; message: string; nextAt: Date | null };

const inHours = (at: Date, now: number) => {
  const h = Math.max(1, Math.ceil((at.getTime() - now) / 3_600_000));
  return `${h} h`;
};

/** Whether this wallet (from this IP) may get faucet RLO now, and if not, when it next can. */
export async function faucetVerdict(db: Db, wallet: string, ipHash: string, balance: bigint | null, now = Date.now()): Promise<FaucetVerdict> {
  if (balance !== null && balance >= FAUCET_ENOUGH_KELVIN) {
    return { ok: false, reason: "balance", message: "This wallet already holds 1 RLO or more, so the faucet skips it.", nextAt: null };
  }
  const since = new Date(now - FAUCET_WALLET_WINDOW_MS);
  const g = schema.faucetGrants;
  const [mine] = await db
    .select({ last: sql<Date | null>`max(${g.createdAt})` })
    .from(g)
    .where(and(eq(g.wallet, wallet), gte(g.createdAt, since)));
  if (mine?.last) {
    const nextAt = new Date(new Date(mine.last).getTime() + FAUCET_WALLET_WINDOW_MS);
    return { ok: false, reason: "wallet", message: `This wallet got faucet RLO in the last 24 hours. Next faucet in ${inHours(nextAt, now)}.`, nextAt };
  }
  const fromIp = await db
    .select({ at: g.createdAt })
    .from(g)
    .where(and(eq(g.ipHash, ipHash), gte(g.createdAt, since)))
    .orderBy(g.createdAt);
  if (fromIp.length >= FAUCET_PER_IP_PER_DAY) {
    const nextAt = new Date(new Date(fromIp[0].at).getTime() + FAUCET_WALLET_WINDOW_MS);
    return { ok: false, reason: "ip", message: `The faucet allows ${FAUCET_PER_IP_PER_DAY} requests per day from one network. Next faucet in ${inHours(nextAt, now)}.`, nextAt };
  }
  return { ok: true };
}

/**
 * Records a grant before the airdrop is sent, so two requests at once can't both pass. Returns false (and records
 * nothing) when another grant for the wallet got in first.
 */
export async function reserveGrant(db: Db, wallet: string, ipHash: string, kelvin: bigint, now = Date.now()): Promise<{ id: string } | null> {
  const g = schema.faucetGrants;
  const [row] = await db.insert(g).values({ wallet, ipHash, kelvin, createdAt: new Date(now) }).returning({ id: g.id });
  const rows = await db
    .select({ id: g.id })
    .from(g)
    .where(and(eq(g.wallet, wallet), gte(g.createdAt, new Date(now - FAUCET_WALLET_WINDOW_MS))))
    .orderBy(g.createdAt, g.id);
  if (rows[0]?.id !== row.id) {
    await db.delete(g).where(eq(g.id, row.id));
    return null;
  }
  return row;
}

/** The airdrop failed: the grant doesn't count. */
export async function releaseGrant(db: Db, id: string): Promise<void> {
  await db.delete(schema.faucetGrants).where(eq(schema.faucetGrants.id, id));
}
