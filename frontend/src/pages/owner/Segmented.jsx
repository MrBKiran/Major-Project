import { motion, useReducedMotion } from "motion/react";
import { useId, useRef } from "react";
import { SANS, tokens } from "../../device.jsx";
import { useNight } from "../../night.jsx";

/**
 * Two or three choices, one of them always chosen, with a thumb that slides between them (the
 * segmented chips on Congrue, the switches in React Bits' micro set). A radio group underneath:
 * arrow keys move the choice, Tab leaves the group, a screen reader hears "radio, 1 of 2".
 */
export function Segmented({ label, value, onChange, options }) {
  const night = useNight();
  const t = tokens(night);
  const reduce = useReducedMotion();
  const id = useId();
  const refs = useRef([]);

  function move(i, step) {
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: "flex", padding: 3, borderRadius: 12, background: t.control, border: `1px solid ${t.edge}` }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
            }}
            style={{
              position: "relative", flex: 1, border: "none", background: "transparent", cursor: "pointer",
              padding: "9px 12px", borderRadius: 9, fontFamily: SANS, fontSize: 14, fontWeight: 600,
              color: on ? t.ink : t.dim, transition: "color 160ms ease",
            }}
          >
            {on && (
              <motion.span
                aria-hidden="true"
                layoutId={`seg-${id}`}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                style={{
                  position: "absolute", inset: 0, borderRadius: 9, background: t.card,
                  boxShadow: `0 1px 2px rgba(0,0,0,0.18), inset 0 0 0 1px ${t.edge}`,
                }}
              />
            )}
            <span style={{ position: "relative" }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
