import { useEffect, useRef } from "react";
import { gsap } from "../fx/gsap.js";

/**
 * A ring that trails the pointer and tightens when it presses — a small thing,
 * but it is the first sign the page is alive. Skipped on touch screens (CSS
 * hides it where there is no hover) and under reduced motion; the real cursor
 * is never hidden, so nothing depends on this.
 */
export function Cursor() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const x = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3" });
    const move = (e) => { x(e.clientX); y(e.clientY); };
    const down = () => el.setAttribute("data-down", "true");
    const up = () => el.setAttribute("data-down", "false");
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return <div ref={ref} aria-hidden="true" className="site-cursor" data-down="false" />;
}
