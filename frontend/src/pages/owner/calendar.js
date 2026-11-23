/**
 * Taking a booking with you: a calendar file and a map link, both made in the browser. Nothing is
 * sent anywhere; the file is the standard iCalendar text every calendar app opens.
 */

const pad = (n) => String(n).padStart(2, "0");

/** 20261123T033000Z: the instant, in UTC, as iCalendar writes it. */
function stamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** RFC 5545 text values: backslash, semicolon, comma and line breaks are written out. */
function escapeText(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines over 75 characters continue on the next line after a space, as the format requires. */
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

/**
 * One appointment as a calendar file. `start` is the slot's own timestamp (with its offset), so the
 * event lands at the right moment in whatever zone the calendar is set to.
 */
export function buildIcs({ uid, title, start, minutes = 90, location = "", description = "", now = new Date() }) {
  const begins = new Date(start);
  if (Number.isNaN(begins.getTime())) return null;
  const ends = new Date(begins.getTime() + minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AutoSaarthi//Owner app//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(uid)}@autosaarthi`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(begins)}`,
    `DTEND:${stamp(ends)}`,
    `SUMMARY:${escapeText(title)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Service appointment in one hour",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Hands the file to the browser as a download, and lets go of it afterwards. */
export function downloadIcs(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A map search for the centre, in whatever map app the phone or browser prefers. */
export function mapsUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}
