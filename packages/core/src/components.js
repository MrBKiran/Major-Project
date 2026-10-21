/**
 * The parts the prediction models watch, as an owner reads them — and which
 * reading shows each one's wear, and which way that reading drifts as it goes
 * (from the `drivers` ramps in simulator/vehicles.yaml: coolant climbs as a
 * water pump fails; oil, fuel and brake-fluid readings fall).
 */

import { humanize } from "./format.js";

export const COMPONENTS = {
  water_pump: { label: "water pump", plural: false, signal: "coolant_temp", direction: "up" },
  battery: { label: "battery", plural: false, signal: "battery_voltage", direction: "down" },
  brake_pads: { label: "brake pads", plural: true, signal: "brake_fluid_pct", direction: "down" },
  fuel_injector: { label: "fuel injector", plural: false, signal: "fuel_pressure", direction: "down" },
  oil_pump: { label: "oil pump", plural: false, signal: "lub_oil_pressure", direction: "down" },
};

export function componentLabel(component) {
  if (!component) return "";
  return COMPONENTS[component]?.label ?? humanize(component).toLowerCase();
}

/** "Your brake pads are wearing out" / "Your water pump is wearing out". */
export function wearingOut(component) {
  const plural = Boolean(COMPONENTS[component]?.plural);
  return `Your ${componentLabel(component)} ${plural ? "are" : "is"} wearing out`;
}

/** { key, direction } of the reading that shows this part's wear, or null. */
export function componentSignal(component) {
  const c = COMPONENTS[component];
  return c ? { key: c.signal, direction: c.direction } : null;
}
