// Fixes from the independent audit (docs/AUDIT.md, 2026-10-28).

import { describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
const { getDb, schema } = await import("@/lib/db");
const { safeReturnTo } = await import("@/lib/server/http");
const { allow, hit, pruneRateHits, rule } = await import("@/lib/server/rate-limit");

const ORIGIN = "https://merit-ruby-two.vercel.app";

describe("M-4: sign-in only returns to a path on this site", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeReturnTo("/join/rialo-in-your-own-words", ORIGIN)).toBe("/join/rialo-in-your-own-words");
    expect(safeReturnTo("/c/x?tab=paid#r2", ORIGIN)).toBe("/c/x?tab=paid#r2");
  });

  it.each([
    "/\\evil.example",
    "/%5Cevil.example/../\\evil.example",
    "//evil.example",
    "///evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/\tevil",
    "/\nevil",
    "evil.example",
    "",
  ])("refuses %j", (raw) => {
    expect(safeReturnTo(raw, ORIGIN)).toBe("/join");
  });

  it("refuses a missing value and uses the fallback given", () => {
    expect(safeReturnTo(null, ORIGIN)).toBe("/join");
    expect(safeReturnTo(undefined, ORIGIN, "/c")).toBe("/c");
  });

  it("whatever it returns resolves to our origin", () => {
    for (const raw of ["/\\evil.example", "/ok", "//x", "/a/../../b"]) expect(new URL(safeReturnTo(raw, ORIGIN), ORIGIN).origin).toBe(ORIGIN);
  });
});

describe("M-5 / L-4: rate limits are counted in Postgres, shared by every instance", () => {
  it("allows up to the limit in a window, then refuses, then resets in the next window", async () => {
    const db = await getDb();
    const r = rule(`t:${crypto.randomUUID()}`, 3, 60_000);
    const t = Date.parse("2026-10-28T10:00:05Z");
    expect([await hit(db, r, t), await hit(db, r, t), await hit(db, r, t), await hit(db, r, t)]).toEqual([true, true, true, false]);
    expect(await hit(db, r, t + 60_000)).toBe(true);
  });

  it("counts concurrent hits exactly (no lost updates)", async () => {
    const db = await getDb();
    const r = rule(`t:${crypto.randomUUID()}`, 5, 60_000);
    const results = await Promise.all(Array.from({ length: 12 }, () => hit(db, r)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("a request passes only when every rule it names is under its limit (per owner, wallet, IP, everyone)", async () => {
    const id = crypto.randomUUID();
    const shared = rule(`all:${id}`, 2, 86_400_000);
    expect(await allow(rule(`owner:a:${id}`, 10, 60_000), shared)).toBe(true);
    expect(await allow(rule(`owner:b:${id}`, 10, 60_000), shared)).toBe(true);
    // A fresh owner (new wallet) still hits the shared cap.
    expect(await allow(rule(`owner:c:${id}`, 10, 60_000), shared)).toBe(false);
  });

  it("prunes counters older than two days", async () => {
    const db = await getDb();
    const key = `old:${crypto.randomUUID()}`;
    await hit(db, rule(key, 1, 60_000), Date.now() - 3 * 86_400_000);
    await pruneRateHits(db);
    const rows = await db.select().from(schema.rateHits);
    expect(rows.some((r) => r.key === key)).toBe(false);
  });
});
