/**
 * Telemetry signals as an owner reads them. The column names (brake_fluid_pct,
 * lub_oil_pressure) are engineering identifiers; these are the words and units
 * the phone, the web app and the car screen print.
 */

import { humanize } from "./format.js";

export const SIGNALS = {
  coolant_temp: { label: "Coolant temperature", unit: "°C" },
  lub_oil_pressure: { label: "Oil pressure", unit: "bar" },
  battery_voltage: { label: "Battery voltage", unit: "V" },
  fuel_pressure: { label: "Fuel pressure", unit: "bar" },
  brake_fluid_pct: { label: "Brake fluid level", unit: "%" },
  speed: { label: "Speed", unit: "km/h" },
};

export function signalLabel(key) {
  return SIGNALS[key]?.label ?? humanize(key);
}
