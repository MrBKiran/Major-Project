/**
 * Night mode for the owner's phone. The head unit already had a night variant;
 * the phone threw a white screen at an owner reading it in the dark.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { day, night as nightTokens } from "@autosaarthi/tokens";

vi.mock("./auth/AuthContext.jsx", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("./api.js", () => ({
  api: {
    get: vi.fn((path) => Promise.resolve(path === "/api/fleet"
      ? { vehicles: [{ vin: "MH12AB1001", severity: null }] }
      : { vehicle: { vin: "MH12AB1001", model: "Bolero", odometer: 128400 }, series: [], predictions: [],
          maintenance_history: [{ date: "2026-02-18", service_type: "brake_pad_replace", km_at_service: 124900, cost: 3100 }],
          dtc_codes: [] })),
    post: vi.fn(),
  },
}));

const { default: OwnerApp } = await import("./pages/OwnerApp.jsx");
const { useSystemNight } = await import("./night.jsx");

function systemPrefersDark(dark) {
  vi.stubGlobal("matchMedia", vi.fn((query) => ({
    matches: dark && query.includes("dark"), media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
}

const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("owner app at night", () => {
  it("follows a phone set to dark", async () => {
    systemPrefersDark(true);
    render(<OwnerApp standalone />);
    const card = (await screen.findByText(/everything reads normal/i)).closest("div[style*='border']");
    expect(card.style.background).toBe(rgb(nightTokens.card));
  });

  it("draws its links in the night link colour, not one tuned for a light page", async () => {
    systemPrefersDark(true);
    render(<OwnerApp standalone />);
    const link = await screen.findByRole("button", { name: /all service history/i });
    expect(link.style.color).toBe(rgb(nightTokens.link));
  });

  it("flips the page theme too, so the shared Tailwind screens (sign-in) follow", async () => {
    systemPrefersDark(true);
    render(<OwnerApp standalone />);
    await screen.findByText(/everything reads normal/i);
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("stays light on a phone set to light", async () => {
    systemPrefersDark(false);
    render(<OwnerApp standalone />);
    const card = (await screen.findByText(/everything reads normal/i)).closest("div[style*='border']");
    expect(card.style.background).toBe(rgb(day.card));
  });

  it("keeps the console's phone preview light whatever the system says", async () => {
    // The preview sits inside the light console and is what the demo slides show.
    systemPrefersDark(true);
    render(<OwnerApp />);
    const card = (await screen.findByText(/everything reads normal/i)).closest("div[style*='border']");
    expect(card.style.background).toBe(rgb(day.card));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("usePageTheme", () => {
  it("leaves the page dark when an inner screen that also set it goes away", async () => {
    // /app sets the theme, and so does the owner app inside it. Signing out
    // unmounts the owner app — whose cleanup must not turn a dark phone's
    // sign-in screen light.
    const { usePageTheme } = await import("./night.jsx");
    function Inner() { usePageTheme(true); return null; }
    function Outer({ showInner }) { usePageTheme(true); return showInner ? <Inner /> : null; }
    const { rerender } = render(<Outer showInner />);
    rerender(<Outer showInner={false} />);
    expect(document.documentElement.dataset.theme).toBe("night");
  });
});

describe("useSystemNight", () => {
  it("is false where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    let value;
    function Probe() { value = useSystemNight(); return null; }
    render(<Probe />);
    expect(value).toBe(false);
  });
});
