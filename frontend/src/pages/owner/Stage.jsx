/**
 * The owner's stage: the part of "My car" that is for looking at, not tapping.
 * A 3D model of the car on a turntable, the flagged part glowing where it
 * actually is, and a ring that makes "how long is left" something you feel.
 *
 * Its job follows the product's rule for owners — "a healthy vehicle should be a
 * quiet screen." Healthy: a slow scan and a green ring, nothing demanding. Alert:
 * the part pulses and the ring drains toward the deadline. Booked: calm again,
 * with the visit on the calendar. It adds no controls beyond tapping the glowing
 * marker, which opens the same "why this part" screen the button does — so
 * nothing here is needed to use the app, and it is hidden from screen readers
 * (every fact on it is also in the phone panel as text).
 *
 * Its words are deliberately its own: the panel already says "your X is wearing
 * out" and quotes the slot, and saying the same sentence twice on one page reads
 * as a mistake.
 */

import { componentLabel } from "@autosaarthi/core";
import { color } from "@autosaarthi/tokens";
import { useLayoutEffect, useRef } from "react";
import { gsap, reducedMotion, TwinScene } from "../../fx";
import { MONO, SANS, tokens } from "../../device.jsx";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const RADIUS = 46;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * A ring that drains toward a deadline. `days` of a `horizon`-day window: full
 * ring is a month or more away, empty is today. Severity sets the colour; the
 * number inside counts up as the ring draws.
 */
export function HealthRing({ days = null, horizon = 30, severity = null, booked = false, diameter = 112 }) {
  const t = tokens(false);
  const arc = useRef(null);
  const num = useRef(null);
  const fraction = days == null ? 1 : Math.max(0.04, Math.min(1, days / horizon));
  const tone = booked ? color.ok : severity === "P1" ? color.p1 : severity ? color.p2 : color.ok;

  useLayoutEffect(() => {
    const target = Math.max(0, Math.round(days ?? 0));
    if (reducedMotion()) {
      arc.current?.setAttribute("stroke-dashoffset", String(CIRC * (1 - fraction)));
      if (num.current) num.current.textContent = String(target);
      return undefined;
    }
    const counter = { v: 0 };
    const tween = gsap.timeline()
      .fromTo(arc.current, { attr: { "stroke-dashoffset": CIRC } },
        { attr: { "stroke-dashoffset": CIRC * (1 - fraction) }, duration: 1.5, ease: "power3.out" }, 0)
      .to(counter, {
        v: target, duration: 1.5, ease: "power3.out",
        onUpdate: () => { if (num.current) num.current.textContent = String(Math.round(counter.v)); },
      }, 0);
    return () => tween.kill();
  }, [days, fraction]);

  return (
    <div style={{ position: "relative", width: diameter, height: diameter, flex: "none" }} aria-hidden="true">
      <svg viewBox="0 0 120 120" width={diameter} height={diameter} style={{ transform: "rotate(-90deg)", overflow: "visible" }}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={t.edge} strokeWidth="9" />
        <circle
          ref={arc} cx="60" cy="60" r={RADIUS} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC}
          style={{ filter: `drop-shadow(0 0 6px ${tone})` }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center",
      }}>
        <div>
          {days == null ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <>
              <div ref={num} style={{ fontFamily: MONO, fontSize: 27, fontWeight: 600, color: t.ink, lineHeight: 1 }}>0</div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: t.dim, marginTop: 3 }}>days</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function OwnerStage({ detail, top, booked = false, onOpenWhy }) {
  const t = tokens(false);
  const model = detail?.vehicle?.model ?? "car";
  const days = top?.days_to_failure ?? null;
  const flagged = !booked && top ? top : null;

  const status = booked
    ? { head: "Visit scheduled", sub: "Your service slot is held. We will remind you the day before." }
    : flagged
      ? { head: "Needs attention soon", sub: `${cap(componentLabel(flagged.component))} is the part to look at.` }
      : { head: "All systems watched", sub: "Five parts and six signals, checked continuously." };

  return (
    <section
      aria-hidden="true"
      className="spot tilt-soft relative overflow-hidden rounded-2xl border border-border bg-surface-card lg:sticky lg:top-24"
    >
      <div className="aurora"><i /><i /><i /></div>

      <div className="relative flex items-center justify-between px-6 pt-5">
        <div>
          <p className="text-label text-fg-muted">Digital twin · live</p>
          <h2 className="text-title font-semibold text-fg-strong">{`Your ${model}`}</h2>
        </div>
        <span
          className="rounded-md border px-2.5 py-1 text-caption font-semibold"
          style={{
            color: booked || !flagged ? t.positive : t.pillInk,
            background: booked || !flagged ? t.okBg : t.pillBg,
            borderColor: booked || !flagged ? t.okBorder : "transparent",
          }}
        >
          {booked ? "On the calendar" : flagged ? "Watching closely" : "Healthy"}
        </span>
      </div>

      <TwinScene
        className="relative h-[400px] w-full"
        part={flagged?.component ?? null}
        severity={flagged?.severity ?? null}
        caption={flagged ? `${cap(componentLabel(flagged.component))}${days != null ? ` · ~${Math.round(days)} d` : ""}` : ""}
        onSelect={(part) => { if (flagged && part === flagged.component) onOpenWhy?.(); }}
      />
      <p className="relative -mt-2 px-6 pb-2 text-caption text-fg-subtle">
        Drag to turn the car{flagged ? " · tap the glowing marker for the evidence" : " · hover a marker to see what is watched"}
      </p>

      <div className="relative flex items-center gap-5 border-t border-border px-6 py-4">
        <HealthRing days={flagged ? days : null} severity={flagged?.severity ?? null} booked={booked} />
        <div className="min-w-0">
          <p className="text-lead font-semibold text-fg-strong">{status.head}</p>
          <p className="mt-0.5 text-body-sm text-fg-muted">{status.sub}</p>
        </div>
      </div>
    </section>
  );
}
