/**
 * GSAP, registered once, plus the two helpers the screens share.
 *
 * Motion (motion.dev) drives the springy, pointer-following pieces; GSAP drives
 * the choreographed ones — timelines, staggers and text splitting — where one
 * clock has to coordinate many elements. Both stop for prefers-reduced-motion.
 */

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);

export { gsap, SplitText };

export function reducedMotion() {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/**
 * Every card (`.spot`) that appears inside `root` rises into place in 3D: it
 * starts tipped back and a little low, and swings upright in a stagger. Pages
 * fetch their data after they mount, so this watches for cards arriving rather
 * than running once — a skeleton swapping for the real card animates too.
 *
 * `clearProps` removes the inline transform when each tween ends. That matters:
 * a lingering transform would make the card a containing block for `position:
 * fixed` children, and would fight the hover tilt in index.css.
 */
export function revealOnMount(root) {
  if (!root || typeof MutationObserver === "undefined" || reducedMotion()) return () => {};

  const seen = new WeakSet();
  let queue = [];
  let raf = 0;

  const flush = () => {
    raf = 0;
    const live = queue.filter((el) => el.isConnected);
    queue = [];
    // A card inside a card rides its parent's motion; animating both would stack.
    const top = live.filter((el) => !live.some((other) => other !== el && other.contains(el)));
    if (!top.length) return;
    gsap.fromTo(
      top,
      { opacity: 0, y: 28, rotationX: 10, transformPerspective: 900, transformOrigin: "50% 100%" },
      {
        opacity: 1, y: 0, rotationX: 0, duration: 0.85, ease: "power3.out", stagger: 0.07,
        clearProps: "opacity,transform,transformPerspective,transformOrigin",
      },
    );
  };

  const consider = (node) => {
    if (node.nodeType !== 1) return;
    const found = node.matches?.(".spot") ? [node] : [];
    found.push(...(node.querySelectorAll?.(".spot") ?? []));
    for (const el of found) {
      if (!seen.has(el)) { seen.add(el); queue.push(el); }
    }
  };

  consider(root);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach(consider);
    if (queue.length && !raf) raf = requestAnimationFrame(flush);
  });
  observer.observe(root, { childList: true, subtree: true });
  if (queue.length) raf = requestAnimationFrame(flush);

  return () => {
    observer.disconnect();
    cancelAnimationFrame(raf);
  };
}
