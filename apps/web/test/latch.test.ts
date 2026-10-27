// The Latch client: every call names its campaign in X-Merit-Campaign, and every call (allowed, denied or failed)
// lands in latch_calls with Latch's deniedBy and request id. Latch itself is stubbed (global fetch).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_LATCH_LOG", "1");
vi.stubEnv("MERIT_JUDGE_LAT", "lat_judge_parent");
vi.stubEnv("MERIT_X_LAT", "lat_x_parent");

const { getDb, schema } = await import("@/lib/db");
const { CAMPAIGN_HEADER_PATTERN, LatchDenied, campaignTag, childLatches, judgeClient, latchToken, readPost } = await import("@/lib/server/latch");
const { latchCents, usageByCampaign } = await import("@/lib/server/latch-usage");

const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
const OTHER = "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN";
const PRICING = { "claude-haiku-5-5": { inputPer1k: 0.1, outputPer1k: 0.5 } };

type Call = { url: string; headers: Headers; body: string | undefined };
let calls: Call[] = [];
let reply: () => Response;

beforeEach(async () => {
  // A child token in the developer's .env.local must not leak into (or change) these tests.
  for (const k of Object.keys(process.env)) if (k.startsWith("MERIT_JUDGE_LAT__") || k.startsWith("MERIT_X_LAT__")) vi.stubEnv(k, "");
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, headers: request.headers, body: init?.body ? String(init.body) : undefined });
    return reply();
  });
  await (await getDb()).delete(schema.latchCalls);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const logged = async () => (await getDb()).select().from(schema.latchCalls);

describe("X-Merit-Campaign", () => {
  it("accepts a campaign address or owner-<user id>, and nothing else", () => {
    expect(campaignTag(CAMPAIGN)).toBe(CAMPAIGN);
    expect(campaignTag("owner-0b7f3c2e-1d2a-4c1b-9e8f-1234567890ab")).toMatch(new RegExp(CAMPAIGN_HEADER_PATTERN));
    for (const bad of ["", "draft", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", `${CAMPAIGN}\r\nX: y`]) expect(() => campaignTag(bad)).toThrow(/campaign tag/);
  });
});

describe("merit-x", () => {
  it("sends the campaign header and logs the read with Latch's request id", async () => {
    reply = () => json(200, { data: { id: "7", author_id: "42", created_at: "2026-10-26T00:00:00Z", text: "hi" } }, { "x-latch-request-id": "req_1" });
    expect((await readPost("7", CAMPAIGN)).author_id).toBe("42");
    expect(calls[0]!.headers.get("x-merit-campaign")).toBe(CAMPAIGN);
    expect(calls[0]!.headers.get("x-user")).toBe(CAMPAIGN);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer lat_x_parent");
    expect(await logged()).toEqual([expect.objectContaining({ latch: "merit-x", via: "parent", campaign: CAMPAIGN, method: "GET", path: "/2/tweets/7", status: 200, deniedBy: null, latchRequestId: "req_1" })]);
  });

  it("logs a denial with the filter that denied, and throws it", async () => {
    reply = () => json(403, { error: "Request denied by policy", deniedBy: "Submissions only", reason: "not a Merit submission" }, { "x-latch-request-id": "req_2" });
    await expect(readPost("8", CAMPAIGN)).rejects.toBeInstanceOf(LatchDenied);
    expect(await logged()).toEqual([expect.objectContaining({ status: 403, deniedBy: "Submissions only", latchRequestId: "req_2" })]);
  });
});

describe("merit-judge", () => {
  it("sends the header on every Messages call and logs the model's usage", async () => {
    reply = () => json(200, { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 400 } }, { "x-latch-request-id": "req_3" });
    await judgeClient(CAMPAIGN).messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }], metadata: { user_id: "42" } });
    expect(calls[0]!.url).toBe("https://onlatch.com/proxy/v1/messages");
    expect(calls[0]!.headers.get("x-merit-campaign")).toBe(CAMPAIGN);
    expect(calls[0]!.headers.get("x-user")).toBe(CAMPAIGN);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer lat_judge_parent");
    expect(JSON.parse(calls[0]!.body!).metadata).toEqual({ user_id: "42" });
    expect(await logged()).toEqual([expect.objectContaining({ latch: "merit-judge", campaign: CAMPAIGN, path: "/v1/messages", status: 200, model: "claude-haiku-5-5", inputTokens: 3000, outputTokens: 400, latchRequestId: "req_3" })]);
  });
});

