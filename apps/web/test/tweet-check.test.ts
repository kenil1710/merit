// merit-x's custom_code filter and the endpoint it asks: only posts Merit is working on can be read. The JS policy
// (latch/merit-x-submissions-outcall.js) runs the way Latch's async custom_code mode runs it, with a governed fetch that
// reaches Merit's route through the merit-check latch (stubbed here: it injects x-merit-check-key).

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_LATCH_LOG", "1");
vi.stubEnv("MERIT_X_LAT", "lat_x_parent");
vi.stubEnv("MERIT_CHECK_KEY", "k".repeat(48));

const { getDb, schema } = await import("@/lib/db");
const { INTENT_TTL_MS, RECENT_MS, checkKeyMatches, knownPosts, parseIds, postIdOf, recordIntent } = await import("@/lib/server/tweet-check");
const { xGet } = await import("@/lib/server/latch");
const route = await import("@/app/api/latch/tweet-check/[ids]/route");
const { upsertWalletUser } = await import("@/lib/server/programs");
const { upsertXUser } = await import("@/lib/server/contributors");
const { EXAMPLE_RUBRIC } = await import("@/lib/shared/program");
const { Keypair } = await import("@rialo/ts-cdk");

const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
const KEY = "k".repeat(48);
const NOW = new Date();
let seq = 0;

async function submission(resourceId: string, status: "pending" | "approved" | "rejected" | "paid", createdAt = NOW) {
  const db = await getDb();
  const owner = await upsertWalletUser(db, Keypair.generate().publicKey.toString());
  const [p] = await db
    .insert(schema.programs)
    .values({
      slug: `tc-${++seq}-${Date.now()}`, name: "P", description: "d", ownerUserId: owner.id, ownerWallet: owner.walletAddress!, rubricJson: EXAMPLE_RUBRIC, ratePerPoint: 1n,
      limitsJson: { maxPerPayout: "1", maxPerContributor: "1", maxPerRound: "1", maxPerDay: "1", autoApproveThreshold: "1", payeeCooldownSeconds: 0, maxAutoApproveItem: "1" },
      autoApproveConfidence: 0.8, roundLengthMinutes: 5, firstRoundStartsAt: NOW,
    })
    .returning();
  const user = await upsertXUser(db, { xUserId: `${900 + seq}`, handle: `u${seq}`, createdAt: new Date("2020-01-01"), followers: 500 });
  const [c] = await db.insert(schema.contributors).values({ programId: p!.id, userId: user.id, xUserId: `${900 + seq}`, xHandle: `u${seq}` }).returning();
  await db.insert(schema.submissions).values({ programId: p!.id, contributorId: c!.id, url: `https://x.com/u/status/${resourceId}`, sourceType: "x_post", resourceId, status, createdAt });
}

const ask = (ids: string, key: string | null = KEY) =>
  route.GET(new Request(`http://merit.test/api/latch/tweet-check/${ids}`, { headers: key ? { "x-merit-check-key": key } : {} }) as never, { params: Promise.resolve({ ids }) });

describe("what counts as a post Merit is working on", () => {
  it("parses ids and lookup paths strictly", () => {
    expect(parseIds("1,2,2")).toEqual(["1", "2"]);
    expect(parseIds("1%2C2")).toEqual(["1", "2"]);
    for (const bad of ["", "a", "1,,2", "1".repeat(21), Array.from({ length: 11 }, (_, i) => i + 1).join(",")]) expect(parseIds(bad)).toBeNull();
    expect(postIdOf("/2/tweets/7?tweet.fields=a")).toBe("7");
    expect(postIdOf("/2/tweets/search/recent?q=1")).toBeNull();
    expect(postIdOf("/2/users/7")).toBeNull();
  });

  it("an open submission, a recent one, or an unexpired intent; not an old closed one or an expired intent", async () => {
    const db = await getDb();
    await submission("8101", "pending");
    await submission("8102", "paid");
    await submission("8103", "paid", new Date(NOW.getTime() - RECENT_MS - 60_000));
    await submission("8104", "approved", new Date(NOW.getTime() - RECENT_MS - 60_000));
    await recordIntent(db, "8105", CAMPAIGN);
    await recordIntent(db, "8106", CAMPAIGN, new Date(NOW.getTime() - INTENT_TTL_MS - 60_000));
    const known = await knownPosts(db, ["8101", "8102", "8103", "8104", "8105", "8106", "8107"]);
    expect([...known].sort()).toEqual(["8101", "8102", "8104", "8105"]);
  });

  it("compares the key in constant time and fails closed without one", () => {
    expect(checkKeyMatches(KEY, KEY)).toBe(true);
    expect(checkKeyMatches("k", KEY)).toBe(false);
    expect(checkKeyMatches(null, KEY)).toBe(false);
    expect(checkKeyMatches(KEY, undefined)).toBe(false);
  });
});

