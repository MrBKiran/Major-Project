/**
 * The app's one way of writing numbers, dates and counts.
 *
 * Dates are built here rather than with toLocaleString, whose output differs
 * between browsers and Node versions ("Sep" vs "Sept", "am" vs "AM"); every
 * screen, and the mobile app later, has to agree on the same text.
 *
 * Times are shown in India Standard Time on purpose, not the viewer's zone: a
 * slot is 10:00 at the service centre, wherever the phone happens to be set.
 * IST has no daylight saving, so a fixed offset is exact.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MISSING = "—";

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function days(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "1 day", "5 days" — and "less than a day" rather than a rounded "0 days". */
export function formatDays(value) {
  const n = days(value);
  if (n === null) return null;
  return n < 1 ? "less than a day" : pluralize(Math.round(n), "day");
}

/** For "… needs service ___": "within 3 days", or "today". */
export function serviceDue(value) {
  const n = days(value);
  if (n === null) return "";
  return n < 1 ? "today" : `within ${formatDays(n)}`;
}

/** Opens a sentence: "About 3 days of driving left". */
export function drivingLeft(value) {
  const n = days(value);
  if (n === null) return null;
  return n < 1 ? "Less than a day of driving left" : `About ${formatDays(n)} of driving left`;
}

export function formatINR(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return MISSING;
  return `₹${Math.round(Number(amount)).toLocaleString("en-IN")}`;
}

/** The wall-clock fields of a moment, in IST — read with getUTC*. */
function inIST(value) {
  if (value === null || value === undefined || value === "") return null;
  // A bare calendar date is a day, not a moment: no zone to convert from.
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = dateOnly ? Date.parse(`${value}T00:00:00Z`) : new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(dateOnly ? ms : ms + IST_OFFSET_MS);
}

/** "18 Feb 2026" */
export function formatDate(value) {
  const d = inIST(value);
  if (!d) return MISSING;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Sat 5 Sep, 10:00 am" — a booking slot or any moment someone acts on. */
export function formatSlot(value) {
  const d = inIST(value);
  if (!d) return MISSING;
  const h = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const clock = `${h % 12 || 12}:${minutes} ${h < 12 ? "am" : "pm"}`;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${clock}`;
}

/** "scheduling_agent" → "Scheduling agent" — for identifiers that reach the screen. */
export function humanize(identifier) {
  if (!identifier) return "";
  const words = String(identifier).replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}
