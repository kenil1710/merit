import { expect, test, type Page } from "@playwright/test";
import { Keypair } from "@rialo/ts-cdk";

// Owner review on an in-memory database. The queue runs on a program with no campaign yet (nothing on chain can
// expire it). A second program mirrors round 1 of the real campaign (G1Jj…, ended): its paid item carries the live REX
// proof and payout, and work still waiting from that round shows as Expired. Items are seeded with records signed by
// the agent key.

const SHOTS = "../../docs/screenshots";
const run = Date.now().toString(36);
const ROUND1 = { campaign: "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN", postId: "2113550979329368489", author: "1658044857343000579", handle: "KenilVekar1752", wallet: "GZCkutEHercaeY728xVqiPTNSgGgAercDAb9JTXXnePN" };
const OWNER = Keypair.generate().publicKey.toString();

async function fixture(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post("/api/test/fixture", { data: body });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id?: string };
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const llm = (scores: [number, number, number], confidence: number, reasons: string[]) => ({
  category: "threads",
  rubric_scores: { depth: scores[0], clarity: scores[1], accuracy: scores[2] },
  total_points: 7,
  quality_summary: reasons[0],
  reasons,
  soft_flags: [],
  confidence,
  recommended_action: "approve",
  relevance: "on_topic",
  fact_checks: [],
});

async function program(page: Page, slug: string, campaignAddress?: string) {
  const { id } = await fixture(page, {
    action: "program",
    slug,
    name: "Rialo in your own words",
    description: "Pays for original X threads that explain how Rialo works.",
    about: "Rialo programs run their own timers and read the web through REX.",
    ownerWallet: OWNER,
    campaignAddress,
    ratePerPoint: "10000000",
    firstRoundStartsAt: new Date(Date.now() - 86_400_000).toISOString(),
    minXFollowers: 50,
  });
  return `/app/programs/${id}`;
}

