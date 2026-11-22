import { createContext, useContext } from "react";

/**
 * Plain words by default; the product's own names on request.
 *
 * The public site is read by drivers and fleet owners as well as engineers and
 * judges. Everyone gets plain language. "Show technical details" adds the real
 * agent ids, tool calls, statistics and log hashes beside it — one switch for
 * the whole page, so flipping it in any section flips it everywhere.
 */

export const DetailContext = createContext({ on: false, set: () => {} });

export const useDetail = () => useContext(DetailContext);

export function DetailToggle({ className = "", dark = false }) {
  const { on, set } = useDetail();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className={`s-toggle ${dark ? "s-toggle-dark" : ""} ${className}`}
    >
      <span className="s-toggle-track" aria-hidden="true"><i /></span>
      Show technical details
    </button>
  );
}
