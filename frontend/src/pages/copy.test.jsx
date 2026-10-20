/**
 * The words on the screens: plurals, dates and labels the design audit caught
 * reading wrong ("1 days", "rate limit(s)", "scheduling_agent", a raw browser
 * timestamp, "OEM console" on the owner's own sign-in).
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
  api: { get: vi.fn(() => Promise.resolve({ methods: ["password", "phone_otp"] })), post: vi.fn() },
  getToken: vi.fn(() => null),
}));
vi.mock("../auth/AuthContext.jsx", () => ({
  useAuth: () => ({ can: () => false, status: "anon", error: null }),
}));

const { ConsoleBody } = await import("./InCarConsole.jsx");
const { NowCard } = await import("./OwnerApp.jsx");
const { PolicyCounts } = await import("./SecurityConsole.jsx");
const { AppointmentRow } = await import("./ServiceOps.jsx");
const { default: Login } = await import("./Login.jsx");

const oilPump = (days) => ({
  prediction: { component: "oil_pump", severity: "P1", days_to_failure: days }, steps: [],
});

function renderConsole(driveState, days) {
  return render(
    <ConsoleBody night={false} driveState={driveState} result={oilPump(days)} vin="KA03KL1008"
                 slotsAllowed={false} touchAllowed={false} booked={false} onBook={() => {}} />,
  );
}

describe("in-car console", () => {
  it("says 1 day when parked", () => {
    renderConsole("PARKED", 1);
    expect(screen.getByText(/About 1 day of driving left/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days/)).not.toBeInTheDocument();
  });

  it("says 1 day while driving", () => {
    renderConsole("DRIVING", 1);
    expect(screen.getByText(/service needed within 1 day\./)).toBeInTheDocument();
  });

  it("says 1 day at a brief stop", () => {
    // Anchored: /within 1 day/ alone also matches "within 1 days" — the first
    // version of this test passed against the bug for exactly that reason.
    renderConsole("STOPPED_BRIEF", 1);
    expect(screen.getByText(/needs service within 1 day$/)).toBeInTheDocument();
  });

  it("does not promise 0 days when failure is hours away", () => {
    renderConsole("PARKED", 0.3);
    expect(screen.getByText(/Less than a day of driving left/)).toBeInTheDocument();
    expect(screen.queryByText(/0 days/)).not.toBeInTheDocument();
  });
});

describe("owner app alert", () => {
  it("says 1 day", () => {
    render(<NowCard top={{ component: "water_pump", severity: "P1", days_to_failure: 1 }} go={() => {}} />);
    expect(screen.getByText(/About 1 day of driving left/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days/)).not.toBeInTheDocument();
  });
});

describe("security console policy counts", () => {
  const agent = (limits) => ({ allow: ["a", "b"], deny: ["c"], rate_limits: limits });

  it("says one rate limit", () => {
    render(<PolicyCounts agent={agent({ "llm.persuade": "5/min" })} />);
    expect(screen.getByText("1 rate limit")).toBeInTheDocument();
  });

  it("says two rate limits", () => {
    render(<PolicyCounts agent={agent({ a: "1/min", b: "2/min" })} />);
    expect(screen.getByText("2 rate limits")).toBeInTheDocument();
  });
});

describe("service ops appointment row", () => {
  const row = {
    id: "APT-1", model: "Thar Roxx", vin: "KA05XY1009", center_name: "Hero-M&M Service, Whitefield",
    slot_start: "2026-09-05T04:30:00+00:00", status: "booked", created_by_agent: "scheduling_agent",
  };

  function renderRow(overrides = {}) {
    render(<table><tbody><AppointmentRow appointment={{ ...row, ...overrides }} /></tbody></table>);
    return screen.getByRole("row");
  }

  it("shows the slot in the house format, in India time", () => {
    expect(within(renderRow()).getByText("Sat 5 Sep, 10:00 am")).toBeInTheDocument();
  });

  it("names who booked it in words", () => {
    expect(within(renderRow()).getByText("Scheduling agent")).toBeInTheDocument();
  });

  it("says a manual booking is manual", () => {
    expect(within(renderRow({ created_by_agent: null })).getByText("Manual")).toBeInTheDocument();
  });

  it("shows the status as a word", () => {
    expect(within(renderRow()).getByText("Booked")).toBeInTheDocument();
  });
});

describe("sign-in subtitle", () => {
  it("does not call the owner's app the OEM console", () => {
    render(<Login defaultMethod="phone_otp" surface="owner" />);
    expect(screen.queryByText(/OEM console/i)).not.toBeInTheDocument();
  });

  it("still names the console for staff", () => {
    render(<Login />);
    expect(screen.getByText(/OEM console/i)).toBeInTheDocument();
  });
});
