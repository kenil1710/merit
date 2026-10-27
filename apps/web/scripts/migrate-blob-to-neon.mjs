// One-time move of Merit's off-chain records from the Vercel Blob store into Neon (store_records). Re-runnable.
// Usage: node scripts/migrate-blob-to-neon.mjs [--apply] [--blob-env <file with BLOB_READ_WRITE_TOKEN>]
//
// Sources, best first:
//   blob            the store itself (merit/{campaigns,judgements,links}/<key>.json). Blocked until 2026-11-26 (Hobby
//                   "advanced operations" limit); a failed read is reported and skipped. Costs 3 list calls plus pages.
//   seed            the committed fallback records in data/.
//   neon:programs   a campaign record rebuilt from its program row (name, description as the brief, slug, owner).
//   neon:decisions  an approved post's judge record rebuilt from its decision, as the pipeline would have saved it.
// A row Merit itself wrote (source "app") is never replaced. A blob record replaces a seed or rebuilt one. Otherwise
// the first source to supply a key wins, and a re-run refreshes what it derived before. Nothing is ever deleted, in Neon or in Blob. Without --apply it only reports.
import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const blobEnv = args.includes("--blob-env") ? args[args.indexOf("--blob-env") + 1] : null;
const parseEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")]),
  );
const env = parseEnv(new URL("../.env.local", import.meta.url));
const sql = neon(env.DATABASE_URL);
const KINDS = ["campaigns", "judgements", "links"];
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** kind -> key -> { value, source } */
const found = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
const offer = (kind, key, value, source) => {
  if (!SAFE.test(key) || found[kind].has(key)) return;
  found[kind].set(key, { value, source });
};

// 1. Blob
const blobToken = blobEnv ? parseEnv(blobEnv).BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN;
if (blobToken) {
  const { list, get } = await import("@vercel/blob");
  for (const kind of KINDS) {
    try {
      let cursor;
      do {
        const page = await list({ prefix: `merit/${kind}/`, cursor, token: blobToken });
        for (const b of page.blobs) {
          const key = path.basename(b.pathname, ".json");
          try {
            const r = await get(b.pathname, { access: "private", useCache: false, token: blobToken });
            if (r?.statusCode === 200 && r.stream) offer(kind, key, JSON.parse(await new Response(r.stream).text()), "blob");
          } catch (e) {
            console.log(`blob: ${b.pathname} not read (${e.message.slice(0, 80)})`);
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    } catch (e) {
      console.log(`blob: ${kind} not listed (${e.message.slice(0, 80)})`);
    }
  }
} else console.log("blob: no BLOB_READ_WRITE_TOKEN given, skipped");

// 2. Committed seed data
for (const kind of KINDS) {
  let names = [];
  try {
    names = (await import("node:fs")).readdirSync(new URL(`../data/${kind}/`, import.meta.url));
  } catch {
    names = [];
  }
  for (const n of names.filter((n) => n.endsWith(".json"))) offer(kind, n.slice(0, -5), JSON.parse(readFileSync(new URL(`../data/${kind}/${n}`, import.meta.url), "utf8")), "seed");
}

// 3. Rebuilt from Neon
for (const p of await sql`select campaign_address, campaign_slug_hex, owner_wallet, name, description, created_at from programs where campaign_address is not null and campaign_slug_hex is not null`) {
  offer("campaigns", p.campaign_address, { address: p.campaign_address, owner: p.owner_wallet, slug: p.campaign_slug_hex, name: p.name, brief: p.description, createdAt: new Date(p.created_at).toISOString() }, "neon:programs");
}
for (const r of await sql`
  select distinct on (s.id) s.resource_id, s.approve_signature, p.campaign_address, c.wallet_address, c.x_handle,
         d.decision_json, d.decision_hash, d.created_at, f.content_text
  from submissions s
  join programs p on p.id = s.program_id
  join contributors c on c.id = s.contributor_id
  join decisions d on d.submission_id = s.id and d.action in ('approve', 'partial')
  left join fetched_resources f on f.source_type = s.source_type and f.resource_id = s.resource_id
  where s.approve_signature is not null and p.campaign_address is not null
  order by s.id, d.created_at desc`) {
  const record = JSON.parse(r.decision_json);
  offer(
    "judgements",
    r.resource_id,
    {
      // The signed record names the campaign it was approved on (a program row can be re-pointed to a newer one).
      campaign: record.campaign ?? r.campaign_address,
      round: record.round?.number ?? null,
      outcome: "approved",
      contributor: r.wallet_address ?? undefined,
      xUsername: r.x_handle,
      approveSignature: r.approve_signature,
      canonical: r.decision_json,
      submissionHash: r.decision_hash,
      text: r.content_text ?? "",
      judgedAt: new Date(r.created_at).toISOString(),
    },
    "neon:decisions",
  );
}

// Write
const existing = new Map((await sql`select kind, key, source from store_records`).map((r) => [`${r.kind}/${r.key}`, r.source]));
const counts = {};
for (const kind of KINDS) {
  for (const [key, { value, source }] of found[kind]) {
    const had = existing.get(`${kind}/${key}`);
    // Replace: a blob record over a derived one, or a fresh derivation over the same source's older one.
    const action = !had ? "insert" : had !== "app" && ((source === "blob" && had !== "blob") || had === source) ? "replace" : "keep";
    const tag = `${kind} ${source} ${action}`;
    counts[tag] = (counts[tag] ?? 0) + 1;
    if (!apply || action === "keep") continue;
    if (action === "insert") await sql`insert into store_records (kind, key, value_json, source) values (${kind}, ${key}, ${JSON.stringify(value)}::jsonb, ${source}) on conflict do nothing`;
    else await sql`update store_records set value_json = ${JSON.stringify(value)}::jsonb, source = ${source}, updated_at = now() where kind = ${kind} and key = ${key} and source <> 'app'`;
  }
}
console.log(JSON.stringify({ apply, counts }, null, 1));
