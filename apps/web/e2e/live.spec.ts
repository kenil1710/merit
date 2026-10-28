import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import { expect, test } from "@playwright/test";

// Live only (MERIT_E2E_URL): the faucet's 1-per-wallet-per-day cooldown and "Read it"'s speed, on the real site.
// Each run spends one faucet grant from this network (3 a day) and one small judge call.

test.skip(!process.env.MERIT_E2E_URL, "Live checks run against the deployed site only.");

test("faucet: one grant per wallet per day, and the cooldown is shown", async ({ page }) => {
  // A fresh owner wallet, created in the browser: the faucet is in the wizard's wallet strip.
  await page.goto("/app");
  await page.getByLabel("Choose a passphrase").fill("Merit live e2e 42!");
  await page.getByLabel("Confirm passphrase").fill("Merit live e2e 42!");
  await page.getByRole("button", { name: "Create wallet and sign in" }).click();
  await expect(page.getByTestId("account-chip")).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/programs/new");
  const strip = page.getByTestId("wallet-strip");
  await expect(strip.getByTestId("faucet-note")).toHaveText("1 RLO per wallet per day", { timeout: 30_000 });
  await strip.getByRole("button", { name: "Get 1 DevNet RLO" }).click();
  await expect(page.getByText("1 DevNet RLO received")).toBeVisible({ timeout: 90_000 });
  await expect(strip.getByTestId("strip-balance")).toHaveText(/^1\.0+ RLO$/, { timeout: 30_000 });
  // Cooldown: the button is off and says when; the relay refuses a second grant.
  await expect(strip.getByTestId("faucet-note")).toHaveText(/Next faucet in (24|23) h|Holds 1 RLO already/);
  await expect(strip.getByRole("button", { name: "Get 1 DevNet RLO" })).toBeDisabled();
  const wallet = await page.evaluate(() => (JSON.parse(localStorage.getItem("merit.wallet.v1")!) as { address: string }).address);
  const status = (await (await page.request.get(`/api/faucet?wallet=${wallet}`)).json()) as { ok: boolean; reason: string };
  expect(status.ok).toBe(false);
  const again = await page.request.post("/api/rialo", { data: { jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [{ pubkey: wallet, kelvins: 1_000_000_000 }] } });
  expect(((await again.json()) as { error?: { message: string } }).error?.message).toMatch(/last 24 hours|already holds 1 RLO/);

  // The wallet rule on its own, without the balance rule: a never-funded address gets one grant (half an RLO, so it
  // stays under the 1 RLO balance rule), then a cooldown.
  const fresh = base58.encode(randomBytes(32));
  const airdrop = () => page.request.post("/api/rialo", { data: { jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [{ pubkey: fresh, kelvins: 500_000_000 }] } });
  const first = (await (await airdrop()).json()) as { result?: unknown; error?: { message: string } };
  test.skip(/from one network/.test(first.error?.message ?? ""), "This network used its 3 faucet grants today.");
  expect(first.error).toBeUndefined();
  const second = (await (await airdrop()).json()) as { error?: { message: string; data?: { reason: string; nextAt: string } } };
  expect(second.error?.message).toContain("in the last 24 hours");
  expect(second.error?.data?.reason).toBe("wallet");
  const hours = (Date.parse(second.error!.data!.nextAt) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23.5);
  expect(hours).toBeLessThanOrEqual(24);
});

test("Read it answers within 20 seconds (links read in parallel, one model call)", async ({ page }) => {
  await page.goto("/app");
  const creating = await page.getByLabel("Confirm passphrase").count();
  await page.getByLabel(creating ? "Choose a passphrase" : "Passphrase").fill("Merit live e2e 42!");
  if (creating) await page.getByLabel("Confirm passphrase").fill("Merit live e2e 42!");
  await page.getByRole("button", { name: /and sign in$/ }).click();
  await expect(page.getByTestId("account-chip")).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/programs/new");
  await page.getByLabel("Program name").fill(`Live e2e ${Date.now().toString(36)}`);
  await page.getByLabel("Description").fill("Live end-to-end check of Read it. Nothing is created.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("About this program").fill(
    "Rialo is a blockchain where programs run their own timers and read the web through REX. Contributors post threads that explain how to build on it.",
  );
  await page.getByLabel("Links (optional)").fill("https://www.rialo.io\n@RialoHQ");
  const started = Date.now();
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("button", { name: "Read again" })).toBeVisible({ timeout: 25_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`Read it took ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(20.5);
  await expect(page.getByLabel("Summary")).not.toHaveValue("");
});
