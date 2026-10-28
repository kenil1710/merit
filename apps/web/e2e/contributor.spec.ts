import { expect, test, type Page } from "@playwright/test";
import { Keypair } from "@rialo/ts-cdk";

// The contributor side on an in-memory database. X sign-in can't be automated, so the test-only fixture route sets
// the contributor session and seeds programs; everything on chain is real DevNet. The proof scenario mirrors round 1
// of the real campaign (G1Jj…), so the REX report and payout shown are the live ones.

const SHOTS = "../../docs/screenshots";
const run = Date.now().toString(36);
const ROUND1 = { campaign: "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN", postId: "2113550979329368489", author: "1658044857343000579", handle: "KenilVekar1752", wallet: "GZCkutEHercaeY728xVqiPTNSgGgAercDAb9JTXXnePN" };

async function fixture(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post("/api/test/fixture", { data: body });
  expect(res.ok(), await res.text()).toBe(true);
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const program = (slug: string, over: Record<string, unknown> = {}) => ({
  action: "program",
  slug,
  name: "Rialo in your own words",
  description: "Pays for original X threads that explain how Rialo works, in your own words.",
  about: "Rialo is a blockchain where programs run their own timers and read the web through REX. Explain one idea well.",
  mustInclude: ["@RialoHQ"],
  ownerWallet: Keypair.generate().publicKey.toString(),
  ratePerPoint: "1000000",
  firstRoundStartsAt: new Date(Date.now() - 86_400_000).toISOString(),
  ...over,
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("join page shows the minimums before sign-in, then joins with a wallet; a blocked account can't join", async ({ page }) => {
  const slug = `voices-${run}`;
  const blocked = `strict-${run}`;
  await fixture(page, program(slug, { minXFollowers: 50, minAccountAgeDays: 30, belowMinimum: "review" }));
  await fixture(page, program(blocked, { name: "Strict builders", minXFollowers: 50, minAccountAgeDays: 30, belowMinimum: "block" }));

  await page.goto(`/join/${slug}`);
  await expect(page.getByRole("heading", { name: "Rialo in your own words", level: 1 })).toBeVisible();
  await expect(page.getByTestId("rule-before-sign-in")).toHaveText("Submissions from X accounts with fewer than 50 followers or younger than 30 days are reviewed by the team before payment.");
  await expect(page.getByRole("link", { name: "Sign in with X" })).toHaveAttribute("href", `/api/auth/x/start?returnTo=${encodeURIComponent(`/join/${slug}`)}`);
  await shot(page, "join-signed-out");

  await fixture(page, { action: "session", xUserId: "777001", username: "merit_e2e", followers: 12, createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString() });
  await page.reload();
  await expect(page.getByTestId("account-numbers")).toContainText("12 followers · needs 50");
  await expect(page.getByText("Below this program's minimums")).toBeVisible();
  await shot(page, "join-below-minimum");

  await page.getByLabel("Choose a passphrase for a new wallet").fill("merit-e2e-contributor");
  await page.getByLabel("Confirm passphrase").fill("merit-e2e-contributor");
  await page.getByRole("button", { name: "Create wallet and join" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Your contributions/ })).toBeVisible();
  await expect(page.getByTestId("submissions-closed")).toContainText("No round is open right now.");
  await expect(page.getByText(/the team reviews your work before it's paid/)).toBeVisible();
  await shot(page, "contributor-joined");

  await page.goto(`/join/${slug}`);
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible();
  await page.goto("/c");
  await expect(page.getByTestId("joined").getByText("Rialo in your own words")).toBeVisible();
  await shot(page, "contributor-home");

  await page.goto(`/join/${blocked}`);
  await expect(page.getByTestId("account-numbers")).toContainText("You can't join with this account.");
  await expect(page.getByText("Joining needs an X account that meets the minimums above.")).toBeVisible();
  await expect(page.getByLabel(/passphrase/i)).toHaveCount(0);
  await shot(page, "join-blocked");

  await page.goto("/join");
  await expect(page.getByTestId("joinable").getByRole("link", { name: /Rialo in your own words/ })).toBeVisible();
});

test("contributor sees a paid submission with its live REX proof, and asks for a second look at a rejection", async ({ page }) => {
  const slug = `round-one-${run}`;
  await fixture(page, { action: "session", xUserId: ROUND1.author, username: ROUND1.handle, followers: 120, createdAt: "2023-01-01T00:00:00Z" });
  // Round 1's rate: 0.1 RLO for a score of 100, i.e. 0.01 RLO per point on the 10-point rubric.
  await fixture(page, program(slug, { campaignAddress: ROUND1.campaign, minXFollowers: 10, ratePerPoint: "10000000" }));
  await fixture(page, { action: "submission", slug, xUserId: ROUND1.author, wallet: ROUND1.wallet, postId: ROUND1.postId, status: "approved", fromStore: true, createdAt: "2026-10-23T08:39:00Z" });
  await fixture(page, {
    action: "submission",
    slug,
    xUserId: ROUND1.author,
    wallet: ROUND1.wallet,
    postId: "2113550979329368999",
    status: "rejected",
    score: 31,
    reasons: ["Restates the announcement without explaining anything.", "No example.", "Scored 31; this program pays from 50."],
  });

  await page.goto(`/c/${slug}`);
  await expect(page.getByRole("heading", { name: /Your contributions/ })).toBeVisible({ timeout: 60_000 });
  const paid = page.getByTestId("submission").filter({ hasText: ROUND1.postId });
  await expect(paid.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByTestId("submissions-closed")).toContainText("This campaign has ended.");
  await expect(page.getByTestId("rounds")).toContainText("Round 1");
  await paid.getByRole("button", { name: /Where it is, and the proof/ }).click();
  await expect(paid.getByTestId("rex-proof")).toContainText("Unanimous");
  await expect(paid.getByText("· matches the ledger ✓")).toBeVisible();
  await expect(paid.getByText("Payout")).toBeVisible();
  await shot(page, "contributor-program");

  const rejected = page.getByTestId("submission").filter({ hasText: "2113550979329368999" });
  await expect(rejected.getByText("Not approved")).toBeVisible();
  await rejected.getByRole("button", { name: "Ask for a second look" }).click();
  await rejected.getByLabel("Why should the team look again?").fill("The second post in the thread walks through a full example.");
  await rejected.getByRole("button", { name: "Send" }).click();
  await expect(rejected.getByTestId("appeal-sent")).toContainText("You asked for a second look");
  await expect(rejected.getByRole("button", { name: "Ask for a second look" })).toHaveCount(0);
  await rejected.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/contributor-appeal.png` });

  await page.goto(`/join/${slug}`);
  await expect(page.getByTestId("join-panel")).toContainText("Campaign ended");
  await expect(page.getByRole("link", { name: "See your contributions" })).toBeVisible();
});
