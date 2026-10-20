/**
 * Night mode for the owner's surfaces.
 *
 * The owner kit (device.jsx) is inline-styled from `tokens(night)`, so its
 * components read `night` from context. Everything built on the semantic
 * Tailwind classes (the sign-in screen) flips through `data-theme="night"` on
 * <html>, which tokens.css answers with the night values. Same tokens, two
 * routes in.
 */

import { createContext, useContext, useEffect, useState } from "react";

const NightContext = createContext(false);
export const NightProvider = NightContext.Provider;

export function useNight() {
  return useContext(NightContext);
}

function darkQuery() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

/** True while the device is set to dark, following changes as they happen. */
export function useSystemNight() {
  const [dark, setDark] = useState(() => Boolean(darkQuery()?.matches));
  useEffect(() => {
    const query = darkQuery();
    if (!query) return undefined;
    const onChange = (e) => setDark(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return dark;
}

// How many mounted components currently ask for a night page. A count, not a
// saved previous value: React runs a child's effect before its parent's, so a
// child "restoring what was there" restores the state before its parent ran.
let nightHolders = 0;

function applyPageTheme() {
  const root = document.documentElement;
  if (nightHolders > 0) root.dataset.theme = "night";
  else delete root.dataset.theme;
}

/** Keeps the page itself in night mode while any caller passes true. /app and
 *  the owner app inside it both ask; the inner one unmounting (sign-out) must
 *  not turn a dark phone's sign-in screen light. */
export function usePageTheme(night) {
  useEffect(() => {
    if (!night) return undefined;
    nightHolders += 1;
    applyPageTheme();
    return () => {
      nightHolders -= 1;
      applyPageTheme();
    };
  }, [night]);
}
