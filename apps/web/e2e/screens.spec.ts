import { test } from "@playwright/test";

// Screenshots of every main page for review, in both themes, saved to docs/screenshots/.
const OUT = "../../docs/screenshots";
const PAGES: [string, string][] = [
  ["landing", "/"],
  ["explore", "/explore"],
  ["campaign", "/c/G1JjiebaNvYQVBN4tscddqdKRZLfjJR2pgTVrBScx2TN"],
  ["join", "/join"],
  ["owner", "/owner"],
  ["guardrails", "/guardrails"],
];

for (const theme of ["dark", "light"] as const) {
  test(`screens ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
    for (const [name, path] of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
    }
    await page.goto(PAGES[2][1]);
    await page.getByTestId("decision-row").first().click();
    await page.getByTestId("decision-drawer").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/campaign-drawer-${theme}.png` });
  });
}

test("screens phone", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [PAGES[0], PAGES[2]]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}-phone.png`, fullPage: true });
  }
});
