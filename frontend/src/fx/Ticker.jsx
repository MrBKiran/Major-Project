import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A number that travels to its new value instead of jumping: the figure on a calculator that moves as
 * the slider does. From Magic UI's Number Ticker / React Bits' Count Up, rewritten on Motion.
 *
 * It animates FROM WHAT IS SHOWN, not from zero, so dragging a slider back and forth never restarts
 * the count. The animated text is hidden from screen readers (it would announce every frame); a
 * visually hidden copy holds the final value, so what is read out is always the real number.
 * With reduced motion, or in a test browser, it simply shows the value.
 */
const rupees = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export function Ticker({ value, format = rupees, duration = 0.55, className, style }) {
  const reduce = useReducedMotion();
  const instant = reduce || (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent));
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (instant || !Number.isFinite(value)) {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { from.current = v; setShown(v); },
      onComplete: () => { from.current = value; setShown(value); },
    });
    return () => controls.stop();
  }, [value, duration, instant]);

  return (
    <span className={className} style={style}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
