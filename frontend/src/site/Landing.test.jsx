/**
 * The public site. jsdom has no WebGL and no scroll, so what is checked here is
 * the part that must work without them: the story is real text, the live run
 * can be driven from the keyboard, the security console really refuses and
 * chains every attack, and the way in is a click away.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ScrollTrigger asks for matchMedia when it registers, which is at import time and
// which jsdom does not have; a phone with no preferences is enough.
vi.hoisted(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

const { default: Landing } = await import("./Landing.jsx");
const { ATTACKS, SCENARIOS } = await import("./content.js");

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("public landing page", () => {
  it("states what the product does in plain text", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/fix it before\s*it breaks/i);
    const sections = screen.getByRole("navigation", { name: "Sections" });
    for (const name of ["How it works", "Agents", "Security", "Screens"]) {
      expect(within(sections).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "From a reading to a repair.",
      "Seven agents. One orchestra.",
      "Every move is policed.",
      "Three screens. One story.",
      "Watch it work on live data.",
    ]);
    // All four stages of the pinned story are readable, not only the one on screen.
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  it("takes a visitor to the sign-in", () => {
    render(<Landing />);
    // The arrow is decoration: the button is named for what it does.
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(window.location.pathname).toBe("/login");
  });
});

describe("the live run", () => {
  it("opens on the owner's car with its first agent at work", () => {
    render(<Landing />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(SCENARIOS.map((s) => s.tab));
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent(SCENARIOS[0].trigger);
    expect(panel).toHaveTextContent(SCENARIOS[0].steps[0].think);
    expect(panel).toHaveTextContent(/Step 1 of 5 · Data analysis agent/);
  });

  it("switches runs by click and by arrow key, re-colouring the card", () => {
    const { container } = render(<Landing />);
    fireEvent.click(screen.getByRole("tab", { name: "Plant quality" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/Seven water pumps replaced in one production batch/);
    expect(container.querySelector(".s-run")).toHaveAttribute("data-tone", "violet");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Plant quality" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Under attack" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Under attack" })).toHaveFocus();
    expect(container.querySelector(".s-run")).toHaveAttribute("data-tone", "rose");
  });

  it("shows every step already done when the visitor asks for less motion", () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ ...before(q), matches: /reduce/.test(q) });
    try {
      render(<Landing />);
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveTextContent("Run complete · 5 of 5 steps");
      for (const step of SCENARIOS[0].steps) expect(panel).toHaveTextContent(step.result);
    } finally {
      window.matchMedia = before;
    }
  });

  it("keeps the car, drawn or 3D, out of the accessibility tree", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".s-svgcar")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the orchestra", () => {
  it("says what the conductor is denied, not only what it may do", () => {
    render(<Landing />);
    const master = screen.getByRole("button", { name: /Master agent/ });
    expect(master).toHaveTextContent("runs.write_plan");
    expect(master).toHaveTextContent("scheduler.confirm");
    expect(master).toHaveTextContent(/Deliberately weak/);
  });
});

describe("the security console", () => {
  it("refuses each attack and chains it into the log", () => {
    vi.useFakeTimers();
    render(<Landing />);
    const log = screen.getByRole("list", { name: "Audit log" });
    const count = () => screen.getByText(/of 5 attacks blocked/).closest("p").textContent;
    expect(count()).toBe("0 of 5 attacks blocked");

    fireEvent.click(screen.getByRole("button", { name: /ATTACK-1/ }));
    act(() => { vi.advanceTimersByTime(1200); });
    expect(log).toHaveTextContent(ATTACKS[0].attempt);
    expect(log).toHaveTextContent(`Blocked · ${ATTACKS[0].verdict}`);
    expect(log).toHaveTextContent(/chained \w{4}…\w{3} ← 81be…f04/);
    expect(screen.getByRole("button", { name: /ATTACK-1/ })).toHaveTextContent("Blocked");

    // The second link points back at the first: that is the chain.
    fireEvent.click(screen.getByRole("button", { name: /ATTACK-3/ }));
    act(() => { vi.advanceTimersByTime(1200); });
    const chains = [...log.querySelectorAll('[data-kind="chain"]')].map((li) => li.textContent);
    const firstHash = chains[0].match(/chained (\S+)/)[1];
    expect(chains[1]).toContain(`← ${firstHash}`);
    expect(count()).toBe("2 of 5 attacks blocked");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(log).toHaveTextContent(/Pick an attack above/);
  });
});
