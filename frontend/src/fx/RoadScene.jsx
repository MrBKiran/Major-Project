import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

/**
 * The brand's road, in motion: the "A" of the mark is a road narrowing to the
 * horizon, so the sign-in hero is that road with a car on it.
 *
 * The depth is one trick. Each lane dash is drawn once, as it looks at the
 * bottom of the screen, and scaled about the vanishing point from nothing up to
 * full size (`.road-dash` in index.css). Scaling toward a point is exactly what
 * perspective does, so a stream of identical dashes reads as a road coming at
 * you — no 3D engine, a few kilobytes. Rings sweep out from the horizon like a
 * prediction scan. The car steers a little toward the pointer.
 *
 * All paint is CSS variables, so the scene follows day/night.
 */

const VP = 236; // horizon y; the vanishing point is (400, VP)
const DASHES = 9;
const SPEED = 2.2; // seconds for one dash to arrive

// Perspective-correct strip: half-width grows linearly with distance below the horizon.
function strip(cx0, cx1, y0, y1, k = 0.035) {
  const hw = (y) => k * (y - VP);
  return `${cx0 - hw(y0)},${y0} ${cx0 + hw(y0)},${y0} ${cx1 + hw(y1)},${y1} ${cx1 - hw(y1)},${y1}`;
}

const CENTRE = strip(400, 400, 508, 600);
const LANE_L = strip(400 - 0.55 * (508 - VP), 400 - 0.55 * (600 - VP), 508, 600, 0.022);
const LANE_R = strip(400 + 0.55 * (508 - VP), 400 + 0.55 * (600 - VP), 508, 600, 0.022);

const SKYLINE = [
  [292, 22], [310, 34], [330, 16], [346, 28], [368, 40], [390, 20],
  [414, 30], [436, 18], [456, 36], [480, 24], [500, 14], [520, 26],
];

export function RoadScene({ className = "" }) {
  const reduce = useReducedMotion();
  const wrap = useRef(null);
  const px = useMotionValue(0.5);
  const spx = useSpring(px, { stiffness: 60, damping: 14 });
  const carX = useTransform(spx, [0, 1], [-80, 80]);
  const skyX = useTransform(spx, [0, 1], [10, -10]);

  useEffect(() => {
    if (reduce) return undefined;
    const onMove = (e) => {
      const r = wrap.current?.getBoundingClientRect();
      if (r) px.set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, px]);

  return (
    <div ref={wrap} aria-hidden="true" className={className}>
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMax slice" className="h-full w-full" focusable="false">
        <defs>
          <radialGradient id="rs-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="rs-fog" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-surface-page)", stopOpacity: 0.95 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-surface-page)", stopOpacity: 0 }} />
          </linearGradient>
          <filter id="rs-bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        <motion.g style={{ x: skyX }}>
          <ellipse cx="400" cy={VP} rx="380" ry="150" fill="url(#rs-glow)" />
          {SKYLINE.map(([x, h]) => (
            <rect key={x} x={x} y={VP - h} width="14" height={h} style={{ fill: "var(--color-border)" }} />
          ))}
        </motion.g>

        <rect x="0" y={VP} width="800" height={600 - VP} style={{ fill: "var(--color-surface-panel)" }} />
        <polygon points={`390,${VP} 410,${VP} 800,600 0,600`} style={{ fill: "var(--color-chrome)" }} />
        <line x1="390" y1={VP} x2="0" y2="600" strokeWidth="3" style={{ stroke: "var(--color-border-strong)", opacity: 0.55 }} />
        <line x1="410" y1={VP} x2="800" y2="600" strokeWidth="3" style={{ stroke: "var(--color-border-strong)", opacity: 0.55 }} />

        {[0, 1.4, 2.8].map((d) => (
          <ellipse
            key={d}
            className="road-scan"
            cx="400"
            cy={VP}
            rx="430"
            ry="96"
            fill="none"
            strokeWidth="2"
            style={{ stroke: "var(--color-accent)", animationDelay: `${-d}s` }}
          />
        ))}

        {Array.from({ length: DASHES }, (_, i) => (
          <g
            key={i}
            className="road-dash"
            style={{
              "--s": (((i + 1) / DASHES) ** 2.4).toFixed(3),
              animationDelay: `${-(i * SPEED) / DASHES}s`,
              animationDuration: `${SPEED}s`,
            }}
          >
            <polygon points={CENTRE} style={{ fill: "var(--color-accent)" }} />
            <polygon points={LANE_L} style={{ fill: "var(--color-border-strong)", opacity: 0.6 }} />
            <polygon points={LANE_R} style={{ fill: "var(--color-border-strong)", opacity: 0.6 }} />
          </g>
        ))}

        <rect x="0" y={VP - 2} width="800" height="70" fill="url(#rs-fog)" />

        <motion.g style={{ x: carX }}>
          <g className="road-car" transform="translate(400 548) scale(1.35) translate(-400 -548)">
            <ellipse cx="400" cy="548" rx="96" ry="9" fill="black" fillOpacity="0.28" />
            <ellipse cx="400" cy="508" rx="120" ry="34" fill="url(#rs-glow)" />
            <rect x="338" y="470" width="124" height="54" rx="15" style={{ fill: "var(--color-device-ring)", stroke: "var(--color-border-strong)" }} strokeWidth="1.5" />
            <path d="M356 472 L369 440 Q400 430 431 440 L444 472 Z" style={{ fill: "var(--color-device-ring)", stroke: "var(--color-border-strong)" }} strokeWidth="1.5" />
            <path d="M364 468 L374 446 Q400 439 426 446 L436 468 Z" style={{ fill: "var(--color-fg-subtle)", fillOpacity: 0.4 }} />
            <rect x="343" y="486" width="28" height="9" rx="4" className="road-tail" style={{ fill: "var(--color-accent)" }} />
            <rect x="429" y="486" width="28" height="9" rx="4" className="road-tail" style={{ fill: "var(--color-accent)" }} />
            <rect x="343" y="486" width="28" height="9" rx="4" filter="url(#rs-bloom)" className="road-tail" style={{ fill: "var(--color-accent)" }} />
            <rect x="429" y="486" width="28" height="9" rx="4" filter="url(#rs-bloom)" className="road-tail" style={{ fill: "var(--color-accent)" }} />
            <rect x="384" y="500" width="32" height="12" rx="3" style={{ fill: "var(--color-surface-card)" }} />
            <rect x="346" y="517" width="22" height="14" rx="4" style={{ fill: "var(--color-device-ring)" }} />
            <rect x="432" y="517" width="22" height="14" rx="4" style={{ fill: "var(--color-device-ring)" }} />
          </g>
        </motion.g>
      </svg>
    </div>
  );
}
