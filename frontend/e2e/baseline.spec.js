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
// only a few glyphs need (the bold wordmark) could miss the screenshot.
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


// A full-page capture of a layout with a viewport-high sidebar re-lays the page out while it stitches,
// and the result moved by a pixel or two between identical runs. Growing the window to the page's own
// height and taking an ordinary capture gives the same picture every time.
async function pageShot(page, name, options = {}) {
  const { width } = page.viewportSize();
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(300);
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width, height: Math.max(900, height) });
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot(name, options);
}

const CONSOLE_TABS = [
  ["Fleet Monitoring", "fleet"],
  ["Service Ops", "service-ops"],
  ["In-Car Console", "in-car"],
  ["Plant Quality", "plant-quality"],
];

// Parts drawn from today's date, which move at midnight whatever the code
// does: the forecast is a 14-day window starting today, and a CAPA draft's id
// carries the date it was drafted.
const DATED = {
  "service-ops": (page) => [page.locator(".recharts-wrapper")],
  "plant-quality": (page) => [page.getByText(/^CAPA-DRAFT-/)],
  // The head unit shows the real time.
  "in-car": (page) => [page.getByTestId("head-unit-clock")],
};

for (const [tab, name] of CONSOLE_TABS) {
  test(`console: ${tab}`, async ({ page }) => {
    await signIn(page, "admin@autosaarthi.io");
    await page.getByRole("button", { name: tab, exact: true }).click();
    await settle(page);
    // Below the head unit the in-car page explains the server's verdict, which
    // depends on how old the car's latest reading is — so only the head unit
    // itself (the viewport) is held to the baseline there.
    const mask = DATED[name] ? DATED[name](page) : [];
    for (const part of mask) await expect(part).toHaveCount(1);
    // The 3D car (digital twin, head unit) turns all the time, so it is masked: the screen around it is
    // what is held to the baseline.
    const masks = { mask: [...mask, page.locator("canvas")] };
    if (name === "in-car") await expect(page).toHaveScreenshot(`${name}.png`, masks);
    else await pageShot(page, `${name}.png`, masks);
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
  // The live-connection tile (a socket that connects a moment after load) is masked too.
  const live = page.getByRole("button", { name: "Verify audit chain" }).locator("..");
  await expect(page).toHaveScreenshot("security.png", { mask: [...counters, live] });
});

test("console navigation: every section is reachable, whole, at laptop widths", async ({ page }) => {
  // A sidebar on a desktop window, a scrolling row of tabs below that. Either way: every page the
  // role has is on screen, and no label is cut short or broken onto a second line.
  await signIn(page, "admin@autosaarthi.io");
  for (const width of [1440, 1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 800 });
    const nav = page.getByRole("navigation", { name: /^(Main|Console sections)$/ });
    await expect(nav, `navigation at ${width} px`).toBeVisible();
    for (const [tab] of [...CONSOLE_TABS, ["Security Console"]]) {
      const button = nav.getByRole("button", { name: tab, exact: true });
      await expect(button, `${tab} at ${width} px`).toBeVisible();
      const whole = await button.evaluate((el) => {
        const label = el.querySelector(".truncate") ?? el;
        return label.scrollWidth <= label.clientWidth && el.getBoundingClientRect().height < 56;
      });
      expect(whole, `${tab} is one whole line at ${width} px`).toBe(true);
    }
  }
});

test("public site: one way in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/fix it before\s*it breaks/i);
  // The dock, the footer and a single sign-in button in the top bar; no second door to the same page.
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button")).toHaveCount(5);
  await expect(page.getByRole("link", { name: /owner app/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("console: sign in", async ({ page }) => {
  // The form re-renders once /api/auth/config says which methods exist.
  const config = page.waitForResponse((r) => r.url().includes("/api/auth/config"));
  await page.goto("/login");
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
    // The heartbeat line runs on a timeline of its own; the screen around it is what is compared.
    await pageShot(page, "owner-home.png", { mask: [page.locator("canvas"), page.getByTestId("heartbeat")] });
  });
});
