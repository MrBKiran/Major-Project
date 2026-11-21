import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useRef } from "react";

/**
 * A control that leans toward the pointer and springs back when it leaves.
 * The "magnetic button" from the Aceternity / uiverse set, written on Motion's
 * springs. Purely a transform on a wrapper — the child keeps its own focus ring,
 * click target and semantics, and nothing moves for a keyboard user or when the
 * person has asked for reduced motion.
 */
export function Magnetic({ children, strength = 0.25, className = "" }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });

  function move(e) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }

  function leave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div ref={ref} onPointerMove={move} onPointerLeave={leave} style={{ x: sx, y: sy }} className={className}>
      {children}
    </motion.div>
  );
}
