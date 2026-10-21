import { describe, expect, it } from "vitest";

import { COMPONENTS, componentLabel, componentSignal, wearingOut } from "./components.js";
import { SIGNALS } from "./signals.js";

describe("components", () => {
  it("names each part the way an owner says it", () => {
    expect(componentLabel("water_pump")).toBe("water pump");
    expect(componentLabel("brake_pads")).toBe("brake pads");
  });

  it("falls back to readable words for a part it does not know", () => {
    expect(componentLabel("timing_belt")).toBe("timing belt");
    expect(componentLabel(null)).toBe("");
  });

  it("agrees the verb with the part — 'brake pads are', 'water pump is'", () => {
    expect(wearingOut("brake_pads")).toBe("Your brake pads are wearing out");
    expect(wearingOut("water_pump")).toBe("Your water pump is wearing out");
  });

  it("knows which reading shows each part's wear, and which way it drifts", () => {
    expect(componentSignal("water_pump")).toEqual({ key: "coolant_temp", direction: "up" });
    expect(componentSignal("battery")).toEqual({ key: "battery_voltage", direction: "down" });
    expect(componentSignal("timing_belt")).toBeNull();
  });

  it("only points at readings the app knows how to label", () => {
    for (const { signal } of Object.values(COMPONENTS)) expect(SIGNALS[signal]).toBeDefined();
  });
});
