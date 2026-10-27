import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { env } from "./env";
import { LATCH_PROXY, campaignHeaders, type LatchName } from "./latch";
import { recordIntent } from "./tweet-check";

/**
 * "Try a bad request" on the Guardrails page, and each latch's full pipeline.
 *
 * A probe first asks /latch-self/authorize, which runs the real pipeline without calling the upstream or using the
 * credential (a denied authorize takes no rate-limit slot). Only when Latch says deny is the same request sent to
 * /proxy, to show the real 403 and deniedBy; a request filter's deny never reaches Anthropic or X. When Latch would
 * allow it (the rule isn't installed yet), nothing is sent.
 */

export type TraceStep = { filterName: string; filterType: string; decision: string; reason?: string; metadata?: Record<string, unknown> };
type Authorize = { authorized?: boolean; deniedBy?: string; reason?: string; trace?: TraceStep[]; requestId?: string; error?: string };

export type ProbeKey = "judge-wrong-model" | "judge-too-many-tokens" | "judge-no-campaign" | "x-non-numeric" | "x-write";

type ProbeRequest = { latch: LatchName; method: string; path: string; headers: Record<string, string>; body?: unknown };

/**
 * `enclaveSafe`: when authorize reports an enclave filter (merit-x's Rust custom_code) as skipped, a probe that costs
 * nothing even if it went through (a lookup of a post id that can't exist) is sent for real.
 */
export const PROBES: Record<ProbeKey, { latch: LatchName; label: string; rule: string; step: string; enclaveSafe?: boolean }> = {
  "judge-wrong-model": { latch: "merit-judge", label: "Wrong model", rule: "payload: model must be claude-haiku-5-5", step: "already live" },
  "judge-too-many-tokens": { latch: "merit-judge", label: "Too many tokens", rule: "payload: max_tokens ≤ 2048", step: "already live" },
  "judge-no-campaign": { latch: "merit-judge", label: "Missing campaign header", rule: "header_requirement: X-Merit-Campaign (and Cedar: no anonymous caller)", step: "LATCH_PLUS A3–A4" },
  "x-non-numeric": { latch: "merit-x", label: "Non-numeric tweet path", rule: "custom_code (Rust, in the enclave): GET /2/tweets/<numeric id> only", step: "LATCH_PLUS A7", enclaveSafe: true },
  "x-write": { latch: "merit-x", label: "POST to X", rule: "method: GET only", step: "already live" },
};

const judgeBody = (o: { model?: string; max_tokens?: number } = {}) => ({
  model: o.model ?? "claude-haiku-5-5",
  max_tokens: o.max_tokens ?? 16,
  messages: [{ role: "user", content: "Merit Guardrails probe." }],
  metadata: { user_id: "guardrails-probe" },
});

function probeRequest(key: ProbeKey, campaign: string): ProbeRequest {
  const tagged = campaignHeaders(campaign);
  switch (key) {
    case "judge-wrong-model":
      return { latch: "merit-judge", method: "POST", path: "/v1/messages", headers: tagged, body: judgeBody({ model: "claude-opus-5-5" }) };
    case "judge-too-many-tokens":
      return { latch: "merit-judge", method: "POST", path: "/v1/messages", headers: tagged, body: judgeBody({ max_tokens: 8192 }) };
    case "judge-no-campaign":
      return { latch: "merit-judge", method: "POST", path: "/v1/messages", headers: {}, body: judgeBody() };
    case "x-non-numeric":
      // One path segment, so merit-x's endpoint filter (/2/tweets/*) lets it past and the custom_code filter is what
      // denies it. /2/tweets/search/recent would be stopped earlier, by the endpoint filter.
      return { latch: "merit-x", method: "GET", path: "/2/tweets/search", headers: tagged };
    case "x-write":
      return { latch: "merit-x", method: "POST", path: "/2/tweets", headers: tagged, body: { text: "Merit Guardrails probe" } };
  }
}

/** Probes and pipeline reads use the parent latches, merit-judge and merit-x, whose cards they illustrate. */
const parentToken = (latch: LatchName) => (latch === "merit-judge" ? env.judgeLat() : env.xLat());

/** Header names are sent lowercase, as real requests arrive. */
const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

async function authorize(token: string, r: ProbeRequest): Promise<Authorize> {
  const response = await fetch(`${LATCH_PROXY}/.well-known/latch-self/authorize`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ method: r.method, path: r.path, headers: lower(r.headers), ...(r.body === undefined ? {} : { body: r.body }) }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Authorize;
  if (!response.ok) return { error: body.error ?? `authorize answered ${response.status}` };
  return body;
}

export type ProbeResult = {
  key: ProbeKey;
  latch: LatchName;
  request: { method: string; path: string; campaignHeader: boolean };
  /**
   * "denied": Latch refused the real request. "would-allow": the rule isn't installed, nothing was sent.
   * "allowed": an enclave-safe probe was sent because authorize skipped an enclave filter, and it went through.
   */
  outcome: "denied" | "would-allow" | "allowed" | "unexpected" | "error";
  status?: number;
  deniedBy?: string;
  reason?: string;
  requestId?: string;
  trace: TraceStep[];
};