test("owner works the review queue: reasons, drawer with scores and record, decisions with reasons, bulk", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = `review-${run}`;
  await fixture(page, { action: "owner-session", wallet: OWNER });
  const base = await program(page, slug);
  const sub = (o: Record<string, unknown>) => fixture(page, { action: "submission", slug, ...o });
  await sub({
    xUserId: "880001", username: "ada_builds", wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000001", status: "escalated", rule: "R7_LOW_CONFIDENCE", score: 70, amount: "70000000",
    llm: llm([7, 7, 7], 0.62, ["Explains the AFTER timer with a concrete example.", "Skips how settlement orders payouts.", "Clear for newcomers."]),
    summary: "Escalated for review. The agent's confidence (62%) is below this program's auto-approval threshold. Explains the AFTER timer with a concrete example.",
  });
  await sub({
    xUserId: "880002", username: "newcomer_eve", followers: 12, wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000002", status: "escalated", rule: "R6_SOFT_FLAGS", score: 64, amount: "64000000",
    flags: [{ code: "LOW_FOLLOWERS", severity: "soft", message: "The account has 12 followers; this program reviews work from accounts under 50." }],
    llm: llm([6, 7, 6], 0.86, ["A fair summary of REX.", "No example."]),
    summary: "Escalated for review. The account has 12 followers; this program reviews work from accounts under 50.",
  });
  await sub({
    xUserId: "880003", username: "big_thread", wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000003", status: "escalated", rule: "R9C_NOT_ENOUGH_FUNDS", score: 90, amount: "90000000",
    llm: llm([9, 9, 9], 0.93, ["An excellent 8-post thread on Latch.", "Accurate throughout."]),
    summary: "Escalated for review. Not enough funds in the escrow: approving it would owe more than the escrow holds after the work already approved. The agent recommends 0.09 RLO.",
  });
  await sub({
    xUserId: "880004", username: "copycat_sam", wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000004", status: "rejected", rule: "R1_REJECT_FLAG",
    flags: [{ code: "NEAR_DUPLICATE", severity: "hard", message: "86% identical to a submission by @ada_builds on 2026-10-26." }],
    summary: "Rejected. 86% identical to a submission by @ada_builds on 2026-10-26. Recycled content isn't paid under this program's rules.",
    appeal: "I wrote this first, before Ada's thread; check the timestamps.",
  });

  await page.goto(`${base}/submissions`);
  await expect(page.getByRole("heading", { name: "Submissions", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("review-row")).toHaveCount(4);
  await expect(page.getByTestId("review-badge")).toHaveText("4");
  await expect(page.getByTestId("account-role")).toHaveText("Owner");
  await shot(page, "review-all");

  // The queue, by reason.
  await page.goto(`${base}/submissions?tab=review`);
  const reasons = page.getByTestId("queue-reasons");
  await expect(reasons).toBeVisible({ timeout: 30_000 });
  for (const r of ["Low confidence", "Below minimums", "Over budget", "Second look"]) await expect(reasons.getByRole("link", { name: new RegExp(r) })).toBeVisible();
  await shot(page, "review-queue");

  // Low confidence: scores, reasons, the signed record; rejecting with a reason.
  const drawer = page.getByTestId("review-drawer");
  await page.getByTestId("review-row").filter({ hasText: "Low confidence" }).click();
  await expect(drawer.getByTestId("scores")).toContainText("Confidence 62%", { timeout: 30_000 });
  await expect(drawer.getByTestId("signed-record")).toContainText("signature verified");
  await expect(drawer.getByLabel("Amount (RLO)")).toHaveValue("0.07");
  await drawer.getByLabel("Reason").fill("Good example, but it skips how settlement orders payouts.");
  await page.screenshot({ path: `${SHOTS}/review-drawer.png` });
  await drawer.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Reject" }).click();
  await expect(drawer.getByTestId("history")).toContainText("human · reject", { timeout: 30_000 });
  await expect(drawer.getByTestId("drawer-summary")).toContainText("Rejected by the team");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // The second look: the appeal is in the drawer.
  await page.getByTestId("review-row").filter({ hasText: "@copycat_sam" }).click();
  await expect(drawer.getByTestId("appeal-notice")).toContainText("I wrote this first", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Bulk: reject the two left in the queue with one reason.
  await page.goto(`${base}/submissions?tab=review`);
  for (const h of ["newcomer_eve", "big_thread"]) await page.getByLabel(`Select submission by @${h}`).check();
  await page.getByLabel("Reason for all selected").fill("Out of budget this round; please resubmit next round.");
  await shot(page, "review-bulk");
  await page.getByRole("button", { name: "Reject selected" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject all" }).click();
  await expect(page.getByText("Rejected 2 submissions")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${base}/submissions?tab=rejected`);
  await expect(page.getByTestId("review-row")).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByTestId("review-row").filter({ hasText: "Team decision" })).toHaveCount(3);

  // What's left needs the owner: the second look, in the bell.
  await page.goto(base);
  await page.getByRole("button", { name: /Needs you: [1-9]/ }).first().click();
  await expect(page.getByRole("menuitem", { name: /1 submission needs your review/ })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/review-needs-bell.png` });
});

test("work waiting from a closed round is Expired: out of the queue, can't be approved, can be rejected", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = `expired-${run}`;
  await fixture(page, { action: "owner-session", wallet: OWNER });
  const base = await program(page, slug, ROUND1.campaign);
  const sub = (o: Record<string, unknown>) => fixture(page, { action: "submission", slug, ...o });
  await sub({ xUserId: ROUND1.author, username: ROUND1.handle, wallet: ROUND1.wallet, postId: ROUND1.postId, status: "approved", fromStore: true, createdAt: "2026-10-23T08:39:00Z" });
  await sub({
    xUserId: "880011", username: "late_lin", wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000011", status: "escalated", rule: "R7_LOW_CONFIDENCE", score: 68, amount: "68000000", round: 1,
    llm: llm([7, 7, 6], 0.6, ["A clear take on Latch budgets.", "Thin on examples."]),
    summary: "Escalated for review. The agent's confidence (60%) is below this program's auto-approval threshold.",
  });

  // The paid item: reconciled from the chain, with its live REX proof.
  await page.goto(`${base}/submissions?tab=paid`);
  await expect(page.getByTestId("review-row")).toHaveCount(1, { timeout: 60_000 });
  const drawer = page.getByTestId("review-drawer");
  await page.getByTestId("review-row").first().click();
  await expect(drawer.getByTestId("rex-proof")).toContainText("Unanimous", { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/review-drawer-paid.png` });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Round 1 ended long ago: nothing needs review, the escalated item is Expired.
  await expect(page.getByRole("link", { name: /^Needs review 0/ })).toBeVisible();
  await expect(page.getByTestId("review-badge")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Expired \(round closed\) 1/ })).toBeVisible();
  await page.goto(`${base}/submissions?tab=expired`);
  await expect(page.getByTestId("review-row")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("review-row")).toContainText("Round 1 closed before anyone decided");
  await shot(page, "review-expired");
  await page.getByTestId("review-row").first().click();
  await expect(drawer.getByTestId("expired-note")).toContainText("round 1 closed before anyone decided", { timeout: 30_000 });
  await expect(drawer.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/review-drawer-expired.png` });
  await drawer.getByLabel("Reason").fill("Its round closed before we got to it; sorry.");
  await drawer.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Reject" }).click();
  await expect(drawer.getByTestId("history")).toContainText("human · reject", { timeout: 30_000 });
});
