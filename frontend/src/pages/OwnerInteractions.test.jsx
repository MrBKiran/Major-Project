/**
 * What the owner can now do inside the app, end to end: try the decision, open a reading, scrub the
 * evidence, reorder the history and take a booking away with them. The server is faked.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), upload: vi.fn() } }));

const { api } = await import("../api.js");
const { default: OwnerApp } = await import("./OwnerApp.jsx");

Element.prototype.scrollIntoView = vi.fn();

const VIN = "MH12AB1001";
const hour = (h) => new Date(Date.UTC(2026, 10, 23, 12) - h * 3_600_000).toISOString();

// Twenty-four hourly readings, oldest first: coolant climbing 80 → 97.
const SERIES = Array.from({ length: 24 }, (_, i) => ({
  ts: hour(23 - i), drive_state: "DRIVING", coolant_temp: 80 + i * 0.75, lub_oil_pressure: 3.1,
  battery_voltage: 13.9, fuel_pressure: 3.4, brake_fluid_pct: 92, speed: 54,
}));

const WATER_PUMP = { component: "water_pump", severity: "P2", days_to_failure: 9, failure_prob: 0.9 };
const PAIR = { repair_inr: 2400, breakdown_inr: 18500 };
const HISTORY = [
  { date: "2026-02-18", service_type: "brake_pad_replace", cost: 3100, km_at_service: 124900, components_replaced: ["brake_pads"] },
  { date: "2025-11-02", service_type: "periodic_service", cost: 4200, km_at_service: 118200, components_replaced: [] },
  { date: "2025-06-10", service_type: "tyre_rotation", cost: 800, km_at_service: 112000, components_replaced: [] },
];
const BOOKED = {
  appointment_id: "APT-9", center_id: "SC-PUN-02", center_name: "Hero-M&M Service, Kothrud", city: "Pune",
  slot_start: "2026-11-23T11:00:00+05:30", status: "booked",
};

function serve({ predictions = [], alert = null, economics = null, booking = null, series = SERIES, history = HISTORY } = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/api/fleet") return Promise.resolve({ vehicles: [{ vin: VIN, severity: predictions[0]?.severity ?? null }] });
    if (path === `/api/vehicle/${VIN}`) {
      return Promise.resolve({
        vehicle: { vin: VIN, model: "Bolero", odometer: 128400 },
        series, predictions, maintenance_history: history, dtc_codes: [],
      });
    }
    if (path === `/api/vehicles/${VIN}/service`) {
      return Promise.resolve({ vin: VIN, model: "Bolero", city: "Pune", alert, economics, booking, slots: [] });
    }
    if (path === "/api/assistant/thread") return Promise.resolve({ turns: [], pending_action: null });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}
const warning = (over = {}) => serve({
  predictions: [WATER_PUMP], alert: { component: "water_pump", severity: "P2", days_to_failure: 9 }, economics: PAIR, ...over,
});

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); api.del.mockReset(); api.upload.mockReset();
  api.post.mockResolvedValue({ reply: "Ok.", pending_action: null, done: null });
});

describe("what if I wait?", () => {
  it("is on the warning card, closed, and opens into the calculator", async () => {
    warning();
    render(<OwnerApp />);
    const open = await screen.findByRole("button", { name: "What if I wait?" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();

    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Hide: what if I wait?" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radiogroup", { name: "When to fix it" })).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByText("You would pay")).toBeInTheDocument();
  });

  it("is not offered when the server has no figures to try it with", async () => {
    warning({ economics: null });
    render(<OwnerApp />);
    await screen.findByText(/your water pump is wearing out/i);
    expect(screen.queryByRole("button", { name: "What if I wait?" })).not.toBeInTheDocument();
  });
});

describe("readings you can open", () => {
  it("a reading on the healthy phone card opens to its lowest, average and highest", async () => {
    serve();
    render(<OwnerApp standalone />);
    const reading = await screen.findByRole("button", { name: /Coolant temperature/ });
    expect(reading).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reading);
    expect(reading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Lowest")).toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(screen.getByText("Highest")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Coolant temperature over the last 24 hours/ })).toBeInTheDocument();
  });

  it("opening another reading replaces the first, and pressing it again closes it", async () => {
    serve();
    render(<OwnerApp standalone />);
    fireEvent.click(await screen.findByRole("button", { name: /Coolant temperature/ }));
    fireEvent.click(screen.getByRole("button", { name: /Oil pressure/ }));
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getByRole("slider", { name: /Oil pressure/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Oil pressure/, expanded: true }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("asking about a reading opens the assistant already asking, and sends it once", async () => {
    serve();
    render(<OwnerApp standalone />);
    fireEvent.click(await screen.findByRole("button", { name: /Coolant temperature/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask about this reading" }));
    await screen.findByText("Is my coolant temperature normal?");
    expect(api.post.mock.calls.filter(([p]) => p === "/api/assistant/message")).toEqual([
      ["/api/assistant/message", { message: "Is my coolant temperature normal?", channel: "text", vin: VIN }],
    ]);
  });
});

describe("the evidence", () => {
  async function evidence() {
    warning();
    render(<OwnerApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Why this part?" }));
    await screen.findByText("Why we think so");
  }

  it("can be read off a point at a time, with the time of each", async () => {
    await evidence();
    const chart = screen.getByRole("slider", { name: /over the last 24 hours/ });
    expect(chart).toHaveAttribute("aria-valuemax", "23");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(chart.getAttribute("aria-valuetext")).toMatch(/^80\.0°C at \d+:\d\d$/);
  });

  it("narrows to the last six hours when asked", async () => {
    await evidence();
    expect(screen.getByRole("radio", { name: "Last 24 hours" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Last 6 hours" }));
    const chart = screen.getByRole("slider", { name: /over the last 6 hours/ });
    expect(chart).toHaveAttribute("aria-valuemax", "6");            // seven hourly points, 6 hours back
  });
});

describe("history", () => {
  async function history() {
    serve();
    render(<OwnerApp />);
    fireEvent.click(await screen.findByRole("button", { name: /All service history/i }));
    await screen.findByText("Service history");
  }
  const order = () => screen.getAllByText(/^(Brake pad replace|Periodic service|Tyre rotation)$/).map((e) => e.textContent);

  it("adds up what has been spent and says how many visits", async () => {
    await history();
    expect(screen.getByText("3 visits · spent in total")).toBeInTheDocument();
    expect(screen.getAllByText("₹8,100").length).toBeGreaterThan(0);          // 3,100 + 4,200 + 800
  });

  it("lists newest first, and the costliest first when asked", async () => {
    await history();
    expect(order()).toEqual(["Brake pad replace", "Periodic service", "Tyre rotation"]);
    fireEvent.click(screen.getByRole("radio", { name: "Costliest first" }));
    expect(order()).toEqual(["Periodic service", "Brake pad replace", "Tyre rotation"]);
    fireEvent.click(screen.getByRole("radio", { name: "Newest first" }));
    expect(order()).toEqual(["Brake pad replace", "Periodic service", "Tyre rotation"]);
  });
});

describe("a booking you can take with you", () => {
  async function receipt() {
    serve({ booking: BOOKED });
    render(<OwnerApp />);
    fireEvent.click(await screen.findByText(/Hero-M&M Service, Kothrud/));
    await screen.findByRole("button", { name: "Add to calendar" });
  }

  it("links the centre on a map in a new tab", async () => {
    await receipt();
    const link = screen.getByRole("link", { name: "Directions" });
    expect(link).toHaveAttribute("href", expect.stringContaining("google.com/maps/search"));
    expect(link.getAttribute("href")).toContain(encodeURIComponent("Hero-M&M Service, Kothrud, Pune"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("hands over a calendar file for the appointment, and says so", async () => {
    await receipt();
    const made = [];
    URL.createObjectURL = vi.fn((blob) => { made.push(blob); return "blob:ics"; });
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(made).toHaveLength(1);
    expect(made[0].type).toContain("text/calendar");
    expect(await made[0].text()).toContain("DTSTART:20261123T053000Z");
    expect(await screen.findByText(/Calendar file ready/)).toBeInTheDocument();
  });

  it("copies the booking number, and says so", async () => {
    await receipt();
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy booking number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("APT-9"));
    expect(await screen.findByText("Booking number copied")).toBeInTheDocument();
  });

  it("shows the number instead when the browser will not copy it", async () => {
    await receipt();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    fireEvent.click(screen.getByRole("button", { name: "Copy booking number" }));
    expect(await screen.findByText("Booking number: APT-9")).toBeInTheDocument();
  });
});

describe("while the car loads", () => {
  it("runs the brand mark's road as well as showing grey blocks", async () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<OwnerApp standalone />);
    const status = await screen.findByRole("status");
    expect(within(status).getByText(/loading your car/i)).toBeInTheDocument();
    expect(status.querySelector(".brand-mark.is-loading")).toBeInTheDocument();
  });
});
