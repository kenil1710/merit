import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import { expect, test } from "@playwright/test";

// Checks that write to the database (faucet grants, owner sign-in, a "Read it" call): local server only, with its
// in-memory database. Never against production.

test.skip(!!process.env.MERIT_E2E_URL, "Writes to the database: local server only.");

test("faucet: one grant per wallet per day, then a cooldown with the time it ends", async ({ request }) => {
  // Half an RLO, so the wallet stays under the 1 RLO balance rule and the wallet rule is what answers.
  const wallet = base58.encode(randomBytes(32));
  const airdrop = () => request.post("/api/rialo", { data: { jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [{ pubkey: wallet, kelvins: 500_000_000 }] } });
  const first = (await (await airdrop()).json()) as { error?: { message: string } };
  expect(first.error).toBeUndefined();
  const second = (await (await airdrop()).json()) as { error?: { message: string; data?: { reason: string; nextAt: string } } };
  expect(second.error?.message).toContain("in the last 24 hours");
  expect(second.error?.data?.reason).toBe("wallet");
  const hours = (Date.parse(second.error!.data!.nextAt) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23.5);
  expect(hours).toBeLessThanOrEqual(24);
  expect(await (await request.get(`/api/faucet?wallet=${wallet}`)).json()).toMatchObject({ ok: false, reason: "wallet" });
});

test("Read it answers within 20 seconds (links read in parallel, one model call)", async ({ page }) => {
  const pass = "Correct horse battery 42!";
  await page.goto("/app");
  await page.getByLabel("Choose a passphrase").fill(pass);
  await page.getByLabel("Confirm passphrase").fill(pass);
  await page.getByRole("button", { name: "Create wallet and sign in" }).click();
  await expect(page.getByTestId("account-chip")).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/programs/new");
  await page.getByLabel("Program name").fill(`Read it e2e ${Date.now().toString(36)}`);
  await page.getByLabel("Description").fill("End-to-end check of Read it. Nothing is created.");
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
