import { expect, test } from "@playwright/test";

const ROUND1 = "G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN";

test("campaign page shows round 1's real decision end to end", async ({ page }) => {
  await page.goto(`/c/${ROUND1}`);
  // A program on this campaign moves its record to /p/<slug> (other specs in this server create mirrors of it).
  await expect(page.getByRole("heading", { level: 1, name: /Explain Rialo in one post|Rialo in your own words/ })).toBeVisible();
  const row = page.getByTestId("decision-row").first();
  await expect(row.getByText("@KenilVekar1752")).toBeVisible();
  await expect(row.getByText("REX 4/4")).toBeVisible();
  await row.click();
  const drawer = page.getByTestId("decision-drawer");
  await expect(drawer.getByText("Hash matches chain")).toBeVisible();
  const rex = drawer.getByTestId("rex-proof");
  await expect(rex.getByText("Unanimous 4/4")).toBeVisible();
  await expect(rex.getByText("same ✓")).toHaveCount(4);
  await expect(rex.getByText("MX1|2113550979329368489|1658044857343000579|2026-10-23T08:39:56.000Z")).toBeVisible();
  await expect(drawer.getByRole("link", { name: /^5zJRRM/ })).toBeVisible();
  await drawer.getByRole("link", { name: /^62Kdit/ }).click();
  await expect(page.getByTestId("merit-lines").getByText(/Merit approved post 2113550979329368489/)).toBeVisible();
});

test("explore lists campaigns from the chain", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explain Rialo in one post" })).toBeVisible();
});

test("landing shows the real round 1 decision and links to it", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("Pay for real work.");
  await expect(h1.locator("em")).toHaveText("real");
  await page.getByRole("link", { name: "Open round 1 of the first real campaign" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ROUND1}$`));
});

test("guardrails reads both latches live and shows the signer placeholder", async ({ page }) => {
  await page.goto("/guardrails");
  for (const name of ["merit-judge", "merit-x"]) {
    const card = page.locator("section", { has: page.getByRole("heading", { name, exact: true }) });
    await expect(card.getByText("Live", { exact: true })).toBeVisible();
    await expect(card.getByText(/^(allow|deny)/).first()).toBeVisible();
    // Every filter in use, from Latch's own trace.
    await expect(card.getByText("Every filter in use")).toBeVisible();
    await expect(card.getByText(/· method$/).first()).toBeVisible();
  }
  await expect(page.getByText("Waiting on Latch rollout")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Per campaign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaign latches" })).toBeVisible();
  // When a campaign has its own child latch configured (production: "Rialo in your own words"), it is read live.
  if (process.env.MERIT_E2E_CHILD) {
    const child = page.locator("section", { has: page.getByRole("heading", { name: process.env.MERIT_E2E_CHILD }) });
    await expect(child.getByText("Live", { exact: true })).toBeVisible();
    await expect(child.getByText(/chain depth 1/)).toBeVisible();
  }
});

test("guardrails: every bad request gets Latch's real 403 and deniedBy", async ({ page }) => {
  await page.goto("/guardrails");
  const probe = async (label: string) => {
    await page.getByRole("button", { name: `Try: ${label}` }).click();
    const out = page.getByTestId(`probe-${{ "Wrong model": "judge-wrong-model", "Too many tokens": "judge-too-many-tokens", "Missing campaign header": "judge-no-campaign", "Non-numeric tweet path": "x-non-numeric", "POST to X": "x-write" }[label]}`);
    await expect(out).toBeVisible({ timeout: 30_000 });
    return out;
  };
  // Every rule is live (the last two were added in the dashboard, LATCH_PLUS A3 and A7): a real 403 from Latch, naming
  // the filter. The merit-x custom_code probe is enclave-safe, so it is sent for real.
  for (const [label, pattern] of [
    ["Wrong model", /claude-haiku-5-5/],
    ["Too many tokens", /2048/],
    ["Missing campaign header", /header_requirement.*X-Merit-Campaign/],
    ["Non-numeric tweet path", /numeric id/],
    ["POST to X", /Method POST not allowed/],
  ] as const) {
    const out = await probe(label);
    await expect(out.getByText("403", { exact: true })).toBeVisible();
    await expect(out.getByText(/deniedBy/)).toContainText(pattern);
  }
});

test("relay refuses batches, unknown methods and big faucet requests", async ({ request }) => {
  const rpc = (body: unknown) => request.post("/api/rialo", { data: body });
  expect((await rpc([{ jsonrpc: "2.0", id: 1, method: "getHealth" }])).status()).toBe(400);
  expect((await (await rpc({ jsonrpc: "2.0", id: 1, method: "getAllAccounts", params: [] })).json()).error.code).toBe(-32601);
  const big = await rpc({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [{ pubkey: ROUND1, kelvins: 2_000_000_000 }] });
  expect((await big.json()).error.message).toContain("capped at 1 RLO");
  const other = await rpc({ jsonrpc: "2.0", id: 1, method: "getAccountsByOwner", params: [{ owner: "11111111111111111111111111111111" }] });
  expect((await other.json()).error.message).toContain("Merit program");
  expect((await (await rpc({ jsonrpc: "2.0", id: 1, method: "getBlockHeight", params: [{}] })).json()).result).toBeTruthy();
});

test("submitting without signing in is refused before anything is spent", async ({ request }) => {
  const response = await request.post("/api/submit", { data: { campaign: ROUND1, postUrl: "https://x.com/KenilVekar1752/status/2113550979329368489" } });
  expect(response.status()).toBe(401);
});