export async function runProbe(key: ProbeKey, campaign: string): Promise<ProbeResult> {
  const r = probeRequest(key, campaign);
  const token = parentToken(r.latch);
  const base = { key, latch: r.latch, request: { method: r.method, path: r.path, campaignHeader: "X-Merit-Campaign" in r.headers } };
  const decision = await authorize(token, r);
  if (decision.error) return { ...base, outcome: "error", reason: decision.error, trace: [] };
  const trace = decision.trace ?? [];
  const enclaveSkipped = trace.some((s) => s.decision === "skip" && (s.filterType === "custom_code" || s.filterType === "cedar"));
  if (decision.authorized && !(PROBES[key].enclaveSafe && enclaveSkipped)) return { ...base, outcome: "would-allow", trace };
  // Latch says deny (or can't tell, for an enclave filter): send it for real to show the 403 itself.
  const response = await fetch(`${LATCH_PROXY}${r.path}`, {
    method: r.method,
    headers: { authorization: `Bearer ${token}`, ...r.headers, ...(r.body === undefined ? {} : { "content-type": "application/json" }) },
    body: r.body === undefined ? undefined : JSON.stringify(r.body),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { deniedBy?: string; reason?: string; requestId?: string };
  const denied = (response.status === 403 || response.status === 429) && typeof body.deniedBy === "string";
  if (!denied && decision.authorized) return { ...base, outcome: "allowed", status: response.status, reason: "The enclave filter let it through.", trace };
  return {
    ...base,
    outcome: denied ? "denied" : "unexpected",
    status: response.status,
    deniedBy: body.deniedBy,
    reason: denied ? body.reason : `Latch answered ${response.status} on the real call after denying it on authorize (the pipeline changed in between?)`,
    requestId: body.requestId ?? response.headers.get("x-latch-request-id") ?? undefined,
    trace,
  };
}

/** The campaign the probes and snapshots name: the most recently updated active program with a campaign. */
export async function liveCampaign(db: Db): Promise<string | null> {
  const [p] = await db
    .select({ address: schema.programs.campaignAddress })
    .from(schema.programs)
    .where(and(eq(schema.programs.status, "active"), isNotNull(schema.programs.campaignAddress)))
    .orderBy(desc(schema.programs.updatedAt))
    .limit(1);
  return p?.address ?? null;
}

export type Snapshot = { latch: LatchName; readAt: string; authorized: boolean; deniedBy?: string; reason?: string; trace: TraceStep[] };
export const SNAPSHOT_TTL_MS = 6 * 3_600_000;

/** A request each latch should allow: Merit's own judge call, and a read of a post Merit just announced. */
async function goodRequest(db: Db, latch: LatchName, campaign: string): Promise<ProbeRequest> {
  if (latch === "merit-judge") return { latch, method: "POST", path: "/v1/messages", headers: campaignHeaders(campaign), body: { ...judgeBody(), metadata: { user_id: "guardrails-snapshot" } } };
  const [s] = await db
    .select({ id: schema.submissions.resourceId })
    .from(schema.submissions)
    .where(eq(schema.submissions.sourceType, "x_post"))
    .orderBy(desc(schema.submissions.createdAt))
    .limit(1);
  const postId = s?.id ?? "2113550979329368489";
  await recordIntent(db, postId, campaign);
  return { latch, method: "GET", path: `/2/tweets/${postId}`, headers: campaignHeaders(campaign) };
}

/** Each latch's ordered pipeline, read at most every 6 hours (an allowed authorize spends a rate-limit slot). */
export async function pipelineSnapshot(db: Db, latch: LatchName, campaign: string, now = new Date()): Promise<Snapshot | null> {
  const [cached] = await db.select().from(schema.latchSnapshots).where(eq(schema.latchSnapshots.latch, latch)).limit(1);
  if (cached && now.getTime() - cached.readAt.getTime() < SNAPSHOT_TTL_MS) return cached.snapshotJson as Snapshot;
  const r = await goodRequest(db, latch, campaign);
  const d = await authorize(parentToken(latch), r);
  if (d.error) return (cached?.snapshotJson as Snapshot | undefined) ?? null;
  const snapshot: Snapshot = { latch, readAt: now.toISOString(), authorized: Boolean(d.authorized), deniedBy: d.deniedBy, reason: d.reason, trace: d.trace ?? [] };
  await db
    .insert(schema.latchSnapshots)
    .values({ latch, snapshotJson: snapshot, readAt: now })
    .onConflictDoUpdate({ target: schema.latchSnapshots.latch, set: { snapshotJson: snapshot, readAt: now } });
  return snapshot;
}
