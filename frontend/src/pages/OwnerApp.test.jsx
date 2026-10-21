import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatSlot } from "@autosaarthi/core";

const logout = vi.fn();
vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ logout }) }));
vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const { api } = await import("../api.js");
const { default: OwnerApp, HealthyCard } = await import("./OwnerApp.jsx");

const VIN = "MH12AB1001";
const SERVICE_PATH = `/api/vehicles/${VIN}/service`;

const reading = (over) => ({
  ts: "2026-10-20T08:00:00Z", drive_state: "DRIVING", coolant_temp: 88, lub_oil_pressure: 3.1,
  battery_voltage: 13.9, fuel_pressure: 3.4, brake_fluid_pct: 92, speed: 54, ...over,
});

const detail = (over = {}) => ({
  vehicle: { vin: VIN, model: "Bolero", odometer: 128400 },
  series: [], predictions: [], maintenance_history: [], dtc_codes: [], ...over,
});
const service = (over = {}) => ({
  vin: VIN, model: "Bolero", city: "Pune", alert: null, economics: null, booking: null, slots: [], ...over,
});

/** What the backend would answer for this owner's one car. `service` may be
 *  an Error, for a /service read that fails. */
function serve({ detail: d = detail(), service: s = service() } = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/api/fleet") return Promise.resolve({ vehicles: [{ vin: VIN, severity: null }] });
    if (path === `/api/vehicle/${VIN}`) return Promise.resolve(d);
    if (path === SERVICE_PATH) return s instanceof Error ? Promise.reject(s) : Promise.resolve(s);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

// The agent screen keeps the newest message in view; jsdom does no layout.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  serve();
});

describe("healthy card", () => {
  it("names the signals in words, not column names", () => {
    render(<HealthyCard detail={{ series: [reading(), reading({ coolant_temp: 89 })] }} />);
    expect(screen.getByText("Oil pressure")).toBeInTheDocument();
    expect(screen.getByText("Brake fluid level")).toBeInTheDocument();
    expect(screen.queryByText(/pct|lub oil|_/)).not.toBeInTheDocument();
  });

  it("with no recent readings, says so instead of drawing six empty bars", () => {
    // Empty sparklines read as a page still loading — on the screen whose
    // whole message is "nothing is wrong".
    render(<HealthyCard detail={{ series: [] }} />);
    expect(screen.getByText(/no recent readings/i)).toBeInTheDocument();
    expect(screen.queryByText("Oil pressure")).not.toBeInTheDocument();
  });
});

