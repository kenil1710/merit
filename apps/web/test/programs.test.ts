// Programs and members APIs: drafts, membership, campaign recording and publish checked against chain state.

import { Keypair } from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hex } from "@/lib/merit/codec";
import { workflowAddress } from "@/lib/merit/pda";
import type { MeritState } from "@/lib/merit/state";
import { CookieJar, params, request } from "./support/routes";
import { programPayload } from "./support/program";

const h = vi.hoisted(() => ({ jar: null as unknown as CookieJar, chain: new Map<string, unknown>() }));
vi.mock("next/headers", () => ({ cookies: async () => h.jar }));
vi.mock(import("@/lib/merit/chain"), async (original) => ({
  ...(await original()),
  loadState: async (_rpc: unknown, address: string) => (h.chain.get(address) as MeritState | undefined) ?? null,
}));
const agent = Keypair.generate();
vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_SESSION_SECRET", "test-session-secret-at-least-32-characters");
vi.stubEnv("MERIT_AGENT_SECRET_KEY", base58.encode(agent.secretKeyBytes()));

const { getDb, schema } = await import("@/lib/db");
const { setOwnerSession } = await import("@/lib/server/session");
const { upsertWalletUser } = await import("@/lib/server/programs");
const programsRoute = await import("@/app/api/owner/programs/route");
const programRoute = await import("@/app/api/owner/programs/[id]/route");
const campaignRoute = await import("@/app/api/owner/programs/[id]/campaign/route");
const publishRoute = await import("@/app/api/owner/programs/[id]/publish/route");
const membersRoute = await import("@/app/api/owner/programs/[id]/members/route");
const memberRoute = await import("@/app/api/owner/programs/[id]/members/[userId]/route");

async function as(k: Keypair) {
  h.jar = new CookieJar();
  const user = await upsertWalletUser(await getDb(), k.publicKey.toString());
  await setOwnerSession(user.id, k.publicKey.toString());
  return user;
}

async function create(slug: string, start?: Date) {
  const res = await programsRoute.POST(request("/api/owner/programs", { body: programPayload({ slug, start }) }));
  return { status: res.status, body: (await res.json()) as { programId: string; error?: string; fieldErrors?: Record<string, string> } };
}

/** The campaign the chain would hold after create_campaign with the server's config, then fund and start. */
function chainCampaign(address: string, owner: string, config: Record<string, string>, over: Partial<MeritState> = {}): MeritState {
  return {
    address, kind: 1n, owner, agent: config.agent, rateKelvin: BigInt(config.rateKelvin), minScore: BigInt(config.minScore),
    capPerPayout: BigInt(config.capPerPayout), capPerContributor: BigInt(config.capPerContributor), capPerRound: BigInt(config.capPerRound),
    roundLengthMs: BigInt(config.roundLengthMs), phase: 1n, ending: false, totalFunded: 200_000_000n, escrowKelvin: 200_000_000n, round: 1n,
    ...over,
  } as MeritState;
}

const owner = Keypair.generate();

beforeEach(() => h.chain.clear());

