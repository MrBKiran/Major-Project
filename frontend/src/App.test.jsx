/**
 * The console's header: which section is current, and the account menu.
 * Before: the active section was shown only by colour, and the account menu
 * neither said it was open nor closed on Escape or a click elsewhere.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api.js", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({
      memberships: [{ org_id: "ORG-PLATFORM", org_name: "AutoSaarthi Platform", role: "platform_admin", active: true }],
    })),
  },
}));
vi.mock("./auth/AuthContext.jsx", () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    principal: { full_name: "Platform Admin", org: { name: "AutoSaarthi Platform" }, role: "platform_admin" },
    logout: vi.fn(), switchMembership: vi.fn(),
  }),
}));

const { AccountMenu, SectionNav } = await import("./App.jsx");

const TABS = [{ id: "fleet", label: "Fleet Monitoring" }, { id: "service", label: "Service Ops" }];

describe("section navigation", () => {
  it("is a named landmark", () => {
    render(<SectionNav tabs={TABS} active="fleet" onSelect={() => {}} />);
    expect(screen.getByRole("navigation", { name: /console sections/i })).toBeInTheDocument();
  });

  it("marks the current section for screen readers, not only by colour", () => {
    render(<SectionNav tabs={TABS} active="service" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /service ops/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /fleet monitoring/i })).not.toHaveAttribute("aria-current");
  });

  it("selects a section", () => {
    const onSelect = vi.fn();
    render(<SectionNav tabs={TABS} active="fleet" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /service ops/i }));
    expect(onSelect).toHaveBeenCalledWith("service");
  });
});

describe("account menu", () => {
  const trigger = () => screen.getByRole("button", { name: /platform admin/i });

  it("says whether it is open, and which element it opens", async () => {
    render(<AccountMenu onAccount={() => {}} />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const menu = document.getElementById(trigger().getAttribute("aria-controls"));
    expect(menu).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<AccountMenu onAccount={() => {}} />);
    fireEvent.click(trigger());
    const logout = await screen.findByRole("button", { name: /log out/i });
    logout.focus();
    fireEvent.keyDown(logout, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click elsewhere on the page", async () => {
    render(<><AccountMenu onAccount={() => {}} /><p>elsewhere</p></>);
    fireEvent.click(trigger());
    await screen.findByRole("button", { name: /log out/i });
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });
});