describe("GET /api/latch/tweet-check/[ids]", () => {
  it("answers MERIT-OK only when every id is known, only to the merit-check key", async () => {
    await submission("8201", "approved");
    await submission("8202", "pending");
    const ok = await ask("8201,8202");
    expect([ok.status, await ok.text()]).toEqual([200, "MERIT-OK 8201,8202"]);
    const no = await ask("8201,8299");
    expect([no.status, await no.text()]).toEqual([404, "MERIT-NO 8299"]);
    expect((await ask("8201", "wrong")).status).toBe(401);
    expect((await ask("8201", null)).status).toBe(401);
    expect((await ask("abc")).status).toBe(400);
  });

  it("refuses everyone when the server has no key", async () => {
    vi.stubEnv("MERIT_CHECK_KEY", "");
    expect((await ask("8201")).status).toBe(503);
    vi.stubEnv("MERIT_CHECK_KEY", KEY);
  });
});

describe("Merit's own reads announce the post first", () => {
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { id: "8301" } }), { status: 200 })));
  afterEach(() => vi.unstubAllGlobals());
  it("xGet records an intent before reading /2/tweets/:id", async () => {
    await xGet("/2/tweets/8301?tweet.fields=author_id", CAMPAIGN);
    expect([...(await knownPosts(await getDb(), ["8301"]))]).toEqual(["8301"]);
  });
});

describe("merit-x custom_code (JavaScript), as Latch runs it", () => {
  const code = readFileSync(path.resolve(import.meta.dirname, "../../../latch/merit-x-submissions-outcall.js"), "utf8");
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (ctx: unknown, fetch: unknown) => Promise<{ allow: boolean; reason?: string }>;
  const policy = new AsyncFunction("ctx", "fetch", code);
  /** The governed fetch: relative paths only, through merit-check (which injects the key) to Merit's route. */
  const governed = async (rel: string) => {
    if (!rel.startsWith("/")) throw new Error("absolute URLs are rejected");
    const ids = rel.split("/").pop()!;
    return ask(ids);
  };
  const run = (method: string, p: string, fetchImpl: unknown = governed) => policy({ method, path: p, headers: {}, body: undefined }, fetchImpl);

  it("lets a submission through (REX validators' path included) and denies a random post", async () => {
    await submission("8401", "approved");
    expect(await run("GET", "/2/tweets/8401")).toEqual({ allow: true });
    expect(await run("GET", "/2/tweets/8401?tweet.fields=author_id,created_at")).toEqual({ allow: true });
    expect(await run("GET", "/2/tweets/1999999999999999999")).toEqual({ allow: false, reason: "not a Merit submission (check answered 404)" });
  });

  it("checks every id of ?ids=, and denies when it can't see them", async () => {
    await submission("8402", "pending");
    await submission("8403", "pending");
    expect(await run("GET", "/2/tweets?ids=8402,8403")).toEqual({ allow: true });
    expect((await run("GET", "/2/tweets?ids=8402,1")).allow).toBe(false);
    expect((await run("GET", "/2/tweets")).allow).toBe(false);
  });

  it("is read-only, refuses other tweet paths, passes /2/users through, and fails closed", async () => {
    expect(await run("POST", "/2/tweets")).toEqual({ allow: false, reason: "merit-x is read-only" });
    expect((await run("GET", "/2/tweets/search/recent?query=x")).allow).toBe(false);
    expect(await run("GET", "/2/users/42")).toEqual({ allow: true });
    expect(await run("GET", "/2/tweets/8401", async () => { throw new Error("down"); })).toEqual({ allow: false, reason: "Merit's submission check is unreachable (fail closed)" });
    expect((await run("GET", "/2/tweets/8401", async () => new Response("<html>ok</html>", { status: 200 }))).allow).toBe(false);
  });
});
