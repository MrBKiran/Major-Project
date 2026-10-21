/**
 * The web head unit, rebuilt on the server's car screen (Phase 3).
 *
 * Before: it chose its own drive state and sent it to /api/console/demo, showed
 * a hard-coded "Tue 09:30 · Rajkot" slot for cars nowhere near Rajkot, quoted
 * repair costs from a table that had two components wrong, and its Book button
 * changed nothing but local state. Now everything it shows comes from
 * GET /api/car/{vin}/screen, and booking goes through POST /api/car/{vin}/book.
 *
 * Also kept from the screenshot baseline: before the screen arrives it must not
 * render the healthy screen ("All systems nominal") — a car with a P1 fault
 * would tell its driver everything was fine for the length of a request.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSlot } from "@autosaarthi/core";

vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const { api } = await import("../api.js");
const { default: InCarConsole, ConsoleBody, Verdict, POLL_MS } = await import("./InCarConsole.jsx");

const VIN = "MH12AB1002";
const SLOT = {
  center_id: "SC-MUM-01", center_name: "Andheri Service Centre", city: "Mumbai",
  slot_start: "2026-10-22T09:30:00+05:30", slot_end: "2026-10-22T10:30:00+05:30",
};
const LATER = { ...SLOT, slot_start: "2026-10-23T11:00:00+05:30", slot_end: "2026-10-23T12:00:00+05:30" };

const parked = (over = {}) => ({
  vin: VIN, model: "XUV700", odometer: 41200, city: "Mumbai",
  drive: { state: "PARKED", basis: "telemetry", speed_kmph: 0, observed_at: "2026-10-20T10:00:00+00:00" },
  allowed: { touch: true, slots: true, max_elements: null },
  alert: { component: "battery", severity: "P2", days_to_failure: 6 },
  economics: { repair_inr: 5200, breakdown_inr: 9000 },
  booking: null,
  slots: [SLOT, LATER],
  controls: { drive_state: false },
  ...over,
});
const moving = (over = {}) => parked({
  drive: { state: "DRIVING", basis: "telemetry", speed_kmph: 68, observed_at: "2026-10-20T10:00:00+00:00" },
  allowed: { touch: false, slots: false, max_elements: 1 },
  slots: [],
  ...over,
});
const booked = () => parked({
  slots: [],
  booking: { appointment_id: "APT1", center_id: SLOT.center_id, center_name: SLOT.center_name,
             city: "Mumbai", slot_start: SLOT.slot_start, status: "booked" },
});

const body = (s, props = {}) => render(
  <ConsoleBody night={false} screen={s} slot={s?.slots?.[0]} onBook={() => {}}
               onOtherTime={() => {}} {...props} />,
);

// ── the screen, from the server's answer alone ───────────────────────────────

describe("head unit before the screen arrives", () => {
  it("does not claim the car is healthy", () => {
    body(null);
    expect(screen.queryByText(/everything reads normal/i)).not.toBeInTheDocument();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it("shows the healthy screen once the server says there is nothing to raise", () => {
    body(parked({ alert: null, economics: null, slots: [] }));
    expect(screen.getByText("Everything reads normal")).toBeInTheDocument();
    expect(screen.queryByText(/nominal/i)).not.toBeInTheDocument();
  });
});

describe("parked", () => {
  it("quotes the server's costs, not a table in the page", () => {
    body(parked());
    expect(screen.getByText(/your battery is wearing out/i)).toBeInTheDocument();
    expect(screen.getByText("₹5,200")).toBeInTheDocument();
    expect(screen.getByText("₹9,000")).toBeInTheDocument();
  });

  it("invents no costs when the server has none", () => {
    body(parked({ economics: null }));
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("offers the slot the server found, in the car's own city", () => {
    body(parked());
    expect(screen.getByText(`${formatSlot(SLOT.slot_start)} · Mumbai`)).toBeInTheDocument();
    expect(screen.queryByText(/rajkot/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Book ${formatSlot(SLOT.slot_start)}` })).toBeEnabled();
  });

  it("books the slot on show", () => {
    const onBook = vi.fn();
    body(parked(), { onBook });
    fireEvent.click(screen.getByRole("button", { name: /^book/i }));
    expect(onBook).toHaveBeenCalledWith(SLOT);
  });

  it("has no tap target when the server says touch is not allowed", () => {
    // Laid out as parked, but the verdict wins: no client-side `if (parked)`.
    // Slots present, so only the verdict can be what disables the button.
    body(parked({ allowed: { touch: false, slots: true, max_elements: null } }));
    expect(screen.getByRole("button", { name: /^book/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /other times/i })).toBeDisabled();
  });

  it("says why a booking was refused", () => {
    body(parked(), { refusal: "that slot is no longer free" });
    expect(screen.getByText(/that slot is no longer free/i)).toBeInTheDocument();
  });

  it("shows a booking that exists instead of offering another", () => {
    body(booked());
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(`${formatSlot(SLOT.slot_start)} · Andheri Service Centre`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^book/i })).not.toBeInTheDocument();
  });
});

describe("in the driver's words", () => {
  // The driver is the owner: the same words as the phone and the web owner app.
  it("says how urgent when parked, without the staff code", () => {
    body(parked());
    expect(screen.getByText("Soon · 6 days")).toBeInTheDocument();
    expect(screen.queryByText(/P2/)).not.toBeInTheDocument();
    expect(screen.getByText("If it fails on the road")).toBeInTheDocument();
  });

  it("says how urgent in the one line it has while driving", () => {
    body(moving());
    expect(screen.getByText("Soon")).toBeInTheDocument();
    expect(screen.queryByText(/P2/)).not.toBeInTheDocument();
  });
});

describe("in motion", () => {
  it("is one line with nothing to tap", () => {
    body(moving());
    expect(screen.getByText(/battery service needed/i)).toBeInTheDocument();
    expect(screen.queryByText(formatSlot(SLOT.slot_start), { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /book service/i })).toBeDisabled();
  });

  it("at a brief stop offers no tap targets the guard would refuse", () => {
    body(moving({ drive: { state: "STOPPED_BRIEF", basis: "telemetry", speed_kmph: 0 } }));
    expect(screen.getByText(/details when you park/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("part names", () => {
  // The headline is the first line the owner reads, so the verb has to agree
  // with the part — and a part the page has never heard of still reads as words.
  const alerting = (component, state, days = 3) => {
    const alert = { component, severity: "P1", days_to_failure: days };
    if (state === "PARKED") return parked({ alert });
    if (state === "DRIVING") return moving({ alert });
    return moving({ alert, drive: { state, basis: "telemetry", speed_kmph: 0 } });
  };

  it("says a plural part are wearing out when parked", () => {
    body(alerting("brake_pads", "PARKED"));
    expect(screen.getByRole("heading")).toHaveTextContent(/^Your brake pads are wearing out$/);
  });

  it("says a plural part need service at a brief stop", () => {
    body(alerting("brake_pads", "STOPPED_BRIEF"));
    expect(screen.getByRole("heading")).toHaveTextContent(/^Brake pads need service within 3 days$/);
  });

  it("says a singular part needs service today when failure is hours away", () => {
    body(alerting("water_pump", "STOPPED_BRIEF", 0.3));
    expect(screen.getByRole("heading")).toHaveTextContent(/^Water pump needs service today$/);
  });

  it("names a part it has no label for in words when parked", () => {
    body(alerting("timing_belt", "PARKED"));
    expect(screen.getByRole("heading")).toHaveTextContent(/^Your timing belt is wearing out$/);
  });

  it("names a part it has no label for in words at a brief stop", () => {
    body(alerting("timing_belt", "STOPPED_BRIEF"));
    expect(screen.getByRole("heading")).toHaveTextContent(/^Timing belt needs service within 3 days$/);
  });

  it("names a part it has no label for in words while driving", () => {
    body(alerting("timing_belt", "DRIVING"));
    expect(screen.getByText(/^Timing belt service needed within 3 days\./)).toBeInTheDocument();
  });
});

describe("what the server decided", () => {
  it("explains a missing reading as being treated as moving", () => {
    render(<Verdict screen={moving({ drive: { state: "DRIVING", basis: "none", speed_kmph: null } })} />);
    expect(screen.getByText(/no reading from the car/i)).toBeInTheDocument();
    expect(screen.getByText(/treated as moving/i)).toBeInTheDocument();
  });

  it("explains a stale reading the same way", () => {
    render(<Verdict screen={moving({ drive: { state: "DRIVING", basis: "stale", speed_kmph: 0 } })} />);
    expect(screen.getByText(/no fresh reading/i)).toBeInTheDocument();
  });

  it("names the rules that shaped the screen", () => {
    render(<Verdict screen={moving()} />);
    expect(screen.getByText(/tap targets/i).closest("div")).toHaveTextContent(/blocked.*G6/i);
    expect(screen.getByText(/slot list/i).closest("div")).toHaveTextContent(/not sent/i);
    expect(screen.getByText(/elements/i).closest("div")).toHaveTextContent(/1.*G7/i);
  });
});

// ── the page: fetching, booking, the demo's drive-state control ─────────────

describe("the console page", () => {
  let current;

  beforeEach(() => {
    current = parked();
    api.get.mockReset().mockImplementation((path) => Promise.resolve(
      path === "/api/fleet"
        ? { vehicles: [{ vin: "KA03KL1008", model: "Nexon", severity: null },
                       { vin: VIN, model: "XUV700", severity: "P2" }] }
        : current));
    api.post.mockReset().mockImplementation((path, payload) => {
      if (path.endsWith("/book")) { current = booked(); return Promise.resolve({ booked: true }); }
      if (path.endsWith("/simulate")) {
        const keep = { controls: current.controls };
        current = payload.drive_state === "DRIVING" ? moving(keep) : parked(keep);
        return Promise.resolve({ state: payload.drive_state });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    expect(api.post.mock.calls.map((c) => c[0])).not.toContain("/api/console/demo");
  });

  it("asks the server for the screen of a car that has something to say", async () => {
    render(<InCarConsole />);
    expect(await screen.findByText(/your battery is wearing out/i)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/api/car/${VIN}/screen`);
  });

  it("books through the server and then shows the booking", async () => {
    render(<InCarConsole />);
    fireEvent.click(await screen.findByRole("button", { name: `Book ${formatSlot(SLOT.slot_start)}` }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/api/car/${VIN}/book`, { center_id: SLOT.center_id, slot_start: SLOT.slot_start }));
    expect(await screen.findByText(/confirmed/i)).toBeInTheDocument();
  });

  it("offers the next slot on Other times", async () => {
    render(<InCarConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /other times/i }));
    fireEvent.click(screen.getByRole("button", { name: `Book ${formatSlot(LATER.slot_start)}` }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/api/car/${VIN}/book`, { center_id: LATER.center_id, slot_start: LATER.slot_start }));
  });

  it("never shows one car's screen for another", async () => {
    // A slow answer about the car just switched away from must not land on
    // the new one: a parked screen for a car that is moving is the hazard.
    let answerSlowly;
    api.get.mockImplementation((path) => {
      if (path === "/api/fleet") return Promise.resolve({ vehicles: [
        { vin: VIN, model: "XUV700", severity: "P2" }, { vin: "KA03KL1008", model: "Nexon", severity: null }] });
      if (path === `/api/car/${VIN}/screen`) return new Promise((resolve) => { answerSlowly = resolve; });
      return Promise.resolve(moving({ vin: "KA03KL1008" }));
    });
    render(<InCarConsole />);
    await waitFor(() => expect(answerSlowly).toBeDefined());
    fireEvent.change(screen.getByRole("combobox", { name: /vehicle/i }), { target: { value: "KA03KL1008" } });
    expect(await screen.findByText(/battery service needed/i)).toBeInTheDocument();
    await act(async () => answerSlowly(parked()));
    expect(screen.queryByText(/your battery is wearing out/i)).not.toBeInTheDocument();
    expect(screen.getByText(/battery service needed/i)).toBeInTheDocument();
  });

  it("shows the server's refusal when a booking does not go through", async () => {
    api.post.mockImplementation(() => Promise.reject(new Error("park the car to book")));
    render(<InCarConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /^book/i }));
    expect(await screen.findByText(/park the car to book/i)).toBeInTheDocument();
  });

  it("where the server offers the demo control, changes what the car reports and shows what the server makes of it", async () => {
    current = parked({ controls: { drive_state: true } });
    render(<InCarConsole />);
    await screen.findByText(/your battery is wearing out/i);
    fireEvent.click(screen.getByRole("button", { name: /^driving/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/api/car/${VIN}/simulate`, { drive_state: "DRIVING" }));
    expect(await screen.findByText(/battery service needed/i)).toBeInTheDocument();
  });

  it("where the server does not offer it, has no drive-state control at all", async () => {
    render(<InCarConsole />);
    await screen.findByText(/your battery is wearing out/i);
    expect(screen.queryByRole("button", { name: /^driving/i })).not.toBeInTheDocument();
    const rail = screen.getByRole("group", { name: /simulator/i });
    expect(within(rail).getByText(/reported by the car/i)).toBeInTheDocument();
  });

  it("shows the real time and nothing it does not know", async () => {
    // It showed a fixed 9:41 and "LTE fuel 46%" beside real telemetry.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-20T04:14:00Z") });   // 9:44 IST
    render(<InCarConsole />);
    await screen.findByText(/your battery is wearing out/i);
    expect(screen.getByText("9:44")).toBeInTheDocument();
    expect(screen.queryByText(/fuel|LTE/)).not.toBeInTheDocument();
  });

  it("shows the speed of a live reading", async () => {
    current = moving();
    render(<InCarConsole />);
    await screen.findByText(/battery service needed/i);
    expect(screen.getByText("km/h").parentElement).toHaveTextContent("68km/h");
  });

  it("shows no speed from a reading too old to describe the car now", async () => {
    // "0 km/h" beside a locked, moving screen reads as a contradiction.
    current = moving({ drive: { state: "DRIVING", basis: "stale", speed_kmph: 0 } });
    render(<InCarConsole />);
    await screen.findByText(/battery service needed/i);
    expect(screen.queryByText("km/h")).not.toBeInTheDocument();
  });

  it("asks again on its own, so a reading that goes stale turns into 'moving'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<InCarConsole />);
    await screen.findByText(/your battery is wearing out/i);
    current = moving({ drive: { state: "DRIVING", basis: "stale", speed_kmph: 0 } });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText(/battery service needed/i)).toBeInTheDocument();
  });
});
