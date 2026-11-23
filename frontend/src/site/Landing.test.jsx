/**
 * The public site. jsdom has no WebGL and no scroll, so what is checked here is
 * the part that must work without them: the story is real text an ordinary
 * reader can follow, the engineering names appear only when asked for, the
 * live run can be driven from the keyboard, the security log really refuses
 * and chains every attack, and the way in is a click away.
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

const techSwitch = () => screen.getAllByRole("switch", { name: "Show technical details" })[0];

// Words a driver should never have to decode. Tool names look like `scheduler.confirm`.
const JARGON = [
  /\b[a-z]+\.[a-z_]+\b/, /\b\w+_agent\b/, /\bueba\b/i, /\bcapa\b/i, /\bvin\b/i, /\btelemetry\b/i,
  /q-value/i, /\bfdr\b/i, /\boem\b/i, /allowlist/i, /enumeration/i, /\binjection\b/i, /\bP[12]\b/, /severity/i,
];

describe("public landing page", () => {
  it("states what the product does in plain text", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/fix it before\s*it breaks/i);
    const sections = screen.getByRole("navigation", { name: "Sections" });
    for (const name of ["How it works", "Savings", "AI helpers", "Safety", "Apps"]) {
      expect(within(sections).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "See it in action",
      "From a warning sign to a repair.",
      "What waiting costs.",
      "Seven AI helpers. One team.",
      "Every action is checked first.",
      "Three screens. One story.",
      "Keep every car on the road.",
    ]);
    // All four stages of the pinned story are readable, not only the one on screen.
    const journey = screen.getByRole("region", { name: "From a warning sign to a repair." });
    expect(within(journey).getAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  it("speaks plainly until the visitor asks for the technical detail", () => {
    const { container } = render(<Landing />);
    const visible = () => container.textContent;
    for (const word of JARGON) expect(visible()).not.toMatch(word);

    fireEvent.click(techSwitch());
    for (const s of screen.getAllByRole("switch")) expect(s).toHaveAttribute("aria-checked", "true");
    expect(visible()).toMatch(/telemetry\.read_window/);
    expect(visible()).toMatch(/data_analysis_agent/);
  });

  it("takes a visitor to the sign-in", () => {
    render(<Landing />);
    // The arrow is decoration: the button is named for what it does.
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(window.location.pathname).toBe("/login");
  });
});

describe("one way in, and a footer that is a footer", () => {
  it("offers sign-in everywhere and no second door to the same page", () => {
    render(<Landing />);
    expect(screen.queryByRole("link", { name: /owner app/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /owner app/i })).toBeNull();
    // Top bar, closing call and footer all lead to the one sign-in.
    for (const el of [screen.getByRole("button", { name: "Sign in to AutoSaarthi" }), within(screen.getByRole("navigation", { name: "Account" })).getByRole("link", { name: "Sign in" })]) {
      fireEvent.click(el);
      expect(window.location.pathname).toBe("/login");
      window.history.replaceState(null, "", "/");
    }
  });

  it("has a product footer, with no competition wording anywhere", () => {
    const { container } = render(<Landing />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("navigation", { name: "Product" })).toBeInTheDocument();
    expect(within(footer).getByRole("navigation", { name: "Account" })).toBeInTheDocument();
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} AutoSaarthi`);
    expect(container.textContent).not.toMatch(/techathon|hackathon|challenge iii|practice attack|demo fleet/i);
  });

  it("marks the section being read in the dock and lets go on the hero", () => {
    const seen = [];
    const original = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; seen.push(this); }
      observe(el) { this.last = el; }
      unobserve() {}
      disconnect() {}
    };
    try {
      render(<Landing />);
      const dock = screen.getByRole("navigation", { name: "Sections" });
      expect(within(dock).queryByRole("button", { current: true })).toBeNull();
      // Every observer on the page hears the same scroll; only the dock's cares about a section's id.
      const scrollTo = (id) => act(() => { seen.forEach((o) => o.cb([{ isIntersecting: true, target: document.getElementById(id) }])); });
      scrollTo("helpers");
      expect(within(dock).getByRole("button", { name: "AI helpers" })).toHaveAttribute("aria-current", "true");
      scrollTo("start");
      expect(within(dock).queryByRole("button", { current: true })).toBeNull();
    } finally {
      window.IntersectionObserver = original;
    }
  });
});

describe("the live run", () => {
  it("opens on a car that needs a repair, with the first helper at work", () => {
    render(<Landing />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(SCENARIOS.map((s) => s.tab));
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent(SCENARIOS[0].trigger);
    expect(panel).toHaveTextContent(SCENARIOS[0].steps[0].doing);
    expect(panel).toHaveTextContent("Step 1 of 5 · Health monitor is working");
    expect(panel).toHaveTextContent(/Engine temperature\s*97\.2 °C\s*rising/);
  });

  it("switches situations by click and by arrow key, re-colouring the card", () => {
    const { container } = render(<Landing />);
    fireEvent.click(screen.getByRole("tab", { name: "A factory problem" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/Seven cars built in the same production batch/);
    expect(container.querySelector(".s-run")).toHaveAttribute("data-tone", "violet");

    fireEvent.keyDown(screen.getByRole("tab", { name: "A factory problem" }), { key: "ArrowRight" });
    const attack = screen.getByRole("tab", { name: "Someone tries to misuse it" });
    expect(attack).toHaveAttribute("aria-selected", "true");
    expect(attack).toHaveFocus();
    expect(container.querySelector(".s-run")).toHaveAttribute("data-tone", "rose");
  });

  it("shows every step already done when the visitor asks for less motion", () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ ...before(q), matches: /reduce/.test(q) });
    try {
      render(<Landing />);
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveTextContent("All done · 5 of 5 steps");
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

describe("the helpers", () => {
  it("say what each one may not do — in words, or as tools on request", () => {
    render(<Landing />);
    const lead = screen.getByRole("heading", { level: 3, name: "Team lead" }).closest("article");
    expect(within(lead).getByRole("list", { name: "Team lead cannot" })).toHaveTextContent("Book a repair");
    expect(lead).toHaveTextContent(/Deliberately limited/);

    fireEvent.click(techSwitch());
    expect(lead).toHaveTextContent("master_agent");
    expect(lead).toHaveTextContent("runs.write_plan");
    expect(lead).toHaveTextContent("scheduler.confirm");
  });
});

describe("the security log", () => {
  it("stops each attack and seals it to the entry before", () => {
    vi.useFakeTimers();
    render(<Landing />);
    const log = screen.getByRole("list", { name: "Security log" });
    const count = () => screen.getByText(/of 5 attacks stopped/).closest("p").textContent;
    expect(count()).toBe("0 of 5 attacks stopped");

    fireEvent.click(screen.getByRole("button", { name: /Snooping on car data/ }));
    act(() => { vi.advanceTimersByTime(1400); });
    expect(log).toHaveTextContent(ATTACKS[0].attempt);
    expect(log).toHaveTextContent(`Stopped. ${ATTACKS[0].verdict}`);
    expect(log).toHaveTextContent("Written to the log as entry 1, sealed to the one before it.");
    expect(screen.getByRole("button", { name: /Snooping on car data/ })).toHaveTextContent("Stopped ✓");

    fireEvent.click(screen.getByRole("button", { name: /Tricking it by voice/ }));
    act(() => { vi.advanceTimersByTime(1400); });
    expect(count()).toBe("2 of 5 attacks stopped");

    // Technically, "sealed" means each entry carries the fingerprint of the one before.
    fireEvent.click(techSwitch());
    const chains = [...log.querySelectorAll('[data-kind="chain"]')].map((li) => li.textContent);
    expect(chains[0]).toMatch(/audit entry \w{4}…\w{3} ← 81be…f04/);
    const first = chains[0].match(/audit entry (\S+)/)[1];
    expect(chains[1]).toContain(`← ${first}`);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(log).toHaveTextContent(/Pick an attack above/);
  });
});

describe("what waiting costs", () => {
  const section = () => screen.getByRole("region", { name: "What waiting costs." });
  const amount = () => section().querySelector(".s-calc-total");

  it("opens on a water pump, fixed early, at the repair price", () => {
    render(<Landing />);
    expect(within(section()).getByRole("radio", { name: "Water pump" })).toHaveAttribute("aria-checked", "true");
    expect(within(section()).getByRole("radio", { name: "Fix it early" })).toHaveAttribute("aria-checked", "true");
    expect(within(section()).getByText("You pay")).toBeInTheDocument();
    expect(amount()).toHaveTextContent("₹2,400");
    expect(section()).toHaveTextContent(/about 90 minutes in the workshop/);
  });

  it("flips to the breakdown price, and says what breaks", () => {
    render(<Landing />);
    fireEvent.click(within(section()).getByRole("radio", { name: "Wait for the breakdown" }));
    expect(within(section()).getByText("You would pay")).toBeInTheDocument();
    expect(amount()).toHaveTextContent("₹18,500");
    expect(section()).toHaveTextContent(/head gasket/);
    expect(section()).toHaveTextContent(/7\.7×/);                    // 18,500 / 2,400
  });

  it("changes the part, with its own pair, its own notice and a safety note where it applies", () => {
    render(<Landing />);
    fireEvent.click(within(section()).getByRole("radio", { name: "Oil pump" }));
    expect(amount()).toHaveTextContent("₹7,800");
    expect(section()).toHaveTextContent(/A safety part\./);
    expect(section()).toHaveTextContent(/about 6 days of notice/);
    fireEvent.click(within(section()).getByRole("radio", { name: "Wait for the breakdown" }));
    expect(amount()).toHaveTextContent("₹65,000");
    expect(section()).toHaveTextContent(/8\.3×/);                    // 65,000 / 7,800

    fireEvent.click(within(section()).getByRole("radio", { name: "Battery" }));
    expect(section()).not.toHaveTextContent(/A safety part\./);
    expect(amount()).toHaveTextContent("₹9,000");
  });

  it("is a pair of radio groups, moved by the arrow keys", () => {
    render(<Landing />);
    const early = within(section()).getByRole("radio", { name: "Fix it early" });
    fireEvent.keyDown(early, { key: "ArrowRight" });
    expect(within(section()).getByRole("radio", { name: "Wait for the breakdown" })).toHaveAttribute("aria-checked", "true");
    expect(within(section()).getByRole("radio", { name: "Wait for the breakdown" })).toHaveFocus();

    const pump = within(section()).getByRole("radio", { name: "Water pump" });
    fireEvent.keyDown(pump, { key: "ArrowLeft" });                      // wraps to the last part
    expect(within(section()).getByRole("radio", { name: "Oil pump" })).toHaveAttribute("aria-checked", "true");
  });

  it("lets the bars be pressed as well", () => {
    render(<Landing />);
    fireEvent.click(within(section()).getByRole("button", { name: /Wait for the breakdown/ }));
    expect(amount()).toHaveTextContent("₹18,500");
    fireEvent.click(within(section()).getByRole("button", { name: /Fix it early/ }));
    expect(amount()).toHaveTextContent("₹2,400");
  });

  it("is plain that the figures are typical and a warning is a prediction", () => {
    render(<Landing />);
    expect(section()).toHaveTextContent(/typical for the cars shown/);
    expect(section()).toHaveTextContent(/not a promise/);
  });
});

describe("the facts under the hero", () => {
  it("show their figures (they count up when seen, and are simply there where that cannot be seen)", () => {
    render(<Landing />);
    const facts = document.querySelector(".s-facts");
    expect(facts).toHaveTextContent("9 days");
    expect(facts).toHaveTextContent("₹2,400");
    expect(facts).toHaveTextContent("5 of 5");
  });
});
