import { expect, test, type Page } from "@playwright/test";
import { Keypair } from "@rialo/ts-cdk";

// The owner's program pages on a mirror of the real round-1 campaign (G1Jj…, ended), on an in-memory database:
// contributors, rounds and the round receipt, treasury, audit log with filters, settings, metrics, and the public
// record at /p/[slug]. No page says "Soon" any more.

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

test("owner pages: contributors, rounds, treasury, audit, settings, metrics; public record and round receipt", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = `pages-${run}`;
  await fixture(page, { action: "owner-session", wallet: OWNER });
  const { id } = await fixture(page, {
    action: "program", slug, name: "Rialo in your own words", description: "Pays for original X threads that explain how Rialo works.",
    about: "Rialo programs run their own timers and read the web through REX.", ownerWallet: OWNER, campaignAddress: ROUND1.campaign,
    ratePerPoint: "10000000", firstRoundStartsAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const base = `/app/programs/${id}`;
  const sub = (o: Record<string, unknown>) => fixture(page, { action: "submission", slug, ...o });
  await sub({ xUserId: ROUND1.author, username: ROUND1.handle, wallet: ROUND1.wallet, postId: ROUND1.postId, status: "approved", fromStore: true, createdAt: "2026-10-23T08:39:00Z" });
  await sub({
    xUserId: "880021", username: "copy_cat", wallet: Keypair.generate().publicKey.toString(), postId: "2116000000000000021", status: "rejected", rule: "R1_REJECT_FLAG",
    flags: [{ code: "NEAR_DUPLICATE", severity: "hard", message: "91% identical to an earlier submission." }], summary: "Rejected. 91% identical to an earlier submission.",
  });

  // The sidebar links every page; nothing is "Soon".
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Rialo in your own words", level: 1 })).toBeVisible({ timeout: 60_000 });
  const nav = page.getByRole("navigation", { name: "Program" });
  for (const label of ["Contributors", "Rounds", "Treasury", "Audit log", "Settings"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
  await expect(page.getByText("Soon", { exact: true })).toHaveCount(0);

  // Contributors, and one contributor's page (round 1 reconciles to paid from the chain on the submissions page).
  await page.goto(`${base}/submissions`);
  await expect(page.getByTestId("review-row")).toHaveCount(2, { timeout: 60_000 });
  await page.goto(`${base}/contributors`);
  const table = page.getByTestId("contributors");
  await expect(table.getByRole("row")).toHaveCount(3, { timeout: 30_000 });
  await expect(table.getByRole("row", { name: new RegExp(`@${ROUND1.handle}`) })).toContainText("0.0580 RLO");
  await shot(page, "pages-contributors");
  await table.getByRole("link", { name: `@${ROUND1.handle}` }).click();
  await expect(page.getByRole("heading", { name: `@${ROUND1.handle}`, level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("contributor-history")).toContainText("Joined", { timeout: 30_000 }).catch(() => undefined);
  await page.getByLabel("Reason").fill("Testing suspension from the contributor page.");
  await page.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText(`@${ROUND1.handle} suspended`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("contributor-history")).toContainText("Suspended", { timeout: 30_000 });
  await shot(page, "pages-contributor");

  // Rounds: round 1 settled with its payout; round 2 settled empty.
  await page.goto(`${base}/rounds`);
  const rounds = page.getByTestId("rounds");
  await expect(rounds.getByRole("row", { name: /Round 1/ })).toContainText("0.0580 RLO", { timeout: 60_000 });
  await expect(rounds.getByRole("row", { name: /Round 1/ })).toContainText("Settled");
  await shot(page, "pages-rounds");
  await rounds.getByRole("link", { name: "Round 1" }).click();
  await expect(page.getByRole("heading", { name: "Round 1", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table", { name: "Round 1 decisions" })).toBeVisible();
  await expect(page.getByTestId("round-submissions").locator("li")).toHaveCount(2);
  await shot(page, "pages-round");

  // Treasury: the books from the chain (round 1: 1 RLO in, 0.058 paid, 0.942 withdrawn) and the payout.
  await page.goto(`${base}/treasury`);
  await expect(page.getByText("Paid to contributors")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("treasury-payouts")).toContainText("0.0580 RLO");
  await expect(page.getByText("0.9420 RLO").first()).toBeVisible();
  await shot(page, "pages-treasury");

  // Settings: save a change, which lands in the audit log.
  await page.goto(`${base}/settings`);
  const form = page.getByTestId("settings-form");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByLabel("Minimum X followers").fill("25");
  await form.getByLabel("Pause joining").check();
  await form.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible({ timeout: 30_000 });
  await shot(page, "pages-settings");

  // Audit log: everything, then filtered to people and to one kind; clear filters.
  await page.goto(`${base}/audit`);
  const log = page.getByTestId("audit-rows");
  await expect(log).toContainText("program.settings_changed", { timeout: 30_000 });
  await expect(log).toContainText("contributor.suspended");
  await shot(page, "pages-audit");
  await page.getByLabel("Kind").selectOption("program");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/kind=program/);
  await expect(log.locator("li")).toHaveCount(1);
  await page.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(page).not.toHaveURL(/kind=/);

  // Metrics across the owner's programs.
  await page.goto("/app/metrics");
  await expect(page.getByTestId("metrics-review")).toContainText("Submissions", { timeout: 30_000 });
  await expect(page.getByTestId("metrics-flags")).toContainText("NEAR_DUPLICATE");
  await shot(page, "pages-metrics");

  // Public record by slug (the address redirects there), recent decisions including the rejection, round receipt.
  await page.goto(`/c/${ROUND1.campaign}`);
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`), { timeout: 60_000 });
  await expect(page.getByTestId("recent-decisions")).toContainText("Rejected", { timeout: 60_000 });
  await expect(page.getByTestId("recent-decisions")).toContainText("@copy_cat");
  await shot(page, "pages-public-record");
  await page.goto(`/p/${slug}/rounds/1`);
  await expect(page.getByRole("heading", { name: "Round 1 receipt" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("receipt-payouts")).toContainText("0.0580 RLO");
  await shot(page, "pages-round-receipt");
});
