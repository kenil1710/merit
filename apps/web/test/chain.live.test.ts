// Reads real DevNet data (round 1 of the first real campaign). Run with
// MERIT_LIVE=1; skipped otherwise so `npm test` works offline.
import { describe, expect, it } from "vitest";
import { RpcClient, findLedger, listCampaigns, loadReport, loadState } from "@/lib/merit/chain";

const live = process.env.MERIT_LIVE === "1" ? describe : describe.skip;
const rpc = new RpcClient("https://devnet.rialo.io");

live("DevNet round 1", () => {
  it("decodes the campaign, its ledger and the REX report", async () => {
    const campaign = await loadState(rpc, "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN");
    expect(campaign?.totalPaid).toBe(58_000_000n);
    expect(campaign?.totalWithdrawn).toBe(942_000_000n);
    const ledger = await findLedger(rpc, campaign!, 1n);
    expect(ledger?.entries[0].postId).toBe(2_113_550_979_329_368_489n);
    expect(ledger?.entries[0].submissionHash).toBe("fTzfxvv2a2TjbEFRfaDSKK8i8QrzCtvm3ispnZuhfZb");
    const report = await loadReport(rpc, ledger!.entries[0].reportAccount);
    expect(report?.outputs).toHaveLength(4);
    for (const output of report!.outputs) {
      expect(output.payload).toBe("MX1|2113550979329368489|1658044857343000579|2026-10-23T08:39:56.000Z");
    }
  }, 30_000);

  it("discovers campaigns from the chain", async () => {
    const campaigns = await listCampaigns(rpc);
    expect(campaigns.map((c) => c.address)).toContain("G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN");
  }, 30_000);
});
