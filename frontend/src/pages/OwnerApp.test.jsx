import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();
vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ logout }) }));
vi.mock("../api.js", () => ({
  api: {
    get: vi.fn((path) => Promise.resolve(path === "/api/fleet"
      ? { vehicles: [{ vin: "MH12AB1001", severity: null }] }
      : { vehicle: { vin: "MH12AB1001", model: "Bolero", odometer: 128400 }, series: [], predictions: [], maintenance_history: [], dtc_codes: [] })),
    post: vi.fn(),
  },
}));

const { default: OwnerApp, HealthyCard } = await import("./OwnerApp.jsx");

const reading = (over) => ({
  ts: "2026-10-20T08:00:00Z", drive_state: "DRIVING", coolant_temp: 88, lub_oil_pressure: 3.1,
  battery_voltage: 13.9, fuel_pressure: 3.4, brake_fluid_pct: 92, speed: 54, ...over,
});

describe("healthy card", () => {
  it("names the signals in words, not column names", () => {
    render(<HealthyCard detail={{ series: [reading(), reading({ coolant_temp: 89 })] }} />);
    expect(screen.getByText("Oil pressure")).toBeInTheDocument();
    expect(screen.getByText("Brake fluid level")).toBeInTheDocument();
    expect(screen.queryByText(/pct|lub oil|_/)).not.toBeInTheDocument();
  });

  it("with no recent readings, says so instead of drawing six empty bars", () => {
    // Empty sparklines read as a page still loading — on the screen whose
    // whole message is "nothing is wrong".
    render(<HealthyCard detail={{ series: [] }} />);
    expect(screen.getByText(/no recent readings/i)).toBeInTheDocument();
    expect(screen.queryByText("Oil pressure")).not.toBeInTheDocument();
  });
});

describe("signing out on the phone", () => {
  beforeEach(() => logout.mockClear());

  it("is possible: the owner app on its own has a sign-out", async () => {
    render(<OwnerApp standalone />);
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("is not offered in the console's preview of the phone, which has its own", async () => {
    render(<OwnerApp />);
    await screen.findByText(/everything reads normal/i);
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});
