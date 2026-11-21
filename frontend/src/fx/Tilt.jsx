import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useRef } from "react";

/**
 * A panel that tilts in 3D toward the pointer, with a soft glare that tracks it.
 * The 3D-card effect from Aceternity, rebuilt on Motion springs and the app's
 * tokens (the glare is the on-accent white, not a hard-coded colour).
 *
 * A transform makes this element the containing block for any `position: fixed`
 * descendant — so use it around a self-contained panel (the sign-in card), never
 * around a page that can open a modal.
 */
export function Tilt({ children, className = "", max = 6 }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 180, damping: 20, mass: 0.6 };
  const sx = useSpring(px, spring);
  const sy = useSpring(py, spring);
  const rotateY = useTransform(sx, [0, 1], [-max, max]);
  const rotateX = useTransform(sy, [0, 1], [max, -max]);
  const gx = useTransform(sx, (v) => `${v * 100}%`);
  const gy = useTransform(sy, (v) => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, color-mix(in srgb, var(--color-on-accent) 14%, transparent), transparent 60%)`;

  function move(e) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  }

  function leave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <div style={{ perspective: 1100 }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={move}
        onPointerLeave={leave}
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="group relative rounded-[inherit]"
      >
        {children}
        {!reduce && (
          <motion.span
            aria-hidden
            style={{ background: glare }}
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
        )}
      </motion.div>
    </div>
  );
}
