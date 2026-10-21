/**
 * What an owner reads — on the phone, the web owner app and the car's screen.
 *
 * Staff triage by P1/P2/P3 and model probabilities; an owner should never
 * have to decode either. One set of words here, so the three owner surfaces
 * cannot drift apart again ("If it fails on road" / "If it fails on the road").
 */

import { componentSignal } from "./components.js";
import { drivingLeft, formatDays } from "./format.js";
import { SIGNALS } from "./signals.js";

export const OWNER = {
  repairNow: "Repair now",
  failsOnRoad: "If it fails on the road",
  book: "Book a service",
  whyThisPart: "Why this part?",
  talkToAgent: "Talk to the agent",
  nothingBooked: "Nothing is booked without your yes",
  healthyTitle: "Everything reads normal",
  healthyBody: "No trouble codes and no wear worth telling you about. We only get in touch when something is actually changing.",
};

const SEVERITY = { P1: "Urgent", P2: "Soon", P3: "Worth watching" };

export function severityWord(severity) {
  return SEVERITY[severity] ?? "Needs attention";
}

/** "Urgent · 5 days" — the badge on an alert. */
export function alertBadge({ severity, days_to_failure: days }) {
  const left = formatDays(days);
  return left ? `${severityWord(severity)} · ${left}` : severityWord(severity);
}

/** "Urgent: about 5 days of driving left" — the badge as a screen reader says it. */
export function alertSpoken({ severity, days_to_failure: days }) {
  const left = drivingLeft(days);
  return left ? `${severityWord(severity)}: ${left.charAt(0).toLowerCase()}${left.slice(1)}` : severityWord(severity);
}

/** { words: "Likely", percent: "83%" } for a failure probability, or null. */
export function confidence(probability) {
  if (probability === null || probability === undefined || !Number.isFinite(Number(probability))) return null;
  const p = Number(probability);
  const words = p >= 0.9 ? "Very likely" : p >= 0.75 ? "Likely" : p >= 0.5 ? "Possible" : "Unlikely";
  return { words, percent: `${Math.round(p * 100)}%` };
}

/**
 * The sentence about the reading that shows the wear — only as strong as the
 * readings: a drift is claimed only when the last day's engine-running values
 * show it, and nothing is said without at least two of them.
 */
export function trendSentence(component, values) {
  const signal = componentSignal(component);
  if (!signal || !values || values.length < 2) return null;
  const label = SIGNALS[signal.key].label.toLowerCase();
  const drift = values[values.length - 1] - values[0];
  const shows = signal.direction === "up" ? drift > 0 : drift < 0;
  if (!shows) {
    return `Your ${label} has held steady over the last 24 hours — the model's call rests on earlier readings.`;
  }
  return `Your ${label} has been ${signal.direction === "up" ? "climbing" : "falling"} over the last 24 hours.`;
}
