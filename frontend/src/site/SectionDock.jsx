import { motion } from "motion/react";

/**
 * Where you are on the page, and a way to jump: a small dock at the bottom of the screen that is
 * always in thumb's reach, with a marker that slides to the section being read. The top bar is left
 * with the two things a visitor needs there: the brand, and the way in.
 *
 * It steps out of the way when the footer arrives, and everything animated here is a transform or an
 * opacity, so it stays smooth while the pinned story below it scrolls.
 */
export default function SectionDock({ links, active, hidden, reduce, onGo }) {
  const shown = hidden
    ? { y: 96, opacity: 0, transitionEnd: { visibility: "hidden" } }
    : { y: 0, opacity: 1, visibility: "visible" };
  const tone = links.find(([id]) => id === active)?.[2];
  return (
    <div className="s-dock-wrap">
      <motion.nav
        aria-label="Sections"
        className="s-dock"
        data-tone={tone}
        initial={reduce ? false : { y: 96, opacity: 0 }}
        animate={shown}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 26, delay: hidden ? 0 : 0.9 }}
      >
        {links.map(([id, label, linkTone]) => {
          const on = active === id;
          return (
            <button key={id} type="button" data-tone={linkTone} onClick={() => onGo(id)} aria-current={on ? "true" : undefined}>
              {on && (
                <motion.span
                  layoutId="dock-marker"
                  className="s-dock-marker"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <i className="s-dock-dot" aria-hidden="true" />
              <span className="s-dock-label">{label}</span>
            </button>
          );
        })}
      </motion.nav>
    </div>
  );
}
