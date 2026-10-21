/**
 * Service Ops, from the design critique: the forecast chart had no text
 * alternative (WCAG 1.1.1), and the chosen centre was shown by colour alone.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ can: (p) => p === "forecast:read" }) }));
vi.mock("../api.js", () => ({ api: { get: vi.fn() } }));
vi.mock("recharts", async (original) => {
  const actual = await original();
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 600, height: 240 }}>{children}</div> };
});

const { api } = await import("../api.js");
const { default: ServiceOps } = await import("./ServiceOps.jsx");

const day = (date, weekday, baseline, predicted, capacity) =>
  ({ date, weekday, baseline_forecast: baseline, predicted_failure_jobs: predicted, capacity });

api.get.mockImplementation(() => Promise.resolve({
  horizon_days: 14, overloaded_center_days: 1, redistribution: [],
  centers: [
    { center_id: "SC-PUN-01", model: "SARIMAX", mean_utilisation: 0.95, capacity: 12, overloaded_days: ["2026-10-22"],
      series: [day("2026-10-21", "Wed", 9, 2, 12), day("2026-10-22", "Thu", 11, 3, 12)] },
    { center_id: "SC-PUN-02", model: "SARIMAX", mean_utilisation: 0.5, capacity: 18, overloaded_days: [],
      series: [day("2026-10-21", "Wed", 6, 1, 18)] },
  ],
}));

describe("the demand forecast", () => {
  it("says what the chart shows, for a screen reader", async () => {
    render(<ServiceOps />);
    expect(await screen.findByRole("img", {
      name: "SC-PUN-01: expected jobs from 11 to 14 a day against a capacity of 12; over capacity on 1 day (Thu 22 Oct)",
    })).toBeInTheDocument();
  });

  it("marks the chosen centre as pressed, not by colour alone", async () => {
    render(<ServiceOps />);
    const busiest = await screen.findByRole("button", { name: /SC-PUN-01/ });
    const other = screen.getByRole("button", { name: /SC-PUN-02/ });
    expect(busiest).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(other);
    expect(other).toHaveAttribute("aria-pressed", "true");
    expect(busiest).toHaveAttribute("aria-pressed", "false");
  });
});
