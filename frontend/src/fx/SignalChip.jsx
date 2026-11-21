import { motion, useReducedMotion } from "motion/react";

const DOTS = { danger: "bg-p1", warn: "bg-p2", good: "bg-ok", info: "bg-p3", accent: "bg-accent" };

/**
 * A glass chip that floats in over the hero — one fleet signal, one outcome.
 * Enters with a spring, then drifts. `delay` staggers the entrance and offsets
 * the drift so a group of chips never bobs in unison.
 */
export function SignalChip({ tone = "info", label, value, delay = 0, className = "" }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      initial={reduce ? false : { opacity: 0, scale: 0.8, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.9 + delay }}
      className={`absolute ${className}`}
    >
      <div
        className="glass float-y flex items-center gap-2.5 rounded-xl px-3 py-2 shadow-[0_14px_34px_-18px_rgba(0,0,0,0.45)]"
        style={{ animationDelay: `${-delay * 3}s` }}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full pulse-soft ${DOTS[tone]}`} />
        <span className="leading-tight">
          <span className="block text-caption text-fg-muted">{label}</span>
          <span className="num block text-body-sm font-semibold text-fg-strong">{value}</span>
        </span>
      </div>
    </motion.div>
  );
}
