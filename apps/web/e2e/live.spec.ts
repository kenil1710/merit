import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import { expect, test } from "@playwright/test";

// Live only (MERIT_E2E_URL), and read-only: no wallet sign-in, no faucet grant, no campaign. The faucet's rules are
// read through GET /api/faucet. The grant-and-cooldown path and "Read it" timing write to the database, so they run
// against the local server (e2e/local-writes.spec.ts).

test.skip(!process.env.MERIT_E2E_URL, "Live checks run against the deployed site only.");

const LIVE_CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";

test("faucet status: a fresh wallet may ask, a funded one is told why not", async ({ request }) => {
  const fresh = (await (await request.get(`/api/faucet?wallet=${base58.encode(randomBytes(32))}`)).json()) as { ok: boolean };
  expect(fresh.ok).toBe(true);
  // The live campaign's workflow account holds its escrow (well over 1 RLO): the balance rule answers.
  const funded = (await (await request.get(`/api/faucet?wallet=${LIVE_CAMPAIGN}`)).json()) as { ok: boolean; reason: string };
  expect(funded).toMatchObject({ ok: false, reason: "balance" });
  expect((await request.get("/api/faucet?wallet=not-an-address")).status()).toBe(400);
});

test("homepage totals count real campaigns only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("totals-note")).toContainText(/^Real campaigns only; includes \d+ retired campaigns?\. Test runs are left out\.$/);
});
