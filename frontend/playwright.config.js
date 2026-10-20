import { defineConfig } from "@playwright/test";

// Runs against the dev servers already started from .claude/launch.json
// (frontend :5173 proxying the backend on :8010) and the demo database.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: {
    // Strict on purpose: a 3% (and even 0.2%) ratio let a changed date format
    // and a changed badge through unnoticed. Every screen renders identically
    // run to run except the Security Console's live feeds, which its test masks.
    toHaveScreenshot: { maxDiffPixels: 20, threshold: 0.02, animations: "disabled" },
  },
  use: {
    baseURL: "http://localhost:5173",
    channel: "msedge",
    viewport: { width: 1440, height: 900 },
  },
});
