/**
 * The app-wide theme. Before it, only the in-car console had a Day/Night switch
 * and it turned just the head-unit mock dark; nothing else could. These pin the
 * replacement: one choice (Light, Dark or follow the system), applied to the
 * whole page, remembered, and operable from the keyboard.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeToggle, useThemeMode } from "./theme.jsx";

function systemPrefersDark(dark) {
  vi.stubGlobal("matchMedia", (query) => ({
    matches: dark && /dark/.test(query), media: query,
    addEventListener() {}, removeEventListener() {},
  }));
}

function Probe() {
  const { mode, night } = useThemeMode();
  return <p data-testid="probe">{`${mode}:${night ? "night" : "day"}`}</p>;
}

const mount = () => render(<ThemeProvider><ThemeToggle /><Probe /></ThemeProvider>);
const pick = (name) => fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("follows the system by default", () => {
    systemPrefersDark(true);
    mount();
    expect(screen.getByTestId("probe")).toHaveTextContent("system:night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("Light overrides a dark system, for the whole page", () => {
    systemPrefersDark(true);
    mount();
    pick("Light");
    expect(screen.getByTestId("probe")).toHaveTextContent("light:day");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("Dark overrides a light system, for the whole page", () => {
    systemPrefersDark(false);
    mount();
    pick("Dark");
    expect(screen.getByTestId("probe")).toHaveTextContent("dark:night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("remembers an explicit choice, and System forgets it", () => {
    systemPrefersDark(false);
    mount();
    pick("Dark");
    expect(localStorage.getItem("autosaarthi-theme")).toBe("dark");
    pick("System");
    expect(localStorage.getItem("autosaarthi-theme")).toBeNull();
  });

  it("applies a remembered choice on the next visit", () => {
    systemPrefersDark(false);
    localStorage.setItem("autosaarthi-theme", "dark");
    mount();
    expect(screen.getByTestId("probe")).toHaveTextContent("dark:night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("without a provider (a page on its own) simply follows the system", () => {
    systemPrefersDark(true);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("system:night");
  });
});

describe("theme switch", () => {
  it("is a named radio group that says which theme is chosen", () => {
    systemPrefersDark(false);
    mount();
    expect(screen.getByRole("radiogroup", { name: /colour theme/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves with the arrow keys", () => {
    systemPrefersDark(false);
    mount();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });
});
