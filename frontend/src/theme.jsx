/**
 * The app's colour theme: Light, Dark, or follow the system — one choice that
 * applies to every page, chart and 3D scene, and is remembered between visits.
 *
 * Until now only the in-car console had a Day/Night switch, and it flipped just
 * the head-unit mock; nothing else could go dark. The tokens always had a night
 * value for every colour (packages/tokens), reached through `data-theme="night"`
 * on <html>, so this file is only the part that was missing: deciding when to
 * set it, and remembering the answer.
 *
 * The theme is applied the moment this module loads — before React renders — so
 * a returning dark-mode user never sees a white page flash first.
 */

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { setGlobalNight, useSystemNight } from "./night.jsx";

const KEY = "autosaarthi-theme";
export const MODES = ["light", "dark", "system"];

function readStored() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // storage can be blocked (private windows); the app still works
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Applied at import, not in an effect: no flash of the wrong theme.
if (typeof window !== "undefined") {
  const stored = readStored();
  setGlobalNight(stored === "dark" || (stored === "system" && systemPrefersDark()));
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const system = useSystemNight();
  const [mode, setModeState] = useState(readStored);
  const night = mode === "dark" || (mode === "system" && system);

  useLayoutEffect(() => { setGlobalNight(night); }, [night]);

  const setMode = useCallback((next) => {
    setModeState(next);
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch { /* not saved; applies for this visit */ }
  }, []);

  const value = useMemo(() => ({ mode, night, setMode }), [mode, night, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** `{ mode, night, setMode }`. Without a provider (a page rendered on its own,
 *  as in tests) it simply follows the system. */
export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  const system = useSystemNight();
  return ctx ?? { mode: "system", night: system, setMode: () => {} };
}

const ICONS = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
};
const LABELS = { light: "Light", dark: "Dark", system: "System" };

/** Three-way switch. A radio group, so a keyboard moves through it with the
 *  arrow keys and a screen reader hears "Colour theme, Dark, selected". */
export function ThemeToggle({ className = "", compact = false }) {
  const { mode, setMode } = useThemeMode();

  function onKeyDown(e) {
    const i = MODES.indexOf(mode);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setMode(MODES[(i + 1) % MODES.length]); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setMode(MODES[(i + MODES.length - 1) % MODES.length]); }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      onKeyDown={onKeyDown}
      className={`inline-flex rounded-lg border border-border bg-surface-inset p-0.5 ${className}`}
    >
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={LABELS[m]}
          title={LABELS[m]}
          tabIndex={mode === m ? 0 : -1}
          onClick={() => setMode(m)}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-label font-medium transition-colors duration-200 ${
            mode === m ? "bg-surface-card text-fg-strong shadow-sm" : "text-fg-muted hover:text-fg-secondary"
          }`}
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[m]}
          </svg>
          {!compact && <span>{LABELS[m]}</span>}
        </button>
      ))}
    </div>
  );
}
