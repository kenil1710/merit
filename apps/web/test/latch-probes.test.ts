// "Try a bad request" and the per-latch pipeline: Latch is asked first, and a probe is sent for real only when
// Latch says deny, so it never reaches Anthropic or X. Latch is stubbed (global fetch).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_JUDGE_LAT", "lat_judge_parent");
vi.stubEnv("MERIT_X_LAT", "lat_x_parent");

const { getDb, schema } = await import("@/lib/db");
const { PROBES, SNAPSHOT_TTL_MS, pipelineSnapshot, runProbe } = await import("@/lib/server/latch-probes");
const { describeStep } = await import("@/components/guardrails/filter-list");

const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
type Sent = { url: string; method: string; headers: Headers; body: unknown };
let sent: Sent[] = [];
let authorizeAnswer: Record<string, unknown>;
let proxyAnswer: () => Response;

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init);
    sent.push({ url: r.url, method: r.method, headers: r.headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (r.url.endsWith("/latch-self/authorize")) return Response.json(authorizeAnswer);
    return proxyAnswer();
  });
});
afterEach(() => vi.unstubAllGlobals());

const step = (filterName: string, filterType: string, decision: string, metadata: Record<string, unknown> = {}, reason?: string) => ({ filterName, filterType, decision, metadata, ...(reason ? { reason } : {}) });

describe("probes", () => {
  it("covers every rule the page promises", () => {
    expect(Object.keys(PROBES).sort()).toEqual(["judge-no-campaign", "judge-too-many-tokens", "judge-wrong-model", "x-non-numeric", "x-write"]);
  });

  it("asks Latch first, then sends the denied request for the real 403 and deniedBy", async () => {
    authorizeAnswer = { authorized: false, deniedBy: "payload_4", reason: "Only claude-haiku-5-5 allowed", trace: [step("endpoint_1", "endpoint", "allow"), step("payload_4", "payload", "deny", {}, "Only claude-haiku-5-5 allowed")] };
    proxyAnswer = () => Response.json({ error: "Request denied by policy", requestId: "req_9", deniedBy: "payload_4", reason: "Only claude-haiku-5-5 allowed" }, { status: 403 });
    const r = await runProbe("judge-wrong-model", CAMPAIGN);
    expect(r).toMatchObject({ outcome: "denied", status: 403, deniedBy: "payload_4", requestId: "req_9", request: { method: "POST", path: "/v1/messages", campaignHeader: true } });
    expect(r.trace).toHaveLength(2);
    expect(sent.map((s) => s.url)).toEqual(["https://onlatch.com/proxy/.well-known/latch-self/authorize", "https://onlatch.com/proxy/v1/messages"]);
    expect(sent[0]!.body).toMatchObject({ method: "POST", path: "/v1/messages", headers: { "x-merit-campaign": CAMPAIGN, "x-user": CAMPAIGN }, body: { model: "claude-opus-5-5" } });
    expect(sent[1]!.headers.get("x-merit-campaign")).toBe(CAMPAIGN);
  });

  it("sends nothing when Latch would allow it (the rule isn't installed yet)", async () => {
    authorizeAnswer = { authorized: true, trace: [step("method_0", "method", "allow")] };
    proxyAnswer = () => {
      throw new Error("must not be sent");
    };
    const r = await runProbe("judge-no-campaign", CAMPAIGN);
    expect(r).toMatchObject({ outcome: "would-allow", request: { campaignHeader: false } });
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { headers: object }).headers).toEqual({});
  });

  it("uses a non-numeric tweet path and a real write for merit-x", async () => {
    authorizeAnswer = { authorized: false, deniedBy: "method_0", reason: "Method POST not allowed", trace: [] };
    proxyAnswer = () => Response.json({ deniedBy: "method_0", reason: "Method POST not allowed" }, { status: 403 });
    expect(await runProbe("x-write", CAMPAIGN)).toMatchObject({ outcome: "denied", request: { method: "POST", path: "/2/tweets" } });
    const path = await runProbe("x-non-numeric", CAMPAIGN);
    expect(path.request.path).toBe("/2/tweets/search");
    expect(sent.at(-1)!.headers.get("authorization")).toBe("Bearer lat_x_parent");
  });

  it("sends an enclave-safe probe for real when authorize reports an enclave filter as skipped", async () => {
    authorizeAnswer = { authorized: true, trace: [step("method_0", "method", "allow"), step("Custom policy", "custom_code", "skip")] };
    proxyAnswer = () => Response.json({ deniedBy: "Rust policy (on_request)", reason: "post lookups by numeric id only" }, { status: 403 });
    expect(await runProbe("x-non-numeric", CAMPAIGN)).toMatchObject({ outcome: "denied", status: 403, deniedBy: "Rust policy (on_request)" });
    expect(sent).toHaveLength(2);
    // Any other probe stays dry when authorize allows, even with an enclave filter skipped.
    sent = [];
    expect(await runProbe("judge-no-campaign", CAMPAIGN)).toMatchObject({ outcome: "would-allow" });
    expect(sent).toHaveLength(1);
    // And if the enclave lets it through, that is said plainly.
    proxyAnswer = () => Response.json({ errors: [] }, { status: 400 });
    expect(await runProbe("x-non-numeric", CAMPAIGN)).toMatchObject({ outcome: "allowed", status: 400 });
  });

  it("probes the parent latch even when the campaign has its own child", async () => {
    vi.stubEnv(`MERIT_JUDGE_LAT__${CAMPAIGN}`, "lat_judge_child");
    authorizeAnswer = { authorized: false, deniedBy: "payload_4", trace: [] };
    proxyAnswer = () => Response.json({ deniedBy: "payload_4", reason: "Only claude-haiku-5-5 allowed" }, { status: 403 });
    await runProbe("judge-wrong-model", CAMPAIGN);
    expect(sent.every((s) => s.headers.get("authorization") === "Bearer lat_judge_parent")).toBe(true);
    vi.stubEnv(`MERIT_JUDGE_LAT__${CAMPAIGN}`, "");
  });

  it("reports a real call that didn't match authorize", async () => {
    authorizeAnswer = { authorized: false, deniedBy: "x", trace: [] };
    proxyAnswer = () => Response.json({ ok: true }, { status: 200 });
    expect(await runProbe("judge-too-many-tokens", CAMPAIGN)).toMatchObject({ outcome: "unexpected", status: 200 });
  });
});

