import { formatClock } from "@autosaarthi/core";
import { useRef, useState } from "react";
import { ACCENT, MONO, SANS, tokens } from "../../device.jsx";
import { useNight } from "../../night.jsx";

const W = 340;

/**
 * A reading over time that can be read off: move a finger, the mouse or the arrow keys along it and
 * a crosshair gives the exact value and the time (the crosshair chart from the dashboards, kept to
 * what an owner needs). A slider underneath, so a screen reader can step through the same points.
 *
 * `times` are optional ISO timestamps, one per value. A reading that is missing is skipped, never
 * drawn as zero.
 */
export function ScrubChart({ values, times = [], unit = "", label, tone = ACCENT, h = 64 }) {
  const night = useNight();
  const t = tokens(night);
  const box = useRef(null);
  const [active, setActive] = useState(null);

  const pts = (values || [])
    .map((v, i) => ({ v: typeof v === "number" && Number.isFinite(v) ? v : null, ts: times[i] }))
    .filter((p) => p.v !== null);
  const n = pts.length;
  if (n < 2) return <div style={{ height: h, borderRadius: 6, background: t.hatch }} />;

  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i) => (i / (n - 1)) * (W - 8) + 4;
  const y = (v) => h - 6 - ((v - min) / span) * (h - 12);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const shown = active ?? n - 1;
  const p = pts[shown];
  const reading = `${p.v.toFixed(1)}${unit}`;
  const when = p.ts ? formatClock(p.ts) : null;
  const spoken = `${reading}${when ? ` at ${when}` : ""}${active === null ? ", latest" : ""}`;

  function at(clientX) {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setActive(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
  }

  function onKeyDown(e) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step) { e.preventDefault(); setActive(Math.max(0, Math.min(n - 1, shown + step))); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Escape") setActive(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: t.ink }}>{reading}</span>
        <span style={{ fontFamily: SANS, fontSize: 12, color: t.faint }}>
          {active === null ? "latest" : when ?? `point ${shown + 1} of ${n}`}
        </span>
      </div>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={shown}
        aria-valuetext={spoken}
        onPointerMove={(e) => at(e.clientX)}
        onPointerDown={(e) => at(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        style={{ touchAction: "pan-y", cursor: "crosshair", borderRadius: 8, outlineOffset: 2 }}
      >
        <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
          <polyline points={line} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && (
            <g>
              <line x1={x(shown)} x2={x(shown)} y1="0" y2={h} stroke={t.edgeStrong} strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(shown)} cy={y(p.v)} r="4.5" fill={tone} stroke={t.card} strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
