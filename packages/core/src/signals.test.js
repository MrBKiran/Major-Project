import { describe, expect, it } from "vitest";
import { featureLabel, SIGNALS, signalLabel } from "./signals.js";

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

describe("featureLabel", () => {
  // The console's model panel printed "brake fluid pct long mean" as a sentence.
  it.each([
    ["brake_fluid_pct_long_mean", "brake fluid level (long-run average)"],
    ["battery_voltage_short_mean", "battery voltage (recent average)"],
    ["brake_fluid_pct_long_slope", "brake fluid level (long-run trend)"],
    ["fuel_pressure_short_std", "fuel pressure (recent variability)"],
    ["lub_oil_temp_short_mean", "oil temperature (recent average)"],
    ["dtc_count", "trouble-code count"],
  ])("puts %s into words", (feature, words) => {
    expect(featureLabel(feature)).toBe(words);
  });

  it("falls back to readable words for a feature it does not know", () => {
    expect(featureLabel("odometer_delta")).toBe("odometer delta");
  });
});
