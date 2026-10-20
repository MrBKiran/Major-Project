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

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
  // The head unit's own loading state (it is not a skeleton).
  await expect(page.getByText("checking with the service agent…")).toHaveCount(0, { timeout: 60_000 });
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
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("sign-in.png");
});

test.describe("owner app on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("sign in", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText("Your car's health, and when it needs service")).toBeVisible();
    await expect(page).toHaveScreenshot("owner-sign-in.png");
  });

  test("home", async ({ page }) => {
    await signIn(page, "ramesh.pawar@example.in", "/app");
    await settle(page);
    await expect(page).toHaveScreenshot("owner-home.png", { fullPage: true });
  });
});
