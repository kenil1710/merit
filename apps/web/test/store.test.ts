// The off-chain store, in Postgres (store_records) with the committed seed data as a read-only fallback. No Vercel
// Blob: the store was blocked at the Hobby plan's 2,000 "advanced operations", mostly one list per page view.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
const { getDb, schema } = await import("@/lib/db");
const { RecordExists, store } = await import("@/lib/server/store");

const ROUND1 = "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN";
const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
const meta = { address: CAMPAIGN, owner: "BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF", slug: "31".repeat(32), name: "Rialo in your own words", brief: "b", createdAt: "2026-10-26T00:00:00Z" };

beforeEach(async () => {
  await (await getDb()).delete(schema.storeRecords);
});

describe("store (Postgres)", () => {
  it("reads committed seed records when the database has none", async () => {
    expect((await store.campaign(ROUND1))?.name).toBe("Explain Rialo in one post");
    expect(await store.judgement("2113550979329368489")).toMatchObject({ campaign: ROUND1 });
    expect(await store.campaign(CAMPAIGN)).toBeNull();
  });

  it("campaign records are write-once: the first writer wins", async () => {
    await store.saveCampaign(meta);
    expect(await store.campaign(CAMPAIGN)).toEqual(meta);
    await expect(store.saveCampaign({ ...meta, name: "Someone else" })).rejects.toBeInstanceOf(RecordExists);
    await expect(store.saveCampaign({ ...(await store.campaign(ROUND1))!, name: "x" })).rejects.toBeInstanceOf(RecordExists); // seed too
    expect((await store.campaign(CAMPAIGN))?.name).toBe("Rialo in your own words");
  });

  it("lists every campaign in one query, seed plus database", async () => {
    await store.saveCampaign(meta);
    expect((await store.campaigns()).map((c) => c.address).sort()).toEqual([CAMPAIGN, ROUND1].sort());
  });

  it("wallet links overwrite; judgements are write-once", async () => {
    const link = { xUserId: "42", username: "a", wallet: "W1", message: "m", signature: "s", linkedAt: "t" };
    await store.saveLink(link);
    await store.saveLink({ ...link, wallet: "W2" });
    expect((await store.link("42"))?.wallet).toBe("W2");
    const j = { campaign: CAMPAIGN, round: 1, canonical: "{}", submissionHash: "h", text: "t", judgedAt: "now", outcome: "approved" as const };
    await store.saveJudgement("7", j);
    await expect(store.saveJudgement("7", j)).rejects.toBeInstanceOf(RecordExists);
  });

  it("refuses unsafe keys", async () => {
    await expect(store.campaign("../etc/passwd")).rejects.toThrow(/invalid record key/);
  });
});
