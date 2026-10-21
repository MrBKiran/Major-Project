// @vitest-environment node
import { describe, expect, it } from "vitest";

import { inputCls } from "./parts.jsx";

describe("sign-in fields", () => {
  // WCAG 1.4.11: a text field is found by its outline. `border` is a divider
  // (about 1.3:1); `border-strong` clears 3:1 by day and by night.
  it("are outlined strongly enough to be found", () => {
    expect(inputCls).toMatch(/(?:^|\s)border-border-strong(?:\s|$)/);
  });
});
