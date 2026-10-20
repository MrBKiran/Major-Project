import { describe, expect, it } from "vitest";
import {
  drivingLeft, formatDate, formatDays, formatINR, formatSlot, humanize, pluralize, serviceDue,
} from "./format.js";

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "day")).toBe("1 day");
    expect(pluralize(1, "rate limit")).toBe("1 rate limit");
  });

  it("uses the plural for zero and for many", () => {
    expect(pluralize(0, "day")).toBe("0 days");
    expect(pluralize(3, "rate limit")).toBe("3 rate limits");
  });

  it("takes an irregular plural", () => {
    expect(pluralize(2, "bay", "bays")).toBe("2 bays");
    expect(pluralize(2, "child", "children")).toBe("2 children");
  });
});

describe("formatDays", () => {
  it("says 1 day, not 1 days", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(1.4)).toBe("1 day");
  });

  it("rounds to whole days", () => {
    expect(formatDays(4.6)).toBe("5 days");
  });

  it("never says 0 days for a failure that is hours away", () => {
    expect(formatDays(0.4)).toBe("less than a day");
    expect(formatDays(0)).toBe("less than a day");
  });

  it("accepts a numeric string", () => {
    expect(formatDays("3")).toBe("3 days");
  });

  it("returns null when there is no estimate", () => {
    expect(formatDays(null)).toBeNull();
    expect(formatDays(undefined)).toBeNull();
    expect(formatDays("soon")).toBeNull();
  });
});

describe("serviceDue", () => {
  it("phrases the window for a sentence", () => {
    expect(serviceDue(1)).toBe("within 1 day");
    expect(serviceDue(12.2)).toBe("within 12 days");
  });

  it("says today when it is under a day", () => {
    expect(serviceDue(0.3)).toBe("today");
  });

  it("is empty when there is no estimate", () => {
    expect(serviceDue(null)).toBe("");
  });
});

describe("drivingLeft", () => {
  it("reads as a sentence opening", () => {
    expect(drivingLeft(1)).toBe("About 1 day of driving left");
    expect(drivingLeft(9)).toBe("About 9 days of driving left");
  });

  it("does not say 'about less than a day'", () => {
    expect(drivingLeft(0.5)).toBe("Less than a day of driving left");
  });

  it("is null when there is no estimate", () => {
    expect(drivingLeft(undefined)).toBeNull();
  });
});

describe("formatINR", () => {
  it("groups the Indian way", () => {
    expect(formatINR(26000)).toBe("₹26,000");
    expect(formatINR(100000)).toBe("₹1,00,000");
  });

  it("rounds to whole rupees", () => {
    expect(formatINR(3100.4)).toBe("₹3,100");
  });

  it("shows a dash for a missing amount", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
  });
});

describe("formatDate", () => {
  it("keeps a calendar date on its own day", () => {
    expect(formatDate("2026-02-18")).toBe("18 Feb 2026");
  });

  it("shows a timestamp's date in India time", () => {
    // 20:00 UTC on the 4th is 01:30 IST on the 5th.
    expect(formatDate("2026-09-04T20:00:00Z")).toBe("5 Sep 2026");
  });

  it("shows a dash for nothing or nonsense", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("formatSlot", () => {
  it("shows a slot in India time, however the server spelled the offset", () => {
    expect(formatSlot("2026-09-05T04:30:00+00:00")).toBe("Sat 5 Sep, 10:00 am");
    expect(formatSlot("2026-09-05T10:00:00+05:30")).toBe("Sat 5 Sep, 10:00 am");
  });

  it("uses a 12-hour clock", () => {
    expect(formatSlot("2026-09-05T09:45:00Z")).toBe("Sat 5 Sep, 3:15 pm");
    expect(formatSlot("2026-09-05T06:30:00Z")).toBe("Sat 5 Sep, 12:00 pm");
    expect(formatSlot("2026-09-04T18:30:00Z")).toBe("Sat 5 Sep, 12:00 am");
  });

  it("accepts a Date", () => {
    expect(formatSlot(new Date("2026-09-05T04:30:00Z"))).toBe("Sat 5 Sep, 10:00 am");
  });

  it("shows a dash for nothing or nonsense", () => {
    expect(formatSlot(undefined)).toBe("—");
    expect(formatSlot("tuesday-ish")).toBe("—");
  });
});

describe("humanize", () => {
  it("turns an identifier into words", () => {
    expect(humanize("scheduling_agent")).toBe("Scheduling agent");
    expect(humanize("booked")).toBe("Booked");
  });

  it("is empty for nothing", () => {
    expect(humanize("")).toBe("");
    expect(humanize(null)).toBe("");
  });
});
