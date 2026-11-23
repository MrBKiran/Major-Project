/**
 * The owner app's interaction pieces, on their own: a number that travels, a switch with a sliding
 * thumb, a chart you can read off, the "what if I wait?" calculator, a toast, and the calendar file.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NightProvider } from "../../night.jsx";
import { Ticker } from "../../fx";
import { buildIcs, mapsUrl } from "./calendar.js";
import { ReadingDetail } from "./ReadingDetail.jsx";
import { ScrubChart } from "./ScrubChart.jsx";
import { Segmented } from "./Segmented.jsx";
import { ToastProvider, useToast } from "./Toast.jsx";
import { WaitCalc } from "./WaitCalc.jsx";

const withNight = (ui) => <NightProvider value={false}>{ui}</NightProvider>;

afterEach(() => vi.useRealTimers());

describe("Ticker", () => {
  it("shows the value, and says it once to a screen reader", () => {
    render(<Ticker value={18500} />);
    // One visible copy, one for assistive technology, both the real number.
    expect(screen.getAllByText("₹18,500")).toHaveLength(2);
    expect(document.querySelector('[aria-hidden="true"]')).toHaveTextContent("₹18,500");
    expect(document.querySelector(".sr-only")).toHaveTextContent("₹18,500");
  });

  it("follows the value when it changes, in the format it was given", () => {
    const { rerender } = render(<Ticker value={2400} format={(v) => `${Math.round(v)} days`} />);
    rerender(<Ticker value={7} format={(v) => `${Math.round(v)} days`} />);
    expect(screen.getAllByText("7 days")).toHaveLength(2);
  });
});

describe("Segmented", () => {
  function Harness() {
    const [value, setValue] = useState("now");
    return withNight(
      <Segmented
        label="When to fix it"
        value={value}
        onChange={setValue}
        options={[{ value: "now", label: "Fix it now" }, { value: "wait", label: "Wait" }]}
      />,
    );
  }

  it("is a radio group with one choice made", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "When to fix it" });
    const [now, wait] = within(group).getAllByRole("radio");
    expect(now).toHaveAttribute("aria-checked", "true");
    expect(wait).toHaveAttribute("aria-checked", "false");
  });

  it("changes the choice by click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Wait" }));
    expect(screen.getByRole("radio", { name: "Wait" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Fix it now" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves with the arrow keys, wrapping, and takes focus with it", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Fix it now" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Wait" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Wait" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Wait" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Fix it now" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("ScrubChart", () => {
  const values = [88, 90, 93, 97.2];
  const times = ["2026-11-23T04:00:00Z", "2026-11-23T05:00:00Z", "2026-11-23T06:00:00Z", "2026-11-23T07:00:00Z"];
  const chart = () => withNight(<ScrubChart values={values} times={times} unit="°C" label="Coolant over the last 24 hours" />);

  it("reads out the latest value first, as a slider", () => {
    render(chart());
    const slider = screen.getByRole("slider", { name: "Coolant over the last 24 hours" });
    expect(slider).toHaveAttribute("aria-valuetext", "97.2°C at 12:30, latest");
    expect(screen.getByText("97.2°C")).toBeInTheDocument();
  });

  it("steps through the readings with the arrow keys, with the time of each", () => {
    render(chart());
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "93.0°C at 11:30");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", "88.0°C at 9:30");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "97.2°C at 12:30");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");                 // cannot go past the last reading
  });

  it("goes back to the latest on Escape", () => {
    render(chart());
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(slider).toHaveAttribute("aria-valuetext", "97.2°C at 12:30, latest");
  });

  it("skips a missing reading rather than drawing it as zero", () => {
    render(withNight(<ScrubChart values={[88, null, 97.2]} unit="°C" label="Coolant" />));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "1");
  });

  it("draws nothing to scrub when there is not enough to draw", () => {
    render(withNight(<ScrubChart values={[88]} unit="°C" label="Coolant" />));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("ReadingDetail", () => {
  const rows = [88, 90, 94, 98].map((v, i) => ({ ts: `2026-11-23T0${4 + i}:00:00Z`, coolant_temp: v }));

  it("states only what the car reported: lowest, average, highest and the change", () => {
    render(withNight(<ReadingDetail signal="coolant_temp" rows={rows} onClose={() => {}} />));
    expect(screen.getByText("88.0°C")).toBeInTheDocument();     // lowest
    expect(screen.getAllByText("98.0°C").length).toBeGreaterThan(0);   // highest, and the latest on the chart
    expect(screen.getByText("92.5°C")).toBeInTheDocument();     // average of the four
    expect(screen.getByText(/up 10\.0°C since the window began/)).toBeInTheDocument();
    expect(screen.queryByText(/normal range/i)).not.toBeInTheDocument();
  });

  it("offers to ask the assistant, with the question already written, only where there is one to ask", () => {
    const onAsk = vi.fn();
    const { rerender } = render(withNight(<ReadingDetail signal="coolant_temp" rows={rows} onClose={() => {}} onAsk={onAsk} />));
    fireEvent.click(screen.getByRole("button", { name: "Ask about this reading" }));
    expect(onAsk).toHaveBeenCalledWith("Is my coolant temperature normal?");

    rerender(withNight(<ReadingDetail signal="coolant_temp" rows={rows} onClose={() => {}} />));
    expect(screen.queryByRole("button", { name: "Ask about this reading" })).not.toBeInTheDocument();
  });

  it("closes", () => {
    const onClose = vi.fn();
    render(withNight(<ReadingDetail signal="coolant_temp" rows={rows} onClose={onClose} />));
    fireEvent.click(screen.getByRole("button", { name: "Close coolant temperature" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("WaitCalc", () => {
  const PAIR = { repair_inr: 2400, breakdown_inr: 18500 };
  const total = () => screen.getByText(/You (would )?pay/).parentElement;

  it("opens on the day it is expected to fail, with the breakdown waiting", () => {
    render(withNight(<WaitCalc economics={PAIR} days={9} />));
    expect(screen.getByText("You would pay")).toBeInTheDocument();
    expect(within(total()).getAllByText("₹18,500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹16,100").length).toBeGreaterThan(0);          // 18,500 − 2,400, the extra
  });

  it("goes back to the repair price when the owner moves to a day before it", () => {
    render(withNight(<WaitCalc economics={PAIR} days={9} />));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(screen.getByText("You pay")).toBeInTheDocument();
    expect(within(total()).getAllByText("₹2,400").length).toBeGreaterThan(0);
    expect(screen.getByText(/every day is a bet that it holds/)).toBeInTheDocument();
  });

  it("speaks the position of the slider in days", () => {
    render(withNight(<WaitCalc economics={PAIR} days={9} />));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "1 day from now");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "no time from now");
  });

  it("fix it now: one price, no slider", () => {
    render(withNight(<WaitCalc economics={PAIR} days={9} />));
    fireEvent.click(screen.getByRole("radio", { name: "Fix it now" }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(within(total()).getAllByText("₹2,400").length).toBeGreaterThan(0);
    expect(screen.getByText(/the car stays on the road/)).toBeInTheDocument();
  });

  it("is plain that it is a prediction", () => {
    render(withNight(<WaitCalc economics={PAIR} days={9} />));
    expect(screen.getByText(/not a promise/)).toBeInTheDocument();
  });
});

describe("Toast", () => {
  function Button({ message = "Booking number copied" }) {
    const toast = useToast();
    return <button type="button" onClick={() => toast(message)}>go</button>;
  }

  it("announces a small result, and goes away by itself", async () => {
    vi.useFakeTimers();
    render(withNight(<ToastProvider><Button /></ToastProvider>));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Booking number copied")).toBeInTheDocument();
    expect(document.querySelector("[aria-live='polite']")).toContainElement(screen.getByText("Booking number copied"));

    await act(async () => { vi.advanceTimersByTime(3300); });
    await act(async () => { vi.advanceTimersByTime(1000); });     // the exit
    expect(screen.queryByText("Booking number copied")).not.toBeInTheDocument();
  });

  it("keeps at most three, the oldest making way", async () => {
    render(withNight(<ToastProvider><Button message="one" /><Button message="two" /></ToastProvider>));
    const [a, b] = screen.getAllByRole("button", { name: "go" });
    fireEvent.click(a); fireEvent.click(b); fireEvent.click(a); fireEvent.click(b);
    // The one made way for is still fading out for a moment, then it is gone.
    await vi.waitFor(() => expect(screen.getAllByText(/^(one|two)$/).length).toBeLessThanOrEqual(3));
  });

  it("goes when it is pressed", async () => {
    render(withNight(<ToastProvider><Button /></ToastProvider>));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    fireEvent.click(screen.getByText("Booking number copied"));
    await vi.waitFor(() => expect(screen.queryByText("Booking number copied")).not.toBeInTheDocument());
  });
});

describe("the calendar file", () => {
  const ics = buildIcs({
    uid: "APT-9",
    title: "Service: Water pump, Bolero",
    start: "2026-11-23T11:00:00+05:30",
    location: "Hero-M&M Service, Kothrud, Pune",
    description: "Booking APT-9; bring the key, and the service book.",
    now: new Date("2026-11-22T10:00:00Z"),
  });
  const lines = ics.split("\r\n");

  it("is a standard calendar file with the appointment in the right moment", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART:20261123T053000Z");          // 11:00 in India is 05:30 UTC
    expect(lines).toContain("DTEND:20261123T070000Z");            // ninety minutes later
    expect(lines).toContain("DTSTAMP:20261122T100000Z");
    expect(lines).toContain("UID:APT-9@autosaarthi");
    expect(lines).toContain("SUMMARY:Service: Water pump\\, Bolero");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes commas, semicolons and line breaks, which would otherwise end a field", () => {
    expect(ics).toContain("LOCATION:Hero-M&M Service\\, Kothrud\\, Pune");
    expect(ics).toContain("DESCRIPTION:Booking APT-9\\; bring the key\\, and the service book.");
  });

  it("reminds an hour before", () => {
    expect(lines).toContain("TRIGGER:-PT1H");
  });

  it("folds long lines at 75 characters, as the format requires", () => {
    const long = buildIcs({ uid: "x", title: "T", start: "2026-11-23T11:00:00+05:30", description: "word ".repeat(40) });
    for (const line of long.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });

  it("makes no file for a time that is not one", () => {
    expect(buildIcs({ uid: "x", title: "T", start: "soon" })).toBeNull();
  });

  it("links the centre on a map, safely encoded", () => {
    expect(mapsUrl("Hero-M&M Service, Kothrud, Pune"))
      .toBe("https://www.google.com/maps/search/?api=1&query=Hero-M%26M%20Service%2C%20Kothrud%2C%20Pune");
  });
});
