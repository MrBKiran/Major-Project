/**
 * Device UI kit — the wireframe language, for the two surfaces an *owner*
 * touches: the phone app and the car's head unit.
 *
 * Deliberately separate from ui.jsx. That kit dresses the OEM back-office:
 * dark, dense, a grid of numbers per screen, which is the right shape for a
 * service manager scanning a fleet. This one is the opposite by design —
 * light, one decision per screen, plain language, money before mechanism.
 * The wireframe deck names the rule outright: "a healthy vehicle should be a
 * quiet screen."
 *
 * Both kits coexist rather than one replacing the other, and the tokens here
 * are scoped to these components instead of moving into the global @theme, so
 * restyling the owner surfaces cannot quietly restyle Fleet/Plant/Security.
 *
 * Night mode is a real variant from the deck (screen 9), not a dark-mode
 * afterthought: a head unit at 21:34 on a highway must not throw a white panel
 * at the driver. Pass `night` and every primitive flips.
 */

import { color, day, font, night } from "@autosaarthi/tokens";

/**
 * `dim` and `faint` are one deliberate departure from the deck. A wireframe
 * greys its chrome to say "not the point"; the deck's dock labels and metadata
 * sit around 2:1, which is fine on a drawing and wrong in a vehicle, where the
 * label a driver glances at is exactly the text that must survive sunlight and
 * a half-second look. Both steps are pulled to clear 4.5:1 against the surface
 * they actually sit on — the dock, not the page — in each mode. Hierarchy is
 * preserved (ink > dim > faint); only the floor moved.
 */
// Values come from the shared tokens (packages/tokens); this kit keeps its own
// short names so the primitives below read the way they always have.
const kit = (m) => ({
  page: m.page, panel: m.panel, card: m.card, ink: m.fg, dim: m.fgDevice, faint: m.fgDeviceFaint,
  edge: m.border, hatch: m.hatch, pillBg: m.pillBg, pillInk: m.pillInk,
  amberBg: m.amberBg, amberInk: m.amberInk,
});
const T = { day: kit(day), night: kit(night) };

export const ACCENT = color.accent;
export const AMBER = color.amber;

export function tokens(night) {
  return night ? T.night : T.day;
}

/** Diagonal hatch — the deck's stand-in for map tiles. Kept as a real pattern
 *  rather than a flat grey so an unbuilt region still reads as "deliberately
 *  not here" instead of a rendering failure. */
export function hatchStyle(night, size = 10) {
  const t = tokens(night);
  return {
    background: `repeating-linear-gradient(135deg, ${t.hatch} 0 ${size / 2}px, transparent ${size / 2}px ${size}px)`,
    backgroundColor: night ? "#101317" : "#e6e9ec",
  };
}

/* ── type ────────────────────────────────────────────────────────────────── */

export const MONO = font.mono;
export const SANS = font.sans;

/** Metadata voice: uppercase mono, letterspaced. Everything the owner is not
 *  meant to read closely — status, labels, provenance — wears this. */
