/**
 * The public site. jsdom has no WebGL, so what is checked here is the part that
 * must work without it: the story is real text, the way in is a click away, and
 * the page is navigable from its rail.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ScrollTrigger asks for matchMedia when it registers, which is at import time and
// which jsdom does not have; a phone with no preferences is enough.
vi.hoisted(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

const { default: Landing } = await import("./Landing.jsx");

afterEach(() => window.history.replaceState(null, "", "/"));

describe("public landing page", () => {
  it("states what the product does in plain text", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/fix it before it breaks/i);
    for (const name of ["Listen", "Call", "Book", "Coordinate", "Learn", "Protect"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
  });

  it("keeps the decorative world out of the accessibility tree", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".site-world")).toHaveAttribute("aria-hidden", "true");
  });

  it("takes a visitor to the sign-in", () => {
    render(<Landing />);
    fireEvent.click(screen.getAllByRole("button", { name: /^sign in/i })[0]);
    expect(window.location.pathname).toBe("/login");
  });

  it("marks the current stop on the rail", () => {
    render(<Landing />);
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute("aria-current", "step");
  });
});
