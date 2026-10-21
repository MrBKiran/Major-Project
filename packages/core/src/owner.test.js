import { describe, expect, it } from "vitest";

import { alertBadge, alertSpoken, confidence, OWNER, severityWord, trendSentence } from "./owner.js";

describe("severity, in an owner's words", () => {
  it.each([["P1", "Urgent"], ["P2", "Soon"], ["P3", "Worth watching"], [null, "Needs attention"], ["P9", "Needs attention"]])(
    "%s reads as %s", (severity, word) => expect(severityWord(severity)).toBe(word));

  it("never shows the staff code itself", () => {
    expect(alertBadge({ severity: "P1", days_to_failure: 5 })).not.toMatch(/P\d/);
  });

  it("says how long is left on the badge", () => {
    expect(alertBadge({ severity: "P1", days_to_failure: 5 })).toBe("Urgent · 5 days");
    expect(alertBadge({ severity: "P2", days_to_failure: 0.4 })).toBe("Soon · less than a day");
    expect(alertBadge({ severity: "P2", days_to_failure: null })).toBe("Soon");
  });

  it("reads aloud as a sentence, not 'P one dot five days'", () => {
    expect(alertSpoken({ severity: "P1", days_to_failure: 5 })).toBe("Urgent: about 5 days of driving left");
    expect(alertSpoken({ severity: "P2", days_to_failure: null })).toBe("Soon");
  });
});

describe("confidence, in words", () => {
  it.each([[0.95, "Very likely"], [0.83, "Likely"], [0.6, "Possible"], [0.3, "Unlikely"]])(
    "%s is %s", (p, words) => expect(confidence(p).words).toBe(words));

  it("rounds to a whole percent", () => {
    expect(confidence(0.834).percent).toBe("83%");
  });

  it("has nothing to say without a number", () => {
    expect(confidence(null)).toBeNull();
    expect(confidence(undefined)).toBeNull();
  });
});

describe("the trend sentence", () => {
  it("names the reading and its direction when the readings show it", () => {
    expect(trendSentence("water_pump", [92, 97, 104])).toBe("Your coolant temperature has been climbing over the last 24 hours.");
    expect(trendSentence("battery", [12.6, 12.4, 12.1])).toBe("Your battery voltage has been falling over the last 24 hours.");
  });

  it("does not claim a drift the readings do not show", () => {
    expect(trendSentence("water_pump", [104, 97, 92])).toBe(
      "Your coolant temperature has held steady over the last 24 hours — the model's call rests on earlier readings.");
  });

  it("claims nothing without readings", () => {
    expect(trendSentence("water_pump", [])).toBeNull();
    expect(trendSentence("water_pump", [92])).toBeNull();
    expect(trendSentence("timing_belt", [1, 2, 3])).toBeNull();
  });
});

describe("shared owner copy", () => {
  it("is one set of words for the phone, the web owner app and the car", () => {
    expect(OWNER.failsOnRoad).toBe("If it fails on the road");
    expect(OWNER.healthyTitle).toBe("Everything reads normal");
    expect(OWNER.nothingBooked).toBe("Nothing is booked without your yes");
  });
});