describe("a campaign's own child latch", () => {
  const OWNER = "owner-0b7f3c2e-1d2a-4c1b-9e8f-1234567890ab";
  beforeEach(() => {
    vi.stubEnv(`MERIT_JUDGE_LAT__${CAMPAIGN}`, "lat_judge_child");
    vi.stubEnv(`MERIT_X_LAT__${CAMPAIGN}`, "lat_x_child");
  });
  afterEach(() => {
    vi.stubEnv(`MERIT_JUDGE_LAT__${CAMPAIGN}`, "");
    vi.stubEnv(`MERIT_X_LAT__${CAMPAIGN}`, "");
  });

  it("is used for that campaign; every other campaign and the owner fall back to the parent", () => {
    expect(latchToken("merit-judge", CAMPAIGN)).toEqual({ token: "lat_judge_child", via: "child" });
    expect(latchToken("merit-x", CAMPAIGN)).toEqual({ token: "lat_x_child", via: "child" });
    expect(latchToken("merit-judge", OTHER)).toEqual({ token: "lat_judge_parent", via: "parent" });
    expect(latchToken("merit-judge", OWNER)).toEqual({ token: "lat_judge_parent", via: "parent" });
    expect(childLatches()).toEqual(expect.arrayContaining([{ campaign: CAMPAIGN, latch: "merit-judge", token: "lat_judge_child" }, { campaign: CAMPAIGN, latch: "merit-x", token: "lat_x_child" }]));
  });

  it("sends the child token and logs via child", async () => {
    reply = () => json(200, { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    await judgeClient(CAMPAIGN).messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }], metadata: { user_id: "42" } });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer lat_judge_child");
    expect(await logged()).toEqual([expect.objectContaining({ latch: "merit-judge", via: "child" })]);
  });

  it("never falls back to the parent when the child denies (its tighter cap holds)", async () => {
    reply = () => json(403, { error: "Request denied by policy", deniedBy: "spend_limit", reason: "Daily spend cap reached" });
    await expect(readPost("9", CAMPAIGN)).rejects.toMatchObject({ status: 403, deniedBy: "spend_limit" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer lat_x_child");
  });
});

describe("per-campaign usage", () => {
  it("prices calls the way the latch meters them", () => {
    expect(latchCents(PRICING, "claude-haiku-5-5", 3000, 400)).toBeCloseTo(0.5);
    expect(latchCents(PRICING, "claude-unknown", 1000, 0)).toBeCloseTo(0.1);
    expect(latchCents({}, "x", 1000, 1000)).toBe(0);
  });

  it("groups calls, spend and denials by the campaign header", async () => {
    const db = await getDb();
    const base = { method: "POST", path: "/v1/messages", via: "parent" };
    await db.insert(schema.latchCalls).values([
      { ...base, latch: "merit-judge", campaign: CAMPAIGN, status: 200, model: "claude-haiku-5-5", inputTokens: 3000, outputTokens: 400 },
      { ...base, latch: "merit-judge", campaign: CAMPAIGN, status: 403, deniedBy: "payload_4" },
      { ...base, latch: "merit-x", campaign: CAMPAIGN, method: "GET", path: "/2/tweets/7", status: 200, via: "child" },
      { ...base, latch: "merit-judge", campaign: OTHER, status: 502 },
      { ...base, latch: "merit-judge", campaign: OTHER, status: 200, createdAt: new Date(Date.now() - 3 * 86_400_000) },
    ]);
    const usage = await usageByCampaign(db, new Date(Date.now() - 86_400_000), PRICING);
    expect(usage.map((u) => u.campaign)).toEqual([CAMPAIGN, OTHER]);
    expect(usage[0]).toMatchObject({ judge: { calls: 2, allowed: 1, denied: 1, failed: 0, child: false }, x: { calls: 1, allowed: 1, child: true }, deniedBy: [{ latch: "merit-judge", filter: "payload_4", count: 1 }] });
    expect(usage[0]!.judge.cents).toBeCloseTo(0.5);
    expect(usage[1]).toMatchObject({ judge: { calls: 1, failed: 1, cents: 0 } });
  });
});
