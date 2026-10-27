import { describe, expect, it } from "vitest";
import vectors from "./vectors.json";
import { hex, unhex } from "@/lib/merit/codec";
import { ix } from "@/lib/merit/instructions";
import { ledgerSlug, payeeAddress, payeeSlug } from "@/lib/merit/pda";

const OWNER = "BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF";
const AGENT = "8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz";
const CONTRIBUTOR = "GZCkutEHercaeY728xVqiPTNSgGgAercDAb9JTXXnePN";
const CAMPAIGN = "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN";
const HASH = "fTzfxvv2a2TjbEFRfaDSKK8i8QrzCtvm3ispnZuhfZb";

const slug = unhex(vectors.slug);
const lslug = ledgerSlug(CAMPAIGN, 3n);
const X_USER = 1_658_044_857_343_000_579n;
const pslug = payeeSlug(CAMPAIGN, X_USER);
const PAYEE = payeeAddress(AGENT, CAMPAIGN, X_USER);

const built: Record<string, ReturnType<typeof ix.start>> = {
  create_campaign: ix.createCampaign(OWNER, slug, {
    agent: AGENT, rateKelvin: 100_000_000n, minScore: 50n, capPerPayout: 100_000_000n,
    capPerContributor: 200_000_000n, capPerRound: 500_000_000n, roundLengthMs: 300_000n, refundDeadlineMs: 1_792_829_402_922n,
  }),
  fund: ix.fund(OWNER, slug, 1_000_000_000n),
  fund_ops: ix.fundOps(OWNER, slug, 200_000_000n),
  start: ix.start(OWNER, slug),
  end: ix.end(OWNER, slug),
  withdraw: ix.withdraw(OWNER, slug, 942_000_000n),
  withdraw_ops: ix.withdrawOps(OWNER, slug, 165_289_520n),
  refund: ix.refund(OWNER, slug),
  resume: ix.resume(OWNER, slug),
  set_agent: ix.setAgent(OWNER, slug, CONTRIBUTOR),
  set_round_length: ix.setRoundLength(OWNER, slug, 600_000n),
  open_ledger: ix.openLedger(AGENT, lslug, CAMPAIGN, 3n, "00ff10ab"),
  approve: ix.approve(AGENT, lslug, {
    campaign: CAMPAIGN, contributor: CONTRIBUTOR, xUserId: 1_658_044_857_343_000_579n,
    postId: 2_113_550_979_329_368_489n, score: 58n, submissionHash: HASH, payee: PAYEE,
  }),
  retry_verify: ix.retryVerify(AGENT, lslug, CAMPAIGN, 1n),
  pause: ix.pause(OWNER, slug),
  unpause: ix.unpause(OWNER, slug),
  close_round: ix.closeRound(OWNER, slug),
  set_limits: ix.setLimits(OWNER, slug, { maxPerDay: 1_000_000_000n, approvalThreshold: 400_000_000n, cooldownMs: 3_600_000n, submitGraceMs: 300_000n }),
  approve_round: ix.approveRound(OWNER, slug),
  revoke: ix.revoke(AGENT, lslug, CAMPAIGN, 2n),
  open_payee: ix.openPayee(AGENT, pslug, CAMPAIGN, X_USER, CONTRIBUTOR),
  set_payee: ix.setPayee(AGENT, pslug, OWNER),
};

describe("instruction builders match the Rust builders Venus generates", () => {
  it("derives the ledger slug like merit_core::ledger_seed + Nonce", () => {
    expect(hex(lslug)).toBe(vectors.ledgerSlug);
  });
  it("derives the payee slug and address like merit_core::payee_seed", () => {
    expect(hex(pslug)).toBe(vectors.payeeSlug);
    expect(PAYEE).toBe(vectors.payee);
  });
  for (const expected of vectors.cases) {
    it(expected.name, () => {
      const actual = built[expected.name];
      expect(actual, `no TS builder for ${expected.name}`).toBeDefined();
      expect(actual.programId).toBe(expected.programId);
      expect(actual.accounts).toEqual(expected.accounts);
      expect(hex(actual.data)).toBe(expected.data);
    });
  }
});
