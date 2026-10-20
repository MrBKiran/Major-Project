import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pill } from "./device.jsx";

/** WCAG 2.x contrast ratio between two `rgb(r, g, b)` strings. */
function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Pills carry 11px text, so they need the 4.5:1 that small text needs.
describe.each([
  ["severity, day", { tone: "p1", night: false }],
  ["severity, night", { tone: "p1", night: true }],
  ["amber, day", { tone: "amber", night: false }],
  ["amber, night", { tone: "amber", night: true }],
])("Pill (%s)", (_, props) => {
  it("is readable at 11px", () => {
    render(<Pill {...props}>P2</Pill>);
    const { color, backgroundColor } = screen.getByText("P2").style;
    expect(contrast(color, backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});
