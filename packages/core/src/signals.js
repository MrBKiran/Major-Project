/**
 * Telemetry signals as an owner reads them. The column names (brake_fluid_pct,
 * lub_oil_pressure) are engineering identifiers; these are the words and units
 * the phone, the web app and the car screen print.
 */

import { humanize } from "./format.js";

export const SIGNALS = {
  coolant_temp: { label: "Coolant temperature", unit: "°C" },
  lub_oil_pressure: { label: "Oil pressure", unit: "bar" },
  lub_oil_temp: { label: "Oil temperature", unit: "°C" },
  battery_voltage: { label: "Battery voltage", unit: "V" },
  fuel_pressure: { label: "Fuel pressure", unit: "bar" },
  brake_fluid_pct: { label: "Brake fluid level", unit: "%" },
  speed: { label: "Speed", unit: "km/h" },
};

export function signalLabel(key) {
  return SIGNALS[key]?.label ?? humanize(key);
}

const WINDOW = { long: "long-run", short: "recent" };
const STAT = { mean: "average", slope: "trend", std: "variability" };

/** A model feature in words: "brake_fluid_pct_long_mean" → "brake fluid level (long-run average)". */
export function featureLabel(feature) {
  if (feature === "dtc_count") return "trouble-code count";
  const m = /^(.+)_(long|short)_(mean|slope|std)$/.exec(feature);
  if (!m) return humanize(feature).toLowerCase();
  return `${signalLabel(m[1]).toLowerCase()} (${WINDOW[m[2]]} ${STAT[m[3]]})`;
}
