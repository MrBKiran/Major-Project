/**
 * Fleet Monitoring, from the design critique:
 * - a vehicle could be chosen only by clicking its row (a <tr onClick>), not
 *   from the keyboard (WCAG 2.1.1);
 * - the model panel printed a training artifact's internal note — "Do NOT put
 *   this number on a slide" — and raw feature names;
 * - the telemetry chart had no text alternative (WCAG 1.1.1).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ can: (p) => p === "prediction:read" }) }));
vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock("recharts", async (original) => {
  // jsdom has no layout: give the chart a size so it draws.
  const actual = await original();
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 600, height: 220 }}>{children}</div> };
});

const { api } = await import("../api.js");
const { default: FleetMonitoring } = await import("./FleetMonitoring.jsx");

const FLEET = {
  vehicles: [
    { vin: "KA03KL1008", model: "Thar", city: "Bengaluru", component: "oil_pump", days_to_failure: 1, severity: "P1" },
    { vin: "MH12AB1001", model: "Bolero", city: "Pune", component: null, days_to_failure: null, severity: null },
  ],
  page_counts: { at_risk: 1, p1: 1, healthy: 1 },
  page: { total: 2 },
  scope: { kind: "all", org: "AutoSaarthi Platform" },
};
const detail = (vin) => ({
  vehicle: { vin, model: vin === "KA03KL1008" ? "Thar" : "Bolero", plant: "Chakan", batch_id: "B1", odometer: 96200, city: "Pune" },
  series: [
    { ts: "2026-10-20T08:00:00Z", coolant_temp: 90.2, battery_voltage: 12.6 },
    { ts: "2026-10-20T09:00:00Z", coolant_temp: 104.1, battery_voltage: 12.1 },
  ],
  predictions: [], maintenance_history: [], dtc_codes: [],
});
const METRICS = {
  m1_metrics: {
    n_train: 1248, n_test: 312, model: "DecisionTree",
    comparison_table: [{ model: "DecisionTree", accuracy: 0.66, f1_macro: 0.656 }],
    shap_top_features: [{ feature: "dtc_count" }, { feature: "brake_fluid_pct_long_mean" }],
  },
  m4_metrics: { limitation: "Recall is at noise level ... Do NOT put this number on a slide." },
};

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => Promise.resolve(
    path === "/api/fleet" ? FLEET
      : path === "/api/models/metrics" ? METRICS
        : detail(path.split("/").pop())));
});

describe("choosing a vehicle", () => {
  it("works from the keyboard: each vehicle is a button", async () => {
    render(<FleetMonitoring />);
    const bolero = await screen.findByRole("button", { name: /Bolero.*MH12AB1001/ });
    bolero.focus();
    expect(bolero).toHaveFocus();
    fireEvent.click(bolero);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/vehicle/MH12AB1001"));
    expect(bolero).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Thar.*KA03KL1008/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("says how many vehicles the list holds, since it scrolls", async () => {
    render(<FleetMonitoring />);
    const list = await screen.findByRole("region", { name: "Fleet list" });
    expect(list).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("2 vehicles")).toBeInTheDocument();
  });
});

describe("the model panel", () => {
  it("shows reviewed wording, not the artifact's internal note", async () => {
    render(<FleetMonitoring />);
    expect(await screen.findByText(/healthy and faulty vehicles score almost the same/i)).toBeInTheDocument();
    expect(screen.queryByText(/do not put this number on a slide/i)).not.toBeInTheDocument();
  });

  it("names what the model weighs in words", async () => {
    render(<FleetMonitoring />);
    expect(await screen.findByText(/trouble-code count, brake fluid level \(long-run average\)/)).toBeInTheDocument();
    expect(screen.queryByText(/brake fluid pct/)).not.toBeInTheDocument();
  });
});

describe("the telemetry chart", () => {
  it("has a text alternative saying what it shows", async () => {
    render(<FleetMonitoring />);
    const chart = await screen.findByRole("img", { name: /coolant temperature.*90\.2.*104\.1.*battery voltage.*12\.6.*12\.1/i });
    expect(within(chart.parentElement).queryByText(/./)).toBeDefined();
  });
});
