// Contributor side: minimums, joining with a signed wallet, the submit pipeline (X, judge and chain stubbed), appeals.

import { Keypair } from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { minimumRuleText, minimumStatus } from "@/lib/minimums";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";
import { CookieJar, request } from "./support/routes";

const h = vi.hoisted(() => ({ jar: null as unknown as CookieJar }));
vi.mock("next/headers", () => ({ cookies: async () => h.jar }));
vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_SESSION_SECRET", "test-session-secret-at-least-32-characters");

const { getDb, schema } = await import("@/lib/db");
const { setSession } = await import("@/lib/server/session");
const { upsertXUser, requestAppeal, membership } = await import("@/lib/server/contributors");
const { upsertWalletUser } = await import("@/lib/server/programs");
const challengeRoute = await import("@/app/api/contributor/wallet/challenge/route");
const joinRoute = await import("@/app/api/contributor/join/route");

const DAY = 86_400_000;
const NOW = Date.now();
const agent = Keypair.generate().publicKey.toString();
const owner = Keypair.generate().publicKey.toString();
let n = 0;

async function program(over: Partial<typeof schema.programs.$inferInsert> = {}) {
  const db = await getDb();
  const o = await upsertWalletUser(db, owner);
  const [p] = await db
    .insert(schema.programs)
    .values({
      slug: `prog-${++n}`,
      name: "Rialo Builders",
      description: "Pays for threads.",
      ownerUserId: o.id,
      ownerWallet: owner,
      campaignAddress: Keypair.generate().publicKey.toString(),
      agentAddress: agent,
      rubricJson: EXAMPLE_RUBRIC,
      ratePerPoint: 1_000_000n,
      limitsJson: { maxPerPayout: "1", maxPerContributor: "1", maxPerRound: "1", maxPerDay: "1", autoApproveThreshold: "1", payeeCooldownSeconds: 0, maxAutoApproveItem: "1" },
      autoApproveConfidence: 0.8,
      minAccountAgeDays: 30,
      minXFollowers: 10,
      belowMinimum: "review",
      maxSubmissionsPerRound: 2,
      roundLengthMinutes: 5,
      firstRoundStartsAt: new Date(NOW - DAY),
      status: "active",
      ...over,
    })
    .returning();
  return p!;
}

async function signIn(xUserId: string, followers: number, ageDays: number) {
  h.jar = new CookieJar();
  await upsertXUser(await getDb(), { xUserId, handle: `user${xUserId}`, createdAt: new Date(Date.now() - ageDays * DAY), followers });
  await setSession(xUserId, `user${xUserId}`);
}

async function join(slug: string, k = Keypair.generate()) {
  const wallet = k.publicKey.toString();
  const c = await challengeRoute.POST(request("/api/contributor/wallet/challenge", { body: { slug, wallet } }));
  const { nonce, message } = (await c.json()) as { nonce: string; message: string };
  const signature = base58.encode(k.sign(new TextEncoder().encode(message)).toBytes());
  const res = await joinRoute.POST(request("/api/contributor/join", { body: { slug, wallet, nonce, signature } }));
  return { res, body: (await res.json()) as { contributorId?: string; error?: string }, wallet, nonce, signature };
}

describe("minimums", () => {
  it("says what happens below the minimums, before and after sign-in", () => {
    const rules = { minXFollowers: 10, minAccountAgeDays: 30, belowMinimum: "block" as const };
    expect(minimumRuleText(rules)).toBe("X accounts with fewer than 10 followers or younger than 30 days can't join.");
    expect(minimumRuleText({ ...rules, belowMinimum: "review" })).toBe("Submissions from X accounts with fewer than 10 followers or younger than 30 days are reviewed by the team before payment.");
    const now = new Date(NOW);
    expect(minimumStatus(rules, { followers: 50, createdAt: new Date(NOW - 90 * DAY) }, now)).toMatchObject({ below: false, outcome: "ok" });
    const low = minimumStatus(rules, { followers: 3, createdAt: new Date(NOW - 90 * DAY) }, now);
    expect(low).toMatchObject({ below: true, outcome: "block" });
    expect(low.text).toContain("You can't join with this account.");
    // Unknown counts are never "below".
    expect(minimumStatus(rules, { followers: null, createdAt: null }, now).below).toBe(false);
    expect(minimumStatus({ minXFollowers: 0, minAccountAgeDays: 0, belowMinimum: "block" }, { followers: 0, createdAt: null }, now).applies).toBe(false);
  });
});

