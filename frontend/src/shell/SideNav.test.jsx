/**
 * The desktop sidebar. Like the horizontal tab bar it replaces on wide windows,
 * the current section must be named for assistive tech, not only coloured.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SideNav } from "./SideNav.jsx";

const TABS = [{ id: "fleet", label: "Fleet Monitoring" }, { id: "ops", label: "Service Ops" }];
const icon = (id) => <span>{id}</span>;

describe("sidebar", () => {
  it("is a named landmark", () => {
    render(<SideNav tabs={TABS} active="fleet" onSelect={() => {}} icon={icon} />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("marks the current section for screen readers, not only by colour", () => {
    render(<SideNav tabs={TABS} active="ops" onSelect={() => {}} icon={icon} />);
    expect(screen.getByRole("button", { name: /service ops/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /fleet monitoring/i })).not.toHaveAttribute("aria-current");
  });

  it("selects a section", () => {
    const onSelect = vi.fn();
    render(<SideNav tabs={TABS} active="fleet" onSelect={onSelect} icon={icon} />);
    fireEvent.click(screen.getByRole("button", { name: /service ops/i }));
    expect(onSelect).toHaveBeenCalledWith("ops");
  });

  it("says so when a role has no pages, instead of showing an empty bar", () => {
    render(<SideNav tabs={[]} active={null} onSelect={() => {}} icon={icon} />);
    expect(screen.getByText(/no pages assigned/i)).toBeInTheDocument();
  });
});