describe("programs", () => {
  it("needs an owner session", async () => {
    h.jar = new CookieJar();
    expect((await programsRoute.GET()).status).toBe(401);
    expect((await programsRoute.POST(request("/api/owner/programs", { body: programPayload() }))).status).toBe(401);
  });

  it("saves a valid draft with its owner, context and audit event, and lists it", async () => {
    const user = await as(owner);
    const { status, body } = await create("draft-one");
    expect(status).toBe(201);
    const db = await getDb();
    const [p] = await db.select().from(schema.programs).where((await import("drizzle-orm")).eq(schema.programs.id, body.programId));
    expect(p).toMatchObject({ status: "draft", ownerWallet: owner.publicKey.toString(), ratePerPoint: 1_000_000n, roundLengthMinutes: 5, minXFollowers: 10, belowMinimum: "review", plannedEscrow: 200_000_000n });
    expect(p!.limitsJson).toMatchObject({ maxPerPayout: "10000000", maxPerContributor: "20000000", payeeCooldownSeconds: 86_400 });
    const list = (await (await programsRoute.GET()).json()) as { programs: { id: string; role: string }[] };
    expect(list.programs.map((x) => [x.id, x.role])).toContainEqual([body.programId, "owner"]);
    const detail = (await (await programRoute.GET(request(`/api/owner/programs/${body.programId}`), params({ id: body.programId }))).json()) as { context: { version: number; mustIncludeJson: string[] } };
    expect(detail.context).toMatchObject({ version: 1, mustIncludeJson: ["@RialoHQ"] });
    const events = await db.select().from(schema.auditEvents);
    expect(events.some((e) => e.action === "program.created" && e.actor === `user:${user.id}`)).toBe(true);
  });

  it("reports field errors and a taken join link", async () => {
    await as(owner);
    const bad = programPayload({ slug: "bad-one" });
    bad.limits.maxPerPayout = "0.001"; // a perfect item (10 points × 0.001) no longer fits one payout
    const res = await programsRoute.POST(request("/api/owner/programs", { body: bad }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty("limits.maxPerPayout");
    await create("taken-link");
    const again = await create("taken-link");
    expect(again.status).toBe(409);
    expect(again.body.fieldErrors).toEqual({ "basics.slug": "Already taken" });
  });

  it("hides a program from non-members", async () => {
    await as(owner);
    const { body } = await create("private-one");
    await as(Keypair.generate());
    expect((await programRoute.GET(request(`/api/owner/programs/${body.programId}`), params({ id: body.programId }))).status).toBe(404);
    expect((await programRoute.GET(request("/api/owner/programs/nope"), params({ id: "nope" }))).status).toBe(404);
  });
});

describe("campaign and publish", () => {
  it("records the campaign address from the owner's wallet and hands back the config to sign", async () => {
    await as(owner);
    const { body } = await create("chain-one");
    const slug = hex(crypto.getRandomValues(new Uint8Array(32)));
    const res = await campaignRoute.POST(request(`/api/owner/programs/${body.programId}/campaign`, { body: { slugHex: slug } }), params({ id: body.programId }));
    const out = (await res.json()) as { campaignAddress: string; config: Record<string, string> };
    expect(res.status).toBe(200);
    expect(out.campaignAddress).toBe(workflowAddress(owner.publicKey.toString(), Buffer.from(slug, "hex")));
    // rate for a score of 100 = max points (10) × 0.001 RLO; caps from the limits; round length in ms.
    expect(out.config).toMatchObject({ agent: agent.publicKey.toString(), rateKelvin: "10000000", minScore: "50", capPerPayout: "10000000", capPerContributor: "20000000", capPerRound: "50000000", roundLengthMs: "300000" });
  });

  it("publishes only when the chain matches: created, same rules, funded, round open", async () => {
    await as(owner);
    const { body } = await create("publish-one");
    const id = body.programId;
    const publish = async () => {
      const res = await publishRoute.POST(request(`/api/owner/programs/${id}/publish`, { body: {} }), params({ id }));
      return { status: res.status, ...((await res.json()) as { ok?: boolean; error?: string }) };
    };
    expect(await publish()).toMatchObject({ status: 409, error: "Create the campaign on Rialo first." });
    const slug = hex(crypto.getRandomValues(new Uint8Array(32)));
    const rec = (await (await campaignRoute.POST(request(`/api/owner/programs/${id}/campaign`, { body: { slugHex: slug } }), params({ id }))).json()) as { campaignAddress: string; config: Record<string, string> };
    const at = rec.campaignAddress;
    expect(await publish()).toMatchObject({ error: "The campaign isn't on Rialo yet." });
    h.chain.set(at, chainCampaign(at, Keypair.generate().publicKey.toString(), rec.config));
    expect(await publish()).toMatchObject({ error: "The campaign on chain belongs to another wallet." });
    h.chain.set(at, chainCampaign(at, owner.publicKey.toString(), rec.config, { capPerRound: 1n }));
    expect(await publish()).toMatchObject({ error: "The campaign on chain doesn't match this program's rules." });
    h.chain.set(at, chainCampaign(at, owner.publicKey.toString(), rec.config, { totalFunded: 0n }));
    expect(await publish()).toMatchObject({ error: "Fund the escrow first." });
    h.chain.set(at, chainCampaign(at, owner.publicKey.toString(), rec.config, { round: 0n, phase: 0n }));
    expect(await publish()).toMatchObject({ error: "Open round 1 first." });
    // Once something exists at the recorded address, it can't be swapped for another.
    const swap = await campaignRoute.POST(request(`/api/owner/programs/${id}/campaign`, { body: { slugHex: "0".repeat(64) } }), params({ id }));
    expect(swap.status).toBe(409);
    h.chain.set(at, chainCampaign(at, owner.publicKey.toString(), rec.config));
    expect(await publish()).toMatchObject({ status: 200, ok: true });
    const detail = (await (await programRoute.GET(request(`/api/owner/programs/${id}`), params({ id }))).json()) as { program: { status: string } };
    expect(detail.program.status).toBe("active");
    // Published: the campaign can no longer be re-recorded.
    expect((await campaignRoute.POST(request(`/api/owner/programs/${id}/campaign`, { body: { slugHex: slug } }), params({ id }))).status).toBe(409);
  });

  it("publishes a scheduled program before round 1 opens", async () => {
    await as(owner);
    const { body } = await create("later-one", new Date(Date.now() + 86_400_000));
    const id = body.programId;
    const rec = (await (await campaignRoute.POST(request(`/api/owner/programs/${id}/campaign`, { body: { slugHex: hex(crypto.getRandomValues(new Uint8Array(32))) } }), params({ id }))).json()) as { campaignAddress: string; config: Record<string, string> };
    h.chain.set(rec.campaignAddress, chainCampaign(rec.campaignAddress, owner.publicKey.toString(), rec.config, { round: 0n, phase: 0n }));
    expect((await publishRoute.POST(request(`/api/owner/programs/${id}/publish`, { body: {} }), params({ id }))).status).toBe(200);
  });
});

describe("members", () => {
  it("lets the owner add and remove reviewers; reviewers see the program but can't manage it", async () => {
    await as(owner);
    const { body } = await create("team-one");
    const id = body.programId;
    const reviewer = Keypair.generate();
    const add = await membersRoute.POST(request(`/api/owner/programs/${id}/members`, { body: { wallet: reviewer.publicKey.toString() } }), params({ id }));
    expect(add.status).toBe(201);
    const { userId } = (await add.json()) as { userId: string };
    expect((await membersRoute.POST(request(`/api/owner/programs/${id}/members`, { body: { wallet: reviewer.publicKey.toString() } }), params({ id }))).status).toBe(409);
    expect((await membersRoute.POST(request(`/api/owner/programs/${id}/members`, { body: { wallet: owner.publicKey.toString() } }), params({ id }))).status).toBe(409);
    expect((await membersRoute.POST(request(`/api/owner/programs/${id}/members`, { body: { wallet: "nope" } }), params({ id }))).status).toBe(400);
    const members = (await (await membersRoute.GET(request(`/api/owner/programs/${id}/members`), params({ id }))).json()) as { members: { role: string }[] };
    expect(members.members.map((m) => m.role)).toEqual(["owner", "reviewer"]);

    const ownerUser = await upsertWalletUser(await getDb(), owner.publicKey.toString());
    await as(reviewer);
    const seen = (await (await programRoute.GET(request(`/api/owner/programs/${id}`), params({ id }))).json()) as { role: string };
    expect(seen.role).toBe("reviewer");
    expect((await membersRoute.POST(request(`/api/owner/programs/${id}/members`, { body: { wallet: Keypair.generate().publicKey.toString() } }), params({ id }))).status).toBe(404);
    expect((await memberRoute.DELETE(request(`/api/owner/programs/${id}/members/${ownerUser.id}`, { method: "DELETE" }), params({ id, userId: ownerUser.id }))).status).toBe(404);
    expect((await campaignRoute.POST(request(`/api/owner/programs/${id}/campaign`, { body: { slugHex: "1".repeat(64) } }), params({ id }))).status).toBe(403);
    expect((await publishRoute.POST(request(`/api/owner/programs/${id}/publish`, { body: {} }), params({ id }))).status).toBe(403);

    await as(owner);
    expect((await memberRoute.DELETE(request(`/api/owner/programs/${id}/members/${ownerUser.id}`, { method: "DELETE" }), params({ id, userId: ownerUser.id }))).status).toBe(409);
    expect((await memberRoute.DELETE(request(`/api/owner/programs/${id}/members/${userId}`, { method: "DELETE" }), params({ id, userId }))).status).toBe(200);
    await as(reviewer);
    expect((await programRoute.GET(request(`/api/owner/programs/${id}`), params({ id }))).status).toBe(404);
  });
});
