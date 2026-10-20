/**
 * Found by the screenshot baseline: before the guard's verdict arrives the head
 * unit rendered its healthy screen — "All systems nominal" — so for the length
 * of a request a car with a P1 fault told its driver everything was fine.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const { ConsoleBody } = await import("./InCarConsole.jsx");

const body = (result) => render(
  <ConsoleBody night={false} driveState="PARKED" result={result} vin="KA03KL1008"
               slotsAllowed={false} touchAllowed={false} booked={false} onBook={() => {}} />,
);

describe("head unit before the verdict arrives", () => {
  it("does not claim the car is healthy", () => {
    body(null);
    expect(screen.queryByText(/all systems nominal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing raised/i)).not.toBeInTheDocument();
  });

  it("says it is still checking", () => {
    body(null);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it("still shows the healthy screen once a verdict with no prediction arrives", () => {
    body({ prediction: null, steps: [] });
    expect(screen.getByText(/all systems nominal/i)).toBeInTheDocument();
  });
});
