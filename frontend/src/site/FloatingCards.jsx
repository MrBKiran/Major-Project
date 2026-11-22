import { motion, useReducedMotion } from "motion/react";

/**
 * Sensor readings with weight: four cards around the headline that follow the pointer, can be picked
 * up and dragged, and settle back on a spring when let go (the badges you can swing on Badgey). They
 * make the first screen feel like a place full of live things, which is what the product watches.
 *
 * Decoration only, and honest about it: hidden from screen readers, and the same readings appear as
 * text in the live run below. Hidden entirely on small screens, where there is no pointer and no room,
 * and still when the visitor prefers reduced motion.
 */
const CARDS = [
  { id: "coolant", label: "Coolant", value: "97.2", unit: "°C", note: "rising", tone: "amber", pos: { left: "55%", top: 118 }, tilt: -6 },
  { id: "brake", label: "Brake fluid", value: "92", unit: "%", note: "steady", tone: "teal", pos: { right: "2.5%", top: 92 }, tilt: 5 },
  { id: "oil", label: "Oil pressure", value: "2.1", unit: "bar", note: "falling", tone: "rose", pos: { right: "7%", top: 250 }, tilt: -4 },
  { id: "battery", label: "Battery", value: "12.4", unit: "V", note: "steady", tone: "green", pos: { left: "63%", top: 340 }, tilt: 6 },
];

export default function FloatingCards({ bounds }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="s-floaters" aria-hidden="true">
      {CARDS.map((c, i) => (
        <motion.div
          key={c.id}
          className="s-floater"
          data-tone={c.tone}
          style={{ ...c.pos, rotate: c.tilt }}
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5 + i * 0.12, type: "spring", stiffness: 180, damping: 18 }}
          drag
          dragConstraints={bounds}
          dragElastic={0.32}
          dragSnapToOrigin
          dragTransition={{ bounceStiffness: 220, bounceDamping: 14 }}
          whileHover={{ y: -4, rotate: 0 }}
          whileDrag={{ scale: 1.07, rotate: 0, zIndex: 6, cursor: "grabbing" }}
        >
          <span className="s-floater-label">{c.label}</span>
          <span className="s-floater-value">{c.value}<small>{c.unit}</small></span>
          <span className="s-floater-note"><i className="s-dot" />{c.note}</span>
        </motion.div>
      ))}
    </div>
  );
}
