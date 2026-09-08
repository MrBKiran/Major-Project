/**
 * Shared primitives. Kept in one file on purpose: five screens do not justify a
 * component library, and every slide should inherit the same visual grammar
 * without anyone having to remember which folder a Card lives in.
 */

import { useEffect, useRef, useState } from "react";

export const SEVERITY = {
  P1: { label: "P1", cls: "bg-p1/10 text-p1-ink border-p1/30" },
  P2: { label: "P2", cls: "bg-p2/10 text-p2-ink border-p2/30" },
  P3: { label: "P3", cls: "bg-p3/10 text-p3-ink border-p3/30" },
};

/**
 * Chart theme. Recharts takes literal colors, not CSS variables, so the axis
 * and grid values cannot follow the token flip the way class names do — they
 * have to be stated once, here, instead of being retyped per chart and
 * drifting. Grid and axes sit deliberately quiet: on a light ground the
 * dark-theme values read as data rather than as scaffolding, which is what
 * made the earlier charts look like they belonged to a different app.
 */
export const CHART = {
  grid: "#e4e7ea",
  axis: "#9aa1ab",
  tooltip: {
    background: "#ffffff",
    border: "1px solid #d7dade",
    borderRadius: 10,
    fontSize: 12,
    color: "#16181d",
    boxShadow: "0 8px 24px -12px rgba(0,0,0,0.25)",
  },
  // Series stay saturated enough to carry meaning against white; the token
  // severity colors are tuned for text contrast and go muddy as thin lines.
  series: {
    temp: "#e07a00",
    volt: "#1f9d55",
    baseline: "#2563eb",
    predicted: "#e07a00",
    capacity: "#d8391a",
  },
};

export function Card({ title, subtitle, right, children, className = "", interactive = false }) {
  return (
    <section
      className={`rounded-xl border border-edge bg-ink-800 transition-[border-color,box-shadow,transform] duration-200 ${
        interactive ? "hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.22)]" : ""
      } ${className}`}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-3.5">
          <div>
            {title && (
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Counts up from 0 to `value` once on mount/change — makes a stat land like a
 * measurement being taken rather than text that was just always there. Only
 * animates plain finite numbers; anything else (strings, "7/46", "—") renders
 * immediately, unchanged. */
function useCountUp(value, duration = 700) {
  const isPlainNumber = typeof value === "number" && Number.isFinite(value);
  const [display, setDisplay] = useState(isPlainNumber ? 0 : value);
  const raf = useRef(null);

  useEffect(() => {
    if (!isPlainNumber) { setDisplay(value); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setDisplay(value); return; }
    const from = 0;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      setDisplay(from + (value - from) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isPlainNumber, duration]);

  if (!isPlainNumber) return value;
  return Number.isInteger(value) ? Math.round(display) : display.toFixed(1);
}

/** One number, one label. The unit of a slide claim. */
export function Stat({ value, label, sub, tone = "default", wide = false }) {
  const tones = {
    default: "text-slate-100",
    danger: "text-p1",
    warn: "text-p2",
    good: "text-ok",
    accent: "text-accent",
  };
  const shown = useCountUp(value);
  return (
    <div className={`group rounded-lg border border-edge bg-ink-700/60 px-4 py-3.5 transition-colors duration-200 hover:border-slate-600 ${wide ? "col-span-2" : ""}`}>
      <div className={`num text-[26px] font-semibold leading-none ${tones[tone]}`}>
        {shown}
      </div>
      <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "slate", pulse = false }) {
  const tones = {
    slate: "border-slate-600/50 bg-slate-700/25 text-slate-300",
    good: "border-ok/30 bg-ok/10 text-ok-ink",
    warn: "border-p2/30 bg-p2/10 text-p2-ink",
    danger: "border-p1/30 bg-p1/10 text-p1-ink",
    accent: "border-accent/30 bg-accent/10 text-accent-ink",
  };
  const dotTones = { slate: "bg-slate-400", good: "bg-ok", warn: "bg-p2", danger: "bg-p1", accent: "bg-accent" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {pulse && <span className={`h-1.5 w-1.5 rounded-full pulse-soft ${dotTones[tone]}`} />}
      {children}
    </span>
  );
}

export function SeverityPill({ severity }) {
  if (!severity) return <Badge tone="good">healthy</Badge>;
  const s = SEVERITY[severity] ?? SEVERITY.P3;
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function Empty({ children, icon = "circle" }) {
  const icons = {
    circle: <circle cx="12" cy="12" r="9" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="M15 15l4.5 4.5" /></>,
    inbox: <><path d="M3 12h4l2 3h6l2-3h4" /><path d="M5 12 3 6h18l-2 6" /><path d="M3 12v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" /></>,
  };
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-edge px-5 py-10 text-center text-sm text-slate-500">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
        {icons[icon] ?? icons.circle}
      </svg>
      <span>{children}</span>
    </div>
  );
}

/** A stand-in for content that hasn't arrived yet — shaped like the thing it
 * will become (a line of text, a stat tile, a table row) so the layout
 * doesn't jump when the real content lands. */
export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonStatRow({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-edge bg-ink-700/60 px-4 py-3.5">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="mt-2.5 h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function inr(n) {
  if (n == null) return "—";
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
