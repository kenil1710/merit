import { expect, test } from "@playwright/test";

// Real DevNet: creates an embedded wallet in the browser, takes 1 RLO from
// the faucet, creates and funds a campaign signed in the browser, opens round
// 1, then ends it and withdraws everything.

test("owner creates, funds, opens, ends and withdraws a campaign from the browser", async ({ page }) => {
  await page.goto("/owner");
  await page.getByPlaceholder("New passphrase (8+ characters)").fill("merit-e2e-passphrase");
  await page.getByRole("button", { name: "Create wallet" }).click();
  await expect(page.getByRole("button", { name: "Get 1 DevNet RLO" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Get 1 DevNet RLO" }).click();
  await expect(page.getByTestId("wallet-panel").getByText("1.0000")).toBeVisible({ timeout: 60_000 });

  const form = page.locator("section", { has: page.getByRole("heading", { name: "New campaign" }) });
  await expect(form).toBeVisible({ timeout: 30_000 });
  const name = `E2E ${new Date().toISOString().slice(0, 19)}`;
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Brief").fill("End-to-end test campaign created by Playwright on Rialo DevNet. Not for submissions.");
  await form.getByLabel("Score 100 pays (RLO)").fill("0.01");
  await form.getByLabel("Cap per payout (RLO)").fill("0.01");
  await form.getByLabel("Cap per contributor per round (RLO)").fill("0.02");
  await form.getByLabel("Cap per round (RLO)").fill("0.05");
  await form.getByLabel("Round length (minutes)").fill("1");
  await form.getByLabel("Initial escrow (RLO)").fill("0.2");
  await form.getByLabel("Operations budget (RLO)").fill("0.1");
  await form.getByRole("button", { name: "Create and fund" }).click();

  const log = page.locator("aside");
  for (const step of ["Create campaign", "Publish name and brief", "Fund escrow 0.2000 RLO", "Fund operations 0.1000 RLO", "Open round 1"]) {
    await expect(log.getByText(step)).toBeVisible({ timeout: 90_000 });
  }
  await expect(log.locator(".text-danger")).toHaveCount(0);
  await expect(log.getByText(/Merit round 1 open until/)).toBeVisible();

  const card = page.locator("section", { has: page.getByText("Round open") }).last();
  await expect(card.getByText(/verifications left/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "../../docs/screenshots/owner-dashboard.png", fullPage: true });
  await card.getByRole("button", { name: "End campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End campaign" }).click();
  await expect(log.getByText("End campaign")).toBeVisible({ timeout: 60_000 });

  // The open round (1 minute) still closes on its timer and settles before the campaign reads Ended: poll the chain
  // for that (up to 3 minutes), then reload once. Reloading on a fixed count raced the round close.
  const wallet = await page.evaluate(() => (JSON.parse(localStorage.getItem("merit.wallet.v1")!) as { address: string }).address);
  await expect
    .poll(
      async () => {
        const { campaigns } = (await (await page.request.get(`/api/owner?wallet=${wallet}`)).json()) as { campaigns: { name: string | null; phase: number }[] };
        return campaigns.find((c) => c.name === name)?.phase;
      },
      { timeout: 180_000, intervals: [5_000] },
    )
    .toBe(4);
  await page.reload();
  await page.getByPlaceholder("Passphrase to unlock").fill("merit-e2e-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  const ended = page.locator("section", { has: page.getByText("Ended") }).last();
  await expect(ended).toBeVisible({ timeout: 30_000 });
  await ended.getByLabel("Amount (RLO)").fill("0.2");
  await ended.getByRole("button", { name: /^Withdraw \(/ }).click();
  await expect(log.getByText("Withdraw escrow")).toBeVisible({ timeout: 60_000 });
  await ended.getByLabel("Amount (RLO)").fill("0.1");
  await ended.getByRole("button", { name: /^Withdraw ops/ }).click();
  await expect(log.getByText("Withdraw operations")).toBeVisible({ timeout: 60_000 });
  await expect(log.locator(".text-danger")).toHaveCount(0);
  await page.screenshot({ path: "../../.e2e-results/owner.png", fullPage: true });
});
