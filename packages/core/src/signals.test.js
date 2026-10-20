import { describe, expect, it } from "vitest";
import { SIGNALS, signalLabel } from "./signals.js";

describe("signalLabel", () => {
  // The owner's healthy screen printed telemetry column names — "brake fluid
  // pct", "lub oil pressure" — as if they were words.
  it.each([
    ["coolant_temp", "Coolant temperature"],
    ["lub_oil_pressure", "Oil pressure"],
    ["battery_voltage", "Battery voltage"],
    ["fuel_pressure", "Fuel pressure"],
    ["brake_fluid_pct", "Brake fluid level"],
    ["speed", "Speed"],
  ])("names %s for a person", (key, label) => {
    expect(signalLabel(key)).toBe(label);
  });

  it("falls back to readable words for a signal it does not know", () => {
    expect(signalLabel("intake_air_temp")).toBe("Intake air temp");
  });

  it("gives every known signal a unit", () => {
    for (const signal of Object.values(SIGNALS)) expect(signal.unit).toBeTruthy();
  });
});
