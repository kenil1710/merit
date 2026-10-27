import "server-only";

// Off-chain records Merit needs beside the chain:
//   judgements  - the judge's score, reasons and checks (hash on chain)
//   links       - X account <-> Rialo wallet, proven by a wallet signature
//   campaigns   - campaign name, brief and slug (the slug is public; only the
//                 owner's key can act on the campaign)
// They live in Merit's Postgres (store_records). Committed seed data (data/)
// is read-only and fills in what the database doesn't have. Until 2026-10-27
// they lived in a Vercel Blob store; scripts/migrate-blob-to-neon.mjs moved
// them, and no runtime code touches Blob any more.

import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { StoredJudgement } from "@/lib/merit/judgement";

export type WalletLink = { xUserId: string; username: string; wallet: string; message: string; signature: string; linkedAt: string };
export type CampaignMeta = { address: string; owner: string; slug: string; name: string; brief: string; createdAt: string };
type Kind = "judgements" | "links" | "campaigns";

const SEED_DIR = path.join(process.cwd(), "data");
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export class RecordExists extends Error {}

function seedFile(kind: Kind, key: string) {
  if (!SAFE.test(key)) throw new Error("invalid record key");
  return path.join(SEED_DIR, kind, `${key}.json`);
}

async function readSeed<T>(kind: Kind, key: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ seedFile(kind, key), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function read<T>(kind: Kind, key: string): Promise<T | null> {
  if (!SAFE.test(key)) throw new Error("invalid record key");
  const db = await getDb();
  const [row] = await db
    .select({ value: schema.storeRecords.valueJson })
    .from(schema.storeRecords)
    .where(and(eq(schema.storeRecords.kind, kind), eq(schema.storeRecords.key, key)))
    .limit(1);
  return row ? (row.value as T) : readSeed<T>(kind, key);
}

/** Write-once by default (first writer wins: a second write throws RecordExists); `overwrite` replaces. */
async function write(kind: Kind, key: string, value: unknown, { overwrite = false } = {}) {
  if (!SAFE.test(key)) throw new Error("invalid record key");
  const db = await getDb();
  const row = { kind, key, valueJson: value, source: "app" };
  if (overwrite) {
    await db
      .insert(schema.storeRecords)
      .values(row)
      .onConflictDoUpdate({ target: [schema.storeRecords.kind, schema.storeRecords.key], set: { valueJson: value, source: "app", updatedAt: new Date() } });
    return;
  }
  if (await readSeed(kind, key)) throw new RecordExists(`${kind}/${key} already exists`);
  const inserted = await db.insert(schema.storeRecords).values(row).onConflictDoNothing().returning({ key: schema.storeRecords.key });
  if (inserted.length === 0) throw new RecordExists(`${kind}/${key} already exists`);
}

/** Every record of a kind: one query, plus the committed seed files the database doesn't override. */
async function list<T>(kind: Kind): Promise<T[]> {
  const out = new Map<string, T>();
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(/*turbopackIgnore: true*/ SEED_DIR, kind));
  } catch {
    names = [];
  }
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    out.set(name.slice(0, -5), JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ SEED_DIR, kind, name), "utf8")) as T);
  }
  const rows = await (await getDb()).select({ key: schema.storeRecords.key, value: schema.storeRecords.valueJson }).from(schema.storeRecords).where(eq(schema.storeRecords.kind, kind));
  for (const r of rows) out.set(r.key, r.value as T);
  return [...out.values()];
}

export const store = {
  judgement: (postId: string) => read<StoredJudgement>("judgements", postId),
  saveJudgement: (postId: string, value: StoredJudgement) => write("judgements", postId, value),
  link: (xUserId: string) => read<WalletLink>("links", xUserId),
  saveLink: (value: WalletLink) => write("links", value.xUserId, value, { overwrite: true }),
  campaign: (address: string) => read<CampaignMeta>("campaigns", address),
  campaigns: () => list<CampaignMeta>("campaigns"),
  saveCampaign: (value: CampaignMeta) => write("campaigns", value.address, value),
};