describe("signing out on the phone", () => {
  beforeEach(() => logout.mockClear());

  it("is possible: the owner app on its own has a sign-out", async () => {
    render(<OwnerApp standalone />);
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("is not offered in the console's preview of the phone, which has its own", async () => {
    render(<OwnerApp />);
    await screen.findByText(/everything reads normal/i);
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});

// A battery is where the old in-page table and vehicles.yaml disagreed
// (₹4,200 / ₹14,000 against ₹5,200 / ₹9,000) — the screen said one pair while
// the agent, in the same conversation, said the other.
const BATTERY = { component: "battery", severity: "P1", days_to_failure: 6, failure_prob: 0.81 };
const BATTERY_ALERT = { component: "battery", severity: "P1", days_to_failure: 6 };
const SERVER_PAIR = { repair_inr: 5200, breakdown_inr: 9000 };

function alertFor(prediction, serviceOver = {}) {
  serve({
    detail: detail({ predictions: [prediction] }),
    service: service({ alert: BATTERY_ALERT, economics: SERVER_PAIR, ...serviceOver }),
  });
}

/** Through the agent to the receipt: the agent confirms a booking on start. */
function bookOnStart() {
  api.post.mockResolvedValue({
    turns: [], run_id: "run-1", plan: null, offered_slots: [], objections_handled: [],
    booking: { booked: true, slot_start: "2026-10-24T04:30:00+00:00", center_id: "SC-PUN-01", appointment_id: "APT-9" },
  });
}

describe("what a repair costs", () => {
  it("asks the server for this car's service view", async () => {
    alertFor(BATTERY);
    render(<OwnerApp />);
    await screen.findByText(/your battery is wearing out/i);
    expect(api.get).toHaveBeenCalledWith(SERVICE_PATH);
  });

  it("quotes the server's pair on the alert, not a table in the page", async () => {
    alertFor(BATTERY);
    render(<OwnerApp />);
    expect(await screen.findByText("₹5,200")).toBeInTheDocument();
    expect(screen.getByText("₹9,000")).toBeInTheDocument();
    expect(screen.queryByText("₹4,200")).not.toBeInTheDocument();
  });

  it("quotes the same pair when the owner asks why this part", async () => {
    alertFor(BATTERY);
    render(<OwnerApp />);
    await screen.findByText("₹5,200");
    fireEvent.click(screen.getByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText("Why we think so")).toBeInTheDocument();
    expect(screen.getByText("₹5,200")).toBeInTheDocument();
    expect(screen.getByText("₹9,000")).toBeInTheDocument();
  });

  it("puts the server's repair cost on the receipt as the estimate", async () => {
    alertFor(BATTERY);
    bookOnStart();
    render(<OwnerApp />);
    await screen.findByText("₹5,200");
    fireEvent.click(screen.getByRole("button", { name: "Book a service" }));
    expect(await screen.findByText("Estimate")).toBeInTheDocument();
    expect(screen.getByText("₹5,200")).toBeInTheDocument();
  });

  describe("when the server has no figures", () => {
    // Not a guess like ₹3,000 / ₹20,000: an invented number on the screen that
    // argues for a repair is worse than none.
    beforeEach(() => alertFor(BATTERY, { economics: null }));

    it("the alert names the part and quotes nothing", async () => {
      render(<OwnerApp />);
      await screen.findByText(/your battery is wearing out/i);
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
      expect(screen.queryByText("Repair now")).not.toBeInTheDocument();
    });

    it("why-this-part quotes nothing", async () => {
      render(<OwnerApp />);
      fireEvent.click(await screen.findByRole("button", { name: "Why this part?" }));
      await screen.findByText("Why we think so");
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    });

    it("the receipt has no estimate", async () => {
      bookOnStart();
      render(<OwnerApp />);
      fireEvent.click(await screen.findByRole("button", { name: "Book a service" }));
      expect(await screen.findByText("Confirmed")).toBeInTheDocument();
      expect(screen.queryByText("Estimate")).not.toBeInTheDocument();
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    });
  });

  it("does not quote one part's costs on another part's alert", async () => {
    // The two reads are separate; if they disagree on which part is failing,
    // the battery's price under a water-pump headline would be wrong.
    alertFor({ component: "water_pump", severity: "P1", days_to_failure: 4, failure_prob: 0.7 });
    render(<OwnerApp />);
    await screen.findByText(/your water pump is wearing out/i);
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("still shows the alert, without costs, if the service view cannot be read", async () => {
    serve({ detail: detail({ predictions: [BATTERY] }), service: new Error("503 unavailable") });
    render(<OwnerApp />);
    expect(await screen.findByText(/your battery is wearing out/i)).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });
});

// The server's record of the car's next appointment (owner_service.booking_for).
const UPCOMING = {
  appointment_id: "APT-41", center_id: "SC-PUN-01", center_name: "Hero-M&M Service, Kothrud",
  city: "Pune", slot_start: "2026-10-24T10:00:00+05:30", status: "booked",
};

describe("a booking the server already has", () => {
  // Booked from the car, from the mobile app, or here before a reload — the
  // phone must not offer to book a service that is already booked.
  it("shows as confirmed on load, not as an offer to book", async () => {
    alertFor(BATTERY, { booking: UPCOMING });
    render(<OwnerApp />);
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText(formatSlot(UPCOMING.slot_start))).toBeInTheDocument();
    expect(screen.getByText(/Hero-M&M Service, Kothrud/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book a service" })).not.toBeInTheDocument();
  });

  it("opens a receipt with its slot, centre and reference", async () => {
    alertFor(BATTERY, { booking: UPCOMING });
    render(<OwnerApp />);
    fireEvent.click(await screen.findByRole("button", { name: /tap for the receipt/i }));
    expect(await screen.findByText("Booking")).toBeInTheDocument();
    expect(screen.getByText(formatSlot(UPCOMING.slot_start))).toBeInTheDocument();
    expect(screen.getByText("Hero-M&M Service, Kothrud")).toBeInTheDocument();
    expect(screen.getByText("APT-41")).toBeInTheDocument();
  });

  it("does not call a held slot confirmed", async () => {
    // A hold is the first half of booking; until the centre confirms it the
    // owner has not got a service.
    alertFor(BATTERY, { booking: { ...UPCOMING, status: "held" } });
    render(<OwnerApp />);
    expect(await screen.findByRole("button", { name: "Book a service" })).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("with no booking, the alert still offers one", async () => {
    alertFor(BATTERY, { booking: null });
    render(<OwnerApp />);
    expect(await screen.findByRole("button", { name: "Book a service" })).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("with no booking and nothing wrong, stays the quiet screen", async () => {
    render(<OwnerApp />);
    expect(await screen.findByText(/everything reads normal/i)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("is shown for a healthy car too", async () => {
    // Nothing failing, but a service is still booked — home says when.
    serve({ service: service({ booking: UPCOMING }) });
    render(<OwnerApp />);
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/everything reads normal/i)).not.toBeInTheDocument();
  });
});

describe("a booking made with the agent in this visit", () => {
  it("is on home when the owner goes back, before the server's view has it", async () => {
    alertFor(BATTERY);
    bookOnStart();
    render(<OwnerApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Book a service" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to my car" }));
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText(formatSlot("2026-10-24T04:30:00+00:00"))).toBeInTheDocument();
    expect(screen.getByText(/SC-PUN-01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book a service" })).not.toBeInTheDocument();
  });

  it("takes the centre's name from the server once the view is read again", async () => {
    // The agent's confirmation carries only the centre's id; the re-read
    // after booking has the same appointment with its name.
    alertFor(BATTERY);
    bookOnStart();
    render(<OwnerApp />);
    await screen.findByText("₹5,200");
    alertFor(BATTERY, {
      booking: { ...UPCOMING, appointment_id: "APT-9", slot_start: "2026-10-24T10:00:00+05:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Book a service" }));
    expect(await screen.findByText("Hero-M&M Service, Kothrud")).toBeInTheDocument();
    expect(screen.getByText("APT-9")).toBeInTheDocument();
  });
});

describe("an owner's words, shared with the phone and the car", () => {
  it("says how urgent in words, not the staff code", async () => {
    alertFor(BATTERY);
    render(<OwnerApp />);
    expect(await screen.findByText("Urgent · 6 days")).toBeInTheDocument();
    expect(screen.queryByText(/P1/)).not.toBeInTheDocument();
  });

  it("labels the costs and actions as the phone does", async () => {
    alertFor(BATTERY);
    render(<OwnerApp />);
    expect(await screen.findByText("If it fails on the road")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk to the agent" })).toBeInTheDocument();
    expect(screen.getByText("Nothing is booked without your yes")).toBeInTheDocument();
  });
});

describe("why this part, in words", () => {
  function explain(prediction, series) {
    serve({ detail: detail({ predictions: [prediction], series }) });
    render(<OwnerApp />);
  }

  it("names the reading that shows the wear and which way it drifts", async () => {
    explain({ component: "brake_pads", severity: "P2", days_to_failure: 12, failure_prob: 0.64 },
      [reading({ brake_fluid_pct: 94 }), reading({ brake_fluid_pct: 91 })]);
    expect(await screen.findByText(/your brake pads are wearing out/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText("Brake pads")).toBeInTheDocument();
    expect(screen.getByText(/your brake fluid level has been falling/i)).toBeInTheDocument();
    expect(screen.getByText("91.0%")).toBeInTheDocument();
  });

  it("says a climbing reading climbs", async () => {
    explain({ component: "water_pump", severity: "P1", days_to_failure: 4, failure_prob: 0.7 },
      [reading({ coolant_temp: 96 }), reading({ coolant_temp: 104 })]);
    fireEvent.click(await screen.findByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText(/your coolant temperature has been climbing/i)).toBeInTheDocument();
    expect(screen.getByText("104.0°C")).toBeInTheDocument();
  });

  it("gives the model's confidence in words, not as a raw score", async () => {
    explain({ component: "brake_pads", severity: "P2", days_to_failure: 12, failure_prob: 0.64 }, []);
    fireEvent.click(await screen.findByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText("64%")).toBeInTheDocument();
    expect(screen.getByText(/possible/i)).toBeInTheDocument();
    expect(screen.queryByText("0.64")).not.toBeInTheDocument();
  });

  it("claims no drift the readings do not show", async () => {
    // It used to say "has been falling on an unchanged route" with no readings at all.
    explain({ component: "brake_pads", severity: "P2", days_to_failure: 12, failure_prob: 0.64 }, []);
    fireEvent.click(await screen.findByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText(/flagged this from your car's earlier readings/i)).toBeInTheDocument();
    expect(screen.queryByText(/falling|unchanged route|not weather/i)).not.toBeInTheDocument();
  });

  it("for a part it has no reading for, makes no claim about one", async () => {
    explain({ component: "timing_belt", severity: "P2", days_to_failure: 20, failure_prob: 0.55 }, [reading()]);
    expect(await screen.findByText(/your timing belt is wearing out/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why this part?" }));
    expect(await screen.findByText("Timing belt")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText("Why we think so")).not.toBeInTheDocument();
  });
});