describe("joining", () => {
  it("joins with a signed wallet, once", async () => {
    const p = await program();
    await signIn("101", 50, 100);
    const { res, body, wallet, nonce, signature } = await join(p.slug);
    expect(res.status).toBe(201);
    const db = await getDb();
    expect(await membership(db, p.id, "101")).toMatchObject({ walletAddress: wallet, xHandle: "user101" });
    // The nonce is single-use.
    const replay = await joinRoute.POST(request("/api/contributor/join", { body: { slug: p.slug, wallet, nonce, signature } }));
    expect(replay.status).toBe(401);
    expect(body.contributorId).toBeTruthy();
  });

  it("refuses a signature from another wallet, and a nonce issued to another X account", async () => {
    const p = await program();
    await signIn("102", 50, 100);
    const wallet = Keypair.generate().publicKey.toString();
    const { nonce, message } = (await (await challengeRoute.POST(request("/api/contributor/wallet/challenge", { body: { slug: p.slug, wallet } }))).json()) as { nonce: string; message: string };
    const forged = base58.encode(Keypair.generate().sign(new TextEncoder().encode(message)).toBytes());
    expect((await joinRoute.POST(request("/api/contributor/join", { body: { slug: p.slug, wallet, nonce, signature: forged } }))).status).toBe(400);
    await signIn("103", 50, 100);
    const k = Keypair.generate();
    const other = message.replace("102", "103").replace("@user102", "@user103").replace(wallet, k.publicKey.toString());
    const sig = base58.encode(k.sign(new TextEncoder().encode(other)).toBytes());
    const res = await joinRoute.POST(request("/api/contributor/join", { body: { slug: p.slug, wallet: k.publicKey.toString(), nonce, signature: sig } }));
    expect(res.status).toBe(401);
  });

  it("applies the minimums: block refuses, review lets them in", async () => {
    const blocked = await program({ belowMinimum: "block" });
    await signIn("104", 3, 100);
    const { res, body } = await join(blocked.slug);
    expect(res.status).toBe(403);
    expect(body.error).toContain("can't join");
    const review = await program({ belowMinimum: "review" });
    expect((await join(review.slug)).res.status).toBe(201);
  });

  it("refuses paused, ended and draft programs, and signed-out callers", async () => {
    await signIn("105", 50, 100);
    expect((await join((await program({ joiningPaused: true })).slug)).res.status).toBe(409);
    expect((await join((await program({ endedAt: new Date() })).slug)).res.status).toBe(409);
    const draft = await program({ status: "draft" });
    expect((await challengeRoute.POST(request("/api/contributor/wallet/challenge", { body: { slug: draft.slug, wallet: owner } }))).status).toBe(404);
    h.jar = new CookieJar();
    expect((await challengeRoute.POST(request("/api/contributor/wallet/challenge", { body: { slug: "x", wallet: owner } }))).status).toBe(401);
  });
});

describe("appeals", () => {
  async function rejected(xUserId: string) {
    const p = await program();
    await signIn(xUserId, 50, 100);
    await join(p.slug);
    const db = await getDb();
    const c = (await membership(db, p.id, xUserId))!;
    const insert = async (status: "rejected" | "approved", i: number) => {
      const [s] = await db.insert(schema.submissions).values({ programId: p.id, contributorId: c.id, url: "u", sourceType: "x_post", resourceId: `${xUserId}${i}`, status }).returning();
      await db.insert(schema.decisions).values({ submissionId: s!.id, flagsJson: [], action: status === "approved" ? "approve" : "reject", summary: "s", decisionJson: "{}", decisionHash: `h-${xUserId}-${i}`, ruleVersion: "v", decidedBy: "agent" });
      return s!.id;
    };
    return { db, insert };
  }

  it("takes one second look per rejected submission, only from its contributor", async () => {
    const { db, insert } = await rejected("301");
    const id = await insert("rejected", 1);
    expect(await requestAppeal(db, { xUserId: "999", submissionId: id, note: "please" })).toMatchObject({ ok: false, status: 404 });
    expect(await requestAppeal(db, { xUserId: "301", submissionId: id, note: "please" })).toEqual({ ok: true });
    expect(await requestAppeal(db, { xUserId: "301", submissionId: id, note: "again" })).toMatchObject({ ok: false, status: 409 });
    const approved = await insert("approved", 2);
    expect(await requestAppeal(db, { xUserId: "301", submissionId: approved, note: "x" })).toMatchObject({ ok: false, status: 409 });
    const [a] = await db.select().from(schema.appeals).where(eq(schema.appeals.submissionId, id));
    expect(a).toMatchObject({ note: "please", decisionHash: "h-301-1" });
  });

  it("caps second looks at five a day", async () => {
    const { db, insert } = await rejected("302");
    for (let i = 0; i < 5; i++) expect(await requestAppeal(db, { xUserId: "302", submissionId: await insert("rejected", i), note: "n" })).toEqual({ ok: true });
    expect(await requestAppeal(db, { xUserId: "302", submissionId: await insert("rejected", 9), note: "n" })).toMatchObject({ ok: false, status: 429 });
  });
});

beforeEach(() => {
  h.jar = new CookieJar();
});
