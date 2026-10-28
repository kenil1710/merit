import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The tester's second report: wallet management from the sidebar chip (create with confirm + strength, backup,
// forget, import), the wallet strip on /join and in the wizard, a Lock that really locks, live countdowns and the
// Security page. Runs against the local server (in-memory database) or the live site.

const PASS = "Correct horse battery 42!";

test("wallet panel: create on /join, back up, forget, import, then Lock really locks the owner app", async ({ page }) => {
  await page.goto("/join");
  const strip = page.getByTestId("wallet-strip");
  await expect(strip).toContainText("No wallet in this browser yet.");

  // Create from /join: confirm field and strength hint.
  await strip.getByRole("button", { name: "Create wallet" }).click();
  const sheet = page.getByTestId("wallet-sheet");
  await expect(sheet.getByRole("heading", { name: "Your Rialo wallet" })).toBeVisible();
  await sheet.getByLabel("Choose a passphrase").fill("abcdefgh");
  await expect(sheet.getByTestId("passphrase-strength")).toContainText("Weak.");
  await sheet.getByLabel("Choose a passphrase").fill(PASS);
  await expect(sheet.getByTestId("passphrase-strength")).toContainText("Strong.");
  await sheet.getByLabel("Confirm passphrase").fill(`${PASS}x`);
  await expect(sheet.getByText("The two passphrases don't match yet.")).toBeVisible();
  await sheet.getByLabel("Confirm passphrase").fill(PASS);
  await sheet.getByRole("button", { name: "Create wallet" }).click();

  // Address with copy, balance, faucet with its limit shown, unlocked.
  const address = (await sheet.getByTestId("wallet-address").textContent())!.trim();
  expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(sheet.getByRole("button", { name: "Copy address" })).toBeVisible();
  await expect(sheet.getByTestId("wallet-balance")).toHaveText(/\d/, { timeout: 30_000 });
  await expect(sheet.getByTestId("faucet-note")).toContainText(/1 RLO per wallet per day|Next faucet in/);
  await expect(sheet.getByRole("heading", { name: "Unlocked in this tab" })).toBeVisible();

  // Download the encrypted backup: the vault, no plain key.
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "Download encrypted backup" }).click()]);
  expect(download.suggestedFilename()).toBe(`merit-wallet-${address.slice(0, 8)}.json`);
  const backupPath = await download.path();
  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as Record<string, unknown>;
  expect(backup).toMatchObject({ format: "merit-wallet-backup", address, kdf: "PBKDF2-SHA256", cipher: "AES-GCM" });

  // Forget: big warning, backup offered first, must type FORGET.
  await sheet.getByRole("button", { name: "Forget this wallet…" }).click();
  const forget = sheet.getByTestId("forget-wallet");
  await expect(forget).toContainText("This deletes the wallet from this browser");
  await expect(forget.getByRole("button", { name: "Download encrypted backup" })).toBeVisible();
  await expect(forget.getByRole("button", { name: "Forget this wallet" })).toBeDisabled();
  await forget.getByLabel("2. Type FORGET to confirm").fill("forget");
  await expect(forget.getByRole("button", { name: "Forget this wallet" })).toBeDisabled();
  await forget.getByLabel("2. Type FORGET to confirm").fill("FORGET");
  await forget.getByRole("button", { name: "Forget this wallet" }).click();
  await expect(sheet.getByText("No wallet in this browser yet. Create one, or import an encrypted backup.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("merit.wallet.v1"))).toBeNull();

  // Import the backup: a wrong passphrase is refused, the right one restores the same address.
  await sheet.getByTestId("import-file").setInputFiles(backupPath);
  await sheet.getByLabel("Backup passphrase").fill("not the passphrase");
  await sheet.getByRole("button", { name: "Import", exact: true }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Wrong passphrase.");
  await sheet.getByLabel("Backup passphrase").fill(PASS);
  await sheet.getByRole("button", { name: "Import", exact: true }).click();
  await expect(sheet.getByTestId("wallet-address")).toHaveText(address);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wallet-chip")).toContainText(address.slice(0, 6));

  // Owner app: sign in with it, then Lock from the sidebar chip.
  await page.goto("/app");
  await page.getByLabel("Passphrase").fill(PASS);
  await page.getByRole("button", { name: "Unlock and sign in" }).click();
  await expect(page.getByTestId("account-chip")).toContainText("Owner · unlocked", { timeout: 30_000 });
  await page.getByTestId("account-chip").click();
  await expect(sheet.getByTestId("wallet-address")).toHaveText(address);
  await sheet.getByRole("button", { name: "Lock wallet" }).click();
  // The key is gone and the signed session ended: the sign-in screen asks for the passphrase, also after a reload.
  await expect(page.getByRole("heading", { name: "Sign in to Merit" })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to Merit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock and sign in" })).toBeVisible();
  expect(await (await page.request.get("/api/auth/owner/session")).json()).toEqual({ address: null });

  // Signed in again, the wizard shows the wallet's balance and faucet.
  await page.getByLabel("Passphrase").fill(PASS);
  await page.getByRole("button", { name: "Unlock and sign in" }).click();
  await expect(page.getByTestId("account-chip")).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/programs/new");
  await expect(page.getByTestId("wallet-strip")).toContainText(address.slice(0, 6));
  await expect(page.getByTestId("wallet-strip").getByRole("button", { name: "Get 1 DevNet RLO" })).toBeVisible();
});

test("Security page: honest about the reviews, linked from the footer and Guardrails", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByTestId("not-an-audit")).toContainText("This is not a professional third-party audit.");
  await expect(page.getByText(/fresh session that did not build or fix the code/)).toBeVisible();
  for (const [name, href] of [
    ["docs/AUDIT.md", /docs\/AUDIT\.md$/],
    ["docs/REAUDIT.md", /docs\/REAUDIT\.md$/],
    ["Evidence (EVIDENCE.md)", /docs\/EVIDENCE\.md#negative-tests/],
  ] as const) {
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await expect(page.getByText("sent · 29 rejected on chain · 1 no-op")).toBeVisible();
  await expect(page.getByTestId("finding-row").filter({ hasText: "H-1" })).toContainText("Fixed");
  await expect(page.getByTestId("finding-row").filter({ hasText: "M-3" })).toContainText("Fixed in part");
  await expect(page.getByRole("heading", { name: "Known limits" })).toBeVisible();

  await page.goto("/guardrails");
  await page.getByRole("main").getByRole("link", { name: "Security" }).first().click();
  await expect(page).toHaveURL(/\/security$/);
});

test("Explore: round labels are the shared ones and countdowns tick every second", async ({ page }) => {
  await page.goto("/explore");
  const cards = page.getByTestId("campaign-card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  for (const text of await cards.locator("span.rounded-md").first().allTextContents()) {
    expect(text).toMatch(/^(Open|Grace period|Settling|Ended|Not started|Paused)/);
  }
  const countdown = page.getByTestId("countdown").first();
  test.skip((await countdown.count()) === 0, "No campaign has a round due right now.");
  const before = await countdown.textContent();
  await page.waitForTimeout(2_200);
  expect(await countdown.textContent()).not.toBe(before);
});