describe("pipeline snapshot", () => {
  it("reads the full trace with an allowed authorize and caches it for 6 hours", async () => {
    const db = await getDb();
    await db.delete(schema.latchSnapshots);
    authorizeAnswer = { authorized: true, trace: [step("rate_limit_0", "rate_limit", "allow", { limit: 20, windowSeconds: 60, keyBy: "latch", counting: "rolling", remaining: 3 }), step("header_requirement_5", "header_requirement", "allow")] };
    const t0 = new Date("2026-10-26T10:00:00Z");
    const first = await pipelineSnapshot(db, "merit-judge", CAMPAIGN, t0);
    expect(first?.trace.map((s) => s.filterName)).toEqual(["rate_limit_0", "header_requirement_5"]);
    expect((sent[0]!.body as { body: { metadata: unknown } }).body.metadata).toEqual({ user_id: "guardrails-snapshot" });
    await pipelineSnapshot(db, "merit-judge", CAMPAIGN, new Date(t0.getTime() + SNAPSHOT_TTL_MS - 1000));
    expect(sent).toHaveLength(1);
    await pipelineSnapshot(db, "merit-judge", CAMPAIGN, new Date(t0.getTime() + SNAPSHOT_TTL_MS + 1000));
    expect(sent).toHaveLength(2);
  });

  it("reads merit-x with a post Merit announced, so the custom_code filter lets it through", async () => {
    const db = await getDb();
    await db.delete(schema.latchSnapshots);
    authorizeAnswer = { authorized: true, trace: [] };
    await pipelineSnapshot(db, "merit-x", CAMPAIGN);
    const path = (sent[0]!.body as { path: string }).path;
    const id = path.split("/").pop()!;
    const [intent] = await db.select().from(schema.latchIntents).where((await import("drizzle-orm")).eq(schema.latchIntents.postId, id));
    expect(intent?.campaign).toBe(CAMPAIGN);
  });

  it("describes each filter from Latch's own metadata, without volatile counters", () => {
    expect(describeStep(step("r", "rate_limit", "allow", { limit: 10, windowSeconds: 86400, keyBy: "json_path", jsonPath: "$.metadata.user_id", counting: "fixed", remaining: 4 }))).toBe("10 per 86400s · json_path $.metadata.user_id · fixed");
    expect(describeStep(step("m", "method", "allow", { allowed: ["GET"] }))).toBe("allowed GET");
    expect(describeStep(step("h", "header_requirement", "allow", { remaining: 1 }))).toBe("");
  });
});
