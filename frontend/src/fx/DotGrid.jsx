import { useEffect, useRef } from "react";

const GAP = 30;
const RADIUS = 1.3;
const REACH = 150;

/**
 * A field of dots that swell, brighten to the accent and shy away from the
 * pointer — the DotGrid background from React Bits, redrawn for this app.
 *
 * Colours are read from the live CSS tokens (never hard-coded), so the grid
 * follows day/night. The canvas only animates while the pointer is moving or
 * the glow is still settling; otherwise it draws once and goes idle. Under
 * reduced motion it never animates at all. jsdom has no canvas, so it is skipped
 * there rather than logging "not implemented" through every test.
 */
export function DotGrid({ className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || /jsdom/i.test(navigator.userAgent)) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const p = { x: -9999, y: -9999, sx: -9999, sy: -9999, last: 0 };
    let w = 0;
    let h = 0;
    let raf = 0;
    let base = "";
    let hot = "";

    function readColours() {
      const s = getComputedStyle(document.documentElement);
      base = s.getPropertyValue("--color-fg-decorative").trim() || "gray";
      hot = s.getPropertyValue("--color-accent").trim() || "orange";
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / GAP) + 1;
      const rows = Math.ceil(h / GAP) + 1;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          let x = i * GAP;
          let y = j * GAP;
          const dx = x - p.sx;
          const dy = y - p.sy;
          const d = Math.hypot(dx, dy);
          let k = 0;
          if (d < REACH) {
            k = (1 - d / REACH) ** 2;
            x += (dx / (d || 1)) * k * 10;
            y += (dy / (d || 1)) * k * 10;
          }
          const r = RADIUS + k * 2.4;
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = base;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          if (k > 0.02) {
            ctx.globalAlpha = Math.min(1, k * 1.5);
            ctx.fillStyle = hot;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readColours();
      draw();
    }

    function tick() {
      p.sx += (p.x - p.sx) * 0.2;
      p.sy += (p.y - p.sy) * 0.2;
      draw();
      const settling = Math.hypot(p.x - p.sx, p.y - p.sy) > 0.5;
      raf = settling || performance.now() - p.last < 900 ? requestAnimationFrame(tick) : 0;
    }

    function onMove(e) {
      if (reduce) return;
      const r = canvas.getBoundingClientRect();
      p.x = e.clientX - r.left;
      p.y = e.clientY - r.top;
      if (p.sx < -999) { p.sx = p.x; p.sy = p.y; }
      p.last = performance.now();
      if (!raf) { readColours(); raf = requestAnimationFrame(tick); }
    }

    function onLeave() {
      p.x = p.sx = -9999;
      p.y = p.sy = -9999;
      draw();
    }

    size();
    window.addEventListener("resize", size);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`} />;
}
