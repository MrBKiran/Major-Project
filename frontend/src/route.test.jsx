/**
 * The tiny router: the address bar is the state, and navigating tells every
 * subscriber. Signed-out visitors are sent between the public site (/) and the
 * sign-in (/login) with it, so it must keep the URL and the view in step.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { currentPath, navigate, useRoute } from "./route.js";

function Where() {
  return <p>at {useRoute()}</p>;
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("route", () => {
  it("reads the path from the address bar", () => {
    window.history.replaceState(null, "", "/login");
    expect(currentPath()).toBe("/login");
  });

  it("navigates, updating the address and every subscriber", () => {
    render(<Where />);
    expect(screen.getByText("at /")).toBeInTheDocument();
    act(() => navigate("/login"));
    expect(window.location.pathname).toBe("/login");
    expect(screen.getByText("at /login")).toBeInTheDocument();
  });

  it("follows the back button", () => {
    render(<Where />);
    act(() => navigate("/login"));
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText("at /")).toBeInTheDocument();
  });
});