export function Meta({ children, night, style = {}, className = "" }) {
  const t = tokens(night);
  return (
    <span
      className={className}
      style={{
        fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em",
        textTransform: "uppercase", color: t.faint, ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── severity ────────────────────────────────────────────────────────────── */

export function Pill({ children, night, tone = "p1" }) {
  const t = tokens(night);
  const bg = tone === "amber" ? t.amberBg : t.pillBg;
  const ink = tone === "amber" ? t.amberInk : t.pillInk;
  return (
    <span
      style={{
        fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", background: bg, color: ink,
        padding: "4px 9px", borderRadius: 6, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ── actions ─────────────────────────────────────────────────────────────── */

/** The single primary action. Big by intent — the deck gives it roughly a
 *  fifth of the panel, because in a car it is a target you hit without
 *  looking for it. */
export function PrimaryButton({ children, onClick, disabled, night, note, full = true }) {
  const t = tokens(night);
  return (
    <div style={{ width: full ? "100%" : undefined }}>
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          width: "100%", borderRadius: 14,
          // 19px, not 17: white on the deck's orange is 3.4:1, which clears the
          // 3:1 bar for large text but not the 4.5:1 for small — and 17px bold
          // sits just under the large threshold. Nudging up is the right fix
          // rather than darkening the brand orange, since this is a control
          // aimed at from a driver's seat, where bigger was already correct.
          padding: "18px 20px", fontFamily: SANS, fontSize: 19, fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          background: disabled ? (night ? "#1c2026" : "#f2f3f5") : ACCENT,
          color: disabled ? t.faint : "#fff",
          border: disabled ? `1px solid ${t.edge}` : "none",
          transition: "filter 140ms ease, transform 140ms ease",
        }}
        onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.985)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {children}
      </button>
      {note && (
        <div style={{ marginTop: 8, textAlign: "center" }}>
          <Meta night={night}>{note}</Meta>
        </div>
      )}
    </div>
  );
}

export function GhostButton({ children, onClick, night, grow = false, disabled = false }) {
  const t = tokens(night);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: grow ? 1 : undefined,
        borderRadius: 12, padding: "13px 16px",
        background: "transparent", border: `1px solid ${t.edge}`,
        color: disabled ? t.faint : t.ink,
        fontFamily: SANS, fontSize: 14, fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 140ms ease",
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = night ? "#1c2026" : "#eef0f2")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

/* ── content ─────────────────────────────────────────────────────────────── */

/** Headline + one plain sentence. The deck's core unit: the owner should be
 *  able to act having read only these two lines. */
export function Headline({ title, body, night, size = 34 }) {
  const t = tokens(night);
  return (
    <div>
      <h1 style={{
        fontFamily: SANS, fontSize: size, lineHeight: 1.1, fontWeight: 700,
        color: t.ink, letterSpacing: "-0.02em", margin: 0,
      }}>
        {title}
      </h1>
      {body && (
        <p style={{
          fontFamily: SANS, fontSize: 15.5, lineHeight: 1.5, color: t.dim,
          marginTop: 12, marginBottom: 0,
        }}>
          {body}
        </p>
      )}
    </div>
  );
}

/** The money pair. This is the argument the whole product makes, so it gets a
 *  dedicated component rather than being assembled ad hoc per screen. */
export function CostRows({ rows, night }) {
  const t = tokens(night);
  return (
    <div style={{ border: `1px solid ${t.edge}`, borderRadius: 14, overflow: "hidden" }}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 16, padding: "13px 16px",
            borderTop: i ? `1px solid ${t.edge}` : "none",
            background: t.card,
          }}
        >
          <span style={{ fontFamily: SANS, fontSize: 14, color: t.dim }}>{r.label}</span>
          <span style={{
            fontFamily: MONO, fontSize: r.strong ? 18 : 15,
            fontWeight: r.strong ? 600 : 500,
            color: r.tone === "bad" ? t.pillInk : t.ink,
            textAlign: "right",
          }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Inline sparkline. No axes, no legend, no tooltip — at a glance it answers
 *  "is this drifting?" and nothing else. Anything more belongs on the
 *  back-office chart, not on an owner's phone. */
export function Spark({ values, night, w = 100, h = 26, tone }) {
  const t = tokens(night);
  const nums = (values || []).filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (nums.length < 2) {
    return <div style={{ width: w, height: h, borderRadius: 4, background: t.hatch }} />;
  }
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <polyline
        points={pts} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
        stroke={tone || (night ? "#7a828c" : "#9aa1ab")}
      />
    </svg>
  );
}

/* ── device frames ───────────────────────────────────────────────────────── */

/** Android-ish 412×915 shell. The frame is the point: an owner screen judged
 *  inside a browser tab always looks under-filled, and the same layout inside
 *  a phone body reads correctly. */
export function PhoneFrame({ children, night, statusBar }) {
  const t = tokens(night);
  return (
    <div
      style={{
        width: 412, height: 915, borderRadius: 34, overflow: "hidden",
        background: t.page, color: t.ink,
        border: `1px solid ${night ? "#000" : "#c9ced4"}`,
        boxShadow: "0 30px 70px -20px rgba(0,0,0,0.55), 0 0 0 9px #16181d, 0 0 0 10px #2a2e34",
        display: "flex", flexDirection: "column", position: "relative",
      }}
    >
      {statusBar}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>{children}</div>
    </div>
  );
}

export function PhoneStatusBar({ night, time = "9:16", right = "LTE  84%" }) {
  const t = tokens(night);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 18px 6px", flexShrink: 0,
    }}>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.ink }}>{time}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: t.dim, letterSpacing: "0.04em" }}>{right}</span>
    </div>
  );
}

