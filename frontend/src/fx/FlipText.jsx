import { useLayoutEffect, useRef } from "react";
import { gsap, reducedMotion, SplitText } from "./gsap.js";

/**
 * A line whose letters flip up out of the page one after another, each turning
 * on its own X axis in perspective — GSAP's SplitText doing the splitting, a
 * stagger doing the choreography. The text is still ordinary text: SplitText adds
 * an aria-label to the parent so a screen reader reads the line, not the letters.
 */
export function FlipText({ text, className = "", delay = 0.2 }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return undefined;
    let split;
    const ctx = gsap.context(() => {
      split = SplitText.create(el, { type: "chars", aria: "auto" });
      gsap.from(split.chars, {
        opacity: 0,
        rotationX: -90,
        y: 10,
        transformOrigin: "50% 50% -8px",
        transformPerspective: 500,
        stagger: 0.028,
        duration: 0.75,
        ease: "back.out(2)",
        delay,
        clearProps: "opacity,transform,transformPerspective,transformOrigin",
      });
    }, el);
    return () => {
      ctx.revert();
      split?.revert?.();
    };
  }, [text, delay]);

  return <p ref={ref} className={className}>{text}</p>;
}
