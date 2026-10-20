/**
 * Dialog: the two modals (the Fleet assistant chat and the Plant CAPA
 * precedent) were plain overlays — no dialog role, no name, focus left behind
 * on the page underneath, and only one of them closed on Escape.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./ui.jsx";

function Harness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open precedent</button>
      {open && (
        <Dialog title="CAPA-2022-1096" onClose={() => { onClose(); setOpen(false); }}>
          <button>First</button>
          <button>Last</button>
        </Dialog>
      )}
    </>
  );
}

function openIt(onClose) {
  render(<Harness onClose={onClose} />);
  const opener = screen.getByRole("button", { name: "Open precedent" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Dialog", () => {
  it("is announced as a modal dialog named by its title", () => {
    openIt();
    const dialog = screen.getByRole("dialog", { name: "CAPA-2022-1096" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("takes focus when it opens", () => {
    openIt();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and gives focus back to what opened it", () => {
    const onClose = vi.fn();
    const opener = openIt(onClose);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a click outside, not on one inside", () => {
    const onClose = vi.fn();
    openIt(onClose);
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside: from the last control it wraps to the first", () => {
    openIt();
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    // The header's close button comes first in the dialog.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("renders on top of everything, not inside the page that opened it", () => {
    // Found in the browser: inside the page's entrance-animation wrapper (its
    // own stacking context) the dialog's z-50 could not rise above the sticky
    // header, which covered the dialog's title.
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open precedent" }));
    expect(container.contains(screen.getByRole("dialog"))).toBe(false);
    expect(screen.getByTestId("dialog-backdrop").parentElement).toBe(document.body);
  });

  it("has a labelled close button", () => {
    openIt();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
