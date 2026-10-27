import { expect, test, type Page } from "@playwright/test";

// Real DevNet, in-memory database: an owner signs in with a new embedded wallet, walks the 5-step wizard, goes live
// (create campaign, sign name and brief, fund escrow and operations, open round 1, publish), lands in the owner shell,
// then ends the test campaign from /owner so it stops opening rounds.

const SHOTS = "../../docs/screenshots";
const PASS = "merit-e2e-passphrase";

/** Full-page shots from the top, so sticky headers sit where they belong. */
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  // A sticky action bar would be painted mid-page in a full-page capture: put it at the end for the shot.
  const style = await page.addStyleTag({ content: "[data-sticky-actions]{position:static!important}" });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  await style.evaluate((el) => (el as Element).remove());
}

test("owner signs in, creates a program in the wizard and takes it live on Rialo", async ({ page }) => {
  const name = `E2E Builders ${Date.now().toString(36)}`;
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Sign in to Merit" })).toBeVisible();
  await shot(page, "app-sign-in");
  await page.getByLabel("Choose a passphrase").fill(PASS);
  await page.getByRole("button", { name: "Create wallet and sign in" }).click();
  await expect(page.getByTestId("welcome")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("account-chip")).toContainText("Owner");
  await shot(page, "app-welcome");

  await page.getByRole("link", { name: "Create your first program" }).click();
  await expect(page.getByRole("heading", { name: /Name your program/ })).toBeVisible({ timeout: 30_000 });

  // 1. Basics
  await page.getByLabel("Program name").fill(name);
  await expect(page.locator("#slug")).toHaveValue(/^e2e-builders-/);
  await page.getByLabel("Description").fill("End-to-end test program: pays for original X threads about building on Rialo.");
  await shot(page, "wizard-1-basics");
  await page.getByRole("button", { name: "Continue" }).click();

  // 2. Context
  await expect(page.getByRole("heading", { name: /Brief the agent/ })).toBeVisible();
  await page.getByLabel("About this program").fill(
    "Rialo is a blockchain where programs run their own timers and read the web through REX. Post threads that explain how to build on it.",
  );
  await page.getByLabel("Links (optional)").fill("https://rialo.io\n@RialoHQ");
  await page.getByLabel("Posts must include (optional)").fill("@RialoHQ");
  await page.getByRole("button", { name: "Write it yourself" }).click();
  await page.getByLabel("Summary").fill("Threads that teach building on Rialo: timers, REX, Latch.");
  await page.getByLabel("Key facts the agent checks claims against").fill("Rialo programs schedule their own AFTER timers.\nREX validators fetch web data.");
  await shot(page, "wizard-2-context");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. Rubric (the starter category)
  await expect(page.getByRole("heading", { name: /What do you pay for/ })).toBeVisible();
  await expect(page.getByText(/A perfect thread or post \(10\/10\) earns/)).toBeVisible();
  await shot(page, "wizard-3-rubric");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. Budget and schedule, with X eligibility
  await expect(page.getByRole("heading", { name: /Pay, schedule and limits/ })).toBeVisible();
  await page.getByLabel("Minimum X followers").fill("10");
  await page.getByRole("radio", { name: "They can't join" }).click();
  await page.getByLabel("Escrow").fill("0.2");
  await page.getByLabel("Operations budget").fill("0.1");
  await shot(page, "wizard-4-budget");
  await page.getByRole("button", { name: "Continue" }).click();

  // 5. Review and go live
  await expect(page.getByRole("heading", { name: /Ready to go live/ })).toBeVisible();
  await expect(page.getByText("0.2 RLO escrow · 0.1 RLO operations budget")).toBeVisible();
  await shot(page, "wizard-5-review");
  await page.getByRole("button", { name: "Save and go live" }).click();
  const goLive = page.getByTestId("go-live");
  await expect(goLive).toBeVisible({ timeout: 30_000 });
  await goLive.getByRole("button", { name: "Get 1 DevNet RLO" }).click();
  await expect(goLive.getByText(/Wallet balance 1 RLO/)).toBeVisible({ timeout: 60_000 });
  await expect(goLive.getByRole("button", { name: "Sign and go live" })).toBeEnabled({ timeout: 60_000 });
  await goLive.getByRole("button", { name: "Sign and go live" }).click();
  await expect(page.getByRole("heading", { name: /You're live/ })).toBeVisible({ timeout: 240_000 });
  await expect(goLive.locator(".text-danger")).toHaveCount(0);
  await shot(page, "wizard-6-live");

  // The owner shell: program overview with its round pill, then all programs.
  await page.getByRole("link", { name: "Go to the program" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("round-pill").first()).toContainText(/Round 1 · closes in/);
  await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await shot(page, "app-program-overview");
  await page.getByRole("button", { name: "Switch program" }).click();
  await expect(page.getByRole("menuitem", { name: "New program" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/app-program-switcher.png` });
  await page.keyboard.press("Escape");
  await page.goto("/app/programs?status=live");
  await expect(page.getByTestId("program-card")).toHaveCount(1);
  await shot(page, "app-all-programs");

  // Clean up: end the campaign so DevNet stops opening rounds for it.
  await page.goto("/owner");
  await page.getByPlaceholder("Passphrase to unlock").fill(PASS);
  await page.getByRole("button", { name: "Unlock" }).click();
  const card = page.locator("section", { has: page.getByText(name) }).last();
  await expect(card.getByRole("button", { name: "End campaign" })).toBeEnabled({ timeout: 60_000 });
  await card.getByRole("button", { name: "End campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End campaign" }).click();
  await expect(page.locator("aside").getByText("End campaign")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("aside .text-danger")).toHaveCount(0);
});
