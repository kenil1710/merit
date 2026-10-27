// TEST ONLY. End-to-end tests can't sign in to X or post real X posts, so they set a contributor session and seed
// programs and submissions here. It answers 404 unless the server was started with MERIT_E2E=1 and isn't a
// production build (`next dev` for Playwright only); on Vercel NODE_ENV is always "production".

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashCanonical } from "@/lib/merit/judgement";
import { membership, publicProgram, upsertXUser } from "@/lib/server/contributors";
import { upsertWalletUser } from "@/lib/server/programs";
import { signRecord } from "@/lib/agent/record";
import { agentKeypair } from "@/lib/server/agent";
import { setOwnerSession, setSession } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { RULE_VERSION } from "@/lib/agent/engine";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";

export const runtime = "nodejs";

const enabled = () => process.env.MERIT_E2E === "1" && process.env.NODE_ENV !== "production";

type Body = Record<string, unknown> & { action: string };

export async function POST(request: NextRequest) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const b = (await request.json()) as Body;
  const db = await getDb();
  const str = (k: string) => String(b[k]);

  if (b.action === "session") {
    await upsertXUser(db, { xUserId: str("xUserId"), handle: str("username"), createdAt: new Date(str("createdAt")), followers: Number(b.followers) });
    await setSession(str("xUserId"), str("username"));
    return NextResponse.json({ ok: true });
  }

  if (b.action === "owner-session") {
    const owner = await upsertWalletUser(db, str("wallet"));
    await setOwnerSession(owner.id, str("wallet"));
    return NextResponse.json({ ok: true });
  }

  if (b.action === "program") {
    const owner = await upsertWalletUser(db, str("ownerWallet"));
    // Mirrors of the same real campaign in one test server: the newest mirror takes the (unique) address.
    if (b.campaignAddress) await db.update(schema.programs).set({ campaignAddress: null }).where(eq(schema.programs.campaignAddress, str("campaignAddress")));
    const [p] = await db
      .insert(schema.programs)
      .values({
        slug: str("slug"),
        name: str("name"),
        description: str("description"),
        ownerUserId: owner.id,
        ownerWallet: str("ownerWallet"),
        campaignAddress: (b.campaignAddress as string | undefined) ?? null,
        agentAddress: (b.agentAddress as string | undefined) ?? null,
        rubricJson: EXAMPLE_RUBRIC,
        ratePerPoint: BigInt(str("ratePerPoint")),
        limitsJson: { maxPerPayout: "100000000", maxPerContributor: "200000000", maxPerRound: "500000000", maxPerDay: "1000000000", autoApproveThreshold: "500000000", payeeCooldownSeconds: 0, maxAutoApproveItem: "100000000" },
        autoApproveConfidence: 0.8,
        minScore: 50,
        minAccountAgeDays: Number(b.minAccountAgeDays ?? 0),
        minXFollowers: Number(b.minXFollowers ?? 0),
        belowMinimum: (b.belowMinimum as "review" | "reject" | "block" | undefined) ?? "review",
        maxSubmissionsPerRound: 5,
        contextVersion: 1,
        roundLengthMinutes: Number(b.roundLengthMinutes ?? 5),
        firstRoundStartsAt: new Date(str("firstRoundStartsAt")),
        status: "active",
      })
      .onConflictDoNothing({ target: schema.programs.slug })
      .returning({ id: schema.programs.id });
    if (p) {
      await db.insert(schema.programMembers).values({ programId: p.id, userId: owner.id, role: "owner" });
      const about = str("about");
      await db.insert(schema.programContexts).values({ ownerUserId: owner.id, programId: p.id, version: 1, about, mustIncludeJson: (b.mustInclude as string[]) ?? [], inputHash: hashCanonical(about) });
    }
    const [row] = await db.select({ id: schema.programs.id }).from(schema.programs).where(eq(schema.programs.slug, str("slug")));
    return NextResponse.json({ ok: true, id: row?.id });
  }

  if (b.action === "submission") {
    const program = await publicProgram(db, str("slug"));
    if (!program) return NextResponse.json({ error: "no program" }, { status: 404 });
    let contributor = await membership(db, program.id, str("xUserId"));
    if (!contributor) {
      let [user] = await db.select().from(schema.users).where(eq(schema.users.xUserId, str("xUserId"))).limit(1);
      user ??= await upsertXUser(db, { xUserId: str("xUserId"), handle: String(b.username ?? `user${str("xUserId")}`), createdAt: new Date("2022-01-01"), followers: Number(b.followers ?? 100) });
      [contributor] = await db
        .insert(schema.contributors)
        .values({ programId: program.id, userId: user!.id, xUserId: str("xUserId"), xHandle: user!.xHandle ?? "", walletAddress: str("wallet"), walletVerifiedAt: new Date() })
        .returning();
    }
    // A real judgement from the store (its hash is the one on chain), or a decision record signed by the agent key.
    const stored = b.fromStore ? await store.judgement(str("postId")) : null;
    const status = str("status") as "approved" | "rejected" | "escalated";
    const action = status === "approved" ? "approve" : status === "escalated" ? "escalate" : "reject";
    const score = Number(b.score ?? 0);
    const amount = b.amount ? BigInt(str("amount")) : 0n;
    const flags = (b.flags as { code: string; severity: string; message: string }[] | undefined)?.map((f) => ({ ...f, evidence: {} })) ?? [];
    const llm = (b.llm as Record<string, unknown> | undefined) ?? null;
    const reasons = (b.reasons as string[] | undefined) ?? [];
    // The round it arrived in, as submitWork records it (default round 1).
    const window = { startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() - 86_000_000) };
    const [round] = await db
      .insert(schema.rounds)
      .values({ programId: program.id, number: Number(b.round ?? 1), ...window })
      .onConflictDoNothing({ target: [schema.rounds.programId, schema.rounds.number] })
      .returning({ id: schema.rounds.id });
    const roundId = round?.id ?? (await db.select({ id: schema.rounds.id }).from(schema.rounds).where(and(eq(schema.rounds.programId, program.id), eq(schema.rounds.number, Number(b.round ?? 1)))))[0]?.id;
    const [s] = await db
      .insert(schema.submissions)
      .values({
        programId: program.id,
        roundId,
        contributorId: contributor!.id,
        url: `https://x.com/${contributor!.xHandle}/status/${str("postId")}`,
        sourceType: "x_post",
        resourceId: str("postId"),
        status,
        amount: amount || null,
        approveSignature: stored?.approveSignature ?? null,
        processedAt: new Date(),
        createdAt: b.createdAt ? new Date(str("createdAt")) : new Date(),
      })
      .returning({ id: schema.submissions.id });
    const keypair = agentKeypair();
    const signed = stored
      ? null
      : signRecord(
          {
            schema: "merit.decision/v1",
            network: "rialo:devnet",
            campaign: program.campaignAddress ?? "",
            program: { id: program.id, slug: program.slug },
            submission: { id: s!.id, url: `https://x.com/${contributor!.xHandle}/status/${str("postId")}`, postId: str("postId"), submittedAt: new Date().toISOString() },
            contributor: { id: contributor!.id, xUserId: contributor!.xUserId, xHandle: contributor!.xHandle, wallet: contributor!.walletAddress },
            round: { number: Number(b.round ?? 1), startsAt: new Date().toISOString(), endsAt: new Date().toISOString() },
            contentHash: null,
            context: null,
            flags: flags as never,
            judgment: llm ? { model: "claude-haiku-5-5", promptVersion: "judge-v5-merit-json", output: llm } : null,
            ruleVersion: RULE_VERSION,
            rule: String(b.rule ?? "R10_AUTO_APPROVE"),
            decision: { action, categoryKey: "threads", points: null, score, amount: amount.toString(), auto: action !== "escalate" },
            decidedBy: { type: "agent" },
            summary: String(b.summary ?? reasons.join(" ")),
            decidedAt: new Date().toISOString(),
          },
          { address: keypair.publicKey.toString(), sign: (m) => keypair.sign(m).toBytes() },
        );
    const storedRecord = stored ? (JSON.parse(stored.canonical) as { score: number; reasons: string[] }) : null;
    // Another mirror in this test server may hold round 1's record already (its hash is unique).
    if (stored) await db.delete(schema.decisions).where(eq(schema.decisions.decisionHash, stored.submissionHash));
    await db.insert(schema.decisions).values({
      submissionId: s!.id,
      flagsJson: flags,
      llmOutputJson: llm ?? (storedRecord ? { reasons: storedRecord.reasons } : null),
      action,
      amount,
      score: storedRecord?.score ?? score,
      categoryKey: "threads",
      summary: String(b.summary ?? (storedRecord ? storedRecord.reasons.join(" ") : reasons.join(" "))),
      decisionJson: stored?.canonical ?? signed!.decisionJson,
      decisionHash: stored?.submissionHash ?? signed!.decisionHash,
      signature: signed?.signature ?? null,
      signerAddress: signed ? keypair.publicKey.toString() : null,
      model: llm ? "claude-haiku-5-5" : null,
      ruleVersion: RULE_VERSION,
      decidedBy: "agent",
    });
    if (b.appeal) {
      const [d] = await db.select({ hash: schema.decisions.decisionHash }).from(schema.decisions).where(eq(schema.decisions.submissionId, s!.id));
      await db.insert(schema.appeals).values({ submissionId: s!.id, contributorId: contributor!.id, programId: program.id, note: str("appeal"), decisionHash: d!.hash });
    }
    return NextResponse.json({ ok: true, submissionId: s!.id });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
