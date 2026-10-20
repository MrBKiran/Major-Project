/**
 * Visual baseline of every screen, taken before the Phase 1/2 restyle so that
 * any change it makes to a demo slide is seen, not discovered on stage.
 *
 *   npx playwright test                      # compare against the baseline
 *   npx playwright test --update-snapshots   # accept an intended change
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "autosaarthi";

async function signIn(page, email, path = "/") {
  // The refresh cookie set here is what the app resumes from on load.
  const res = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

// Each bundled weight is its own file, fetched when first used — a weight that
// only one glyph needs (the bold logo letter) could miss the screenshot.
async function fontsLoaded(page) {
  await page.evaluate(async () => {
    const faces = ["400", "500", "600", "700"].map((w) => `${w} 16px "Space Grotesk"`)
      .concat(["400", "500", "600"].map((w) => `${w} 16px "JetBrains Mono"`));
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
  // Loading states that are text rather than skeletons: the head unit's, and
  // the "Loading…" placeholders (e.g. the red-team scenario list).
  await expect(page.getByText("checking with the service agent…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 60_000 });
  await fontsLoaded(page);
}

const CONSOLE_TABS = [
  ["Fleet Monitoring", "fleet"],
  ["Service Ops", "service-ops"],
  ["In-Car Console", "in-car"],
  ["Plant Quality", "plant-quality"],
];

for (const [tab, name] of CONSOLE_TABS) {
  test(`console: ${tab}`, async ({ page }) => {
    await signIn(page, "admin@autosaarthi.io");
    await page.getByRole("button", { name: tab, exact: true }).click();
    await settle(page);
    // The in-car page lists the guard's live verdicts below the head unit, and
    // which steps appear depends on the agents' rate-limit state — so only the
    // head unit itself (the viewport) is held to the baseline there.
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: name !== "in-car" });
  });
}

test("console: Security Console", async ({ page }) => {
  // The audit trail and live trace grow with every tool call anyone makes, and
  // the counters move with them: the viewport only, with the counters masked.
  await signIn(page, "admin@autosaarthi.io");
  await page.getByRole("button", { name: "Security Console", exact: true }).click();
  await settle(page);
  const counters = [/^audited calls$/i, /^blocked$/i, /^flagged$/i, /^quarantined agents$/i]
    .map((label) => page.getByText(label).locator(".."));
  for (const counter of counters) await expect(counter).toHaveCount(1);
  await expect(page).toHaveScreenshot("security.png", { mask: counters });
});

test("console: sign in", async ({ page }) => {
  // The form re-renders once /api/auth/config says which methods exist.
  const config = page.waitForResponse((r) => r.url().includes("/api/auth/config"));
  await page.goto("/");
  await config;
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await fontsLoaded(page);
  // Not pixel-compared: the sign-in screens flickered by a few dozen pixels
  // between identical runs (a bold glyph, a label mid-transition) through every
  // fix tried. Their wording is covered by unit tests; this checks they render.
  await expect(page.getByText("Agentic predictive maintenance — OEM console")).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
});

test.describe("owner app on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("sign in", async ({ page }) => {
    // The phone form appears once /api/auth/config confirms phone sign-in exists.
    const config = page.waitForResponse((r) => r.url().includes("/api/auth/config"));
    await page.goto("/app");
    await config;
    await expect(page.getByText("Your car's health, and when it needs service")).toBeVisible();
    await expect(page.getByText(/mobile number/i)).toBeVisible();
    await fontsLoaded(page);
    // Not pixel-compared — see the console sign-in test.
    await expect(page.getByRole("button", { name: /send code/i })).toBeVisible();
  });

  test("home", async ({ page }) => {
    await signIn(page, "ramesh.pawar@example.in", "/app");
    await settle(page);
    await expect(page).toHaveScreenshot("owner-home.png", { fullPage: true });
  });
});