/** 16:9 head-unit body: status strip, content, and the fixed dock. The dock
 *  never moves — climate and camera are the controls a driver reaches for by
 *  muscle memory, and an agent must not push them around. */
export function CarFrame({ children, night, status, dock }) {
  const t = tokens(night);
  return (
    <div style={{
      // 16:9 is the real head-unit shape, but in a narrow browser pane that
      // makes the frame short enough to clip the action panel. The floor keeps
      // the primary button on screen — a car UI whose booking button is below
      // a scroll is worse than one that is slightly the wrong shape.
      width: "100%", aspectRatio: "16 / 9", minHeight: 560,
      borderRadius: 16, overflow: "hidden", background: t.page, color: t.ink,
      border: `1px solid ${night ? "#000" : "#c9ced4"}`,
      boxShadow: "0 24px 60px -24px rgba(0,0,0,0.6)",
      display: "flex", flexDirection: "column",
    }}>
      {status}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{children}</div>
      {dock}
    </div>
  );
}

export function CarStatusBar({ night, left, center, right }) {
  const t = tokens(night);
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 20px", background: night ? "#0a0c0f" : "#e4e7ea",
      borderBottom: `1px solid ${t.edge}`, flexShrink: 0, gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>{left}</div>
      <span style={{ fontFamily: MONO, fontSize: 12, color: t.dim, whiteSpace: "nowrap" }}>{center}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: t.dim, whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}

export function CarDock({ night, climate = "climate 22.0", media = "media strip", right = "rear camera" }) {
  const t = tokens(night);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16, padding: "10px 20px",
      background: night ? "#0a0c0f" : "#e4e7ea", borderTop: `1px solid ${t.edge}`, flexShrink: 0,
    }}>
      <Meta night={night} style={{ textTransform: "none", whiteSpace: "nowrap" }}>{climate}</Meta>
      <div style={{
        flex: 1, height: 34, borderRadius: 8, display: "grid", placeItems: "center",
        ...hatchStyle(night, 8), border: `1px dashed ${t.edge}`,
      }}>
        <Meta night={night} style={{ textTransform: "none", fontSize: 10 }}>{media}</Meta>
      </div>
      <Meta night={night} style={{ textTransform: "none", whiteSpace: "nowrap" }}>{right}</Meta>
    </div>
  );
}

/** Map stand-in. Two lines of mono on hatch, exactly as the deck draws it. */
export function MapPane({ night, chip, lines = [] }) {
  const t = tokens(night);
  return (
    <div style={{ flex: 1, position: "relative", minWidth: 0, ...hatchStyle(night) }}>
      {chip && (
        <div style={{
          position: "absolute", top: 16, left: 16, background: t.card,
          border: `1px solid ${t.edge}`, borderRadius: 10, padding: "9px 14px",
          fontFamily: SANS, fontSize: 13.5, color: t.ink,
          boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        }}>
          {chip}
        </div>
      )}
      <div style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        textAlign: "center", pointerEvents: "none",
      }}>
        <div>
          {lines.map((l) => (
            <div key={l} style={{ fontFamily: MONO, fontSize: 12.5, color: t.faint, lineHeight: 1.7 }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
