/**
 * The owner's 3D stage. The 3D scene itself needs WebGL (jsdom has none, so it
 * renders its placeholder); what is checked here is the part that carries
 * meaning: the words and the ring, for each of the three states an owner can
 * be in — healthy, alert, booked.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HealthRing, OwnerStage } from "./Stage.jsx";

const detail = { vehicle: { model: "Bolero", vin: "MH12AB1001", odometer: 128400 } };
const alert = { component: "water_pump", severity: "P2", days_to_failure: 10.3 };

describe("owner stage", () => {
  it("is quiet when the car is healthy", () => {
    const { container } = render(<OwnerStage detail={detail} top={null} />);
    expect(container.textContent).toContain("Your Bolero");
    expect(container.textContent).toContain("All systems watched");
    expect(container.textContent).toContain("Healthy");
  });

  it("names the part to look at when something is wearing", () => {
    const { container } = render(<OwnerStage detail={detail} top={alert} />);
    expect(container.textContent).toContain("Needs attention soon");
    expect(container.textContent).toContain("Water pump");
    expect(container.textContent).toContain("Watching closely");
  });

  it("is calm again once a visit is booked, even with the alert still on file", () => {
    const { container } = render(<OwnerStage detail={detail} top={alert} booked />);
    expect(container.textContent).toContain("Visit scheduled");
    expect(container.textContent).toContain("On the calendar");
    expect(container.textContent).not.toContain("Needs attention soon");
  });

  it("is decoration: hidden from assistive tech, because the panel beside it says all of this as text", () => {
    const { container } = render(<OwnerStage detail={detail} top={alert} />);
    expect(container.querySelector("section")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("health ring", () => {
  it("shows a tick, not a number, when there is no deadline", () => {
    const { container } = render(<HealthRing days={null} />);
    expect(container.querySelector("path")).not.toBeNull();
    expect(screen.queryByText("days")).not.toBeInTheDocument();
  });

  it("counts a deadline in days", () => {
    render(<HealthRing days={10} severity="P2" />);
    expect(screen.getByText("days")).toBeInTheDocument();
  });
});
