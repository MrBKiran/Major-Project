/**
 * Cursor-following glow for anything with the `.spot` class (see index.css).
 *
 * One delegated listener on the document instead of a handler per card: the
 * console has dozens of cards and tiles, and each only needs two CSS variables
 * updated while the pointer is over it. Modelled on the spotlight-card effect
 * from React Bits / Aceternity, reduced to the part that matters — a position.
 */

let installed = false;

export function installSpotlight() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "pointermove",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(".spot") : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      // The same position, as -1…1 across the element, drives the 3D tilt in
      // index.css (.tilt / .tilt-soft) — one listener for glow and depth.
      el.style.setProperty("--tx", String(((e.clientX - r.left) / r.width - 0.5) * 2));
      el.style.setProperty("--ty", String(((e.clientY - r.top) / r.height - 0.5) * 2));
    },
    { passive: true },
  );
}
