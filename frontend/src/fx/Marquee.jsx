/**
 * A slow, endless ticker. Decorative — the content repeats and scrolls, so it is
 * hidden from assistive tech and pauses under the pointer and for reduced motion
 * (see .marquee in index.css). Two identical tracks make the loop seamless.
 */
export function Marquee({ children, className = "" }) {
  return (
    <div aria-hidden="true" className={`marquee ${className}`}>
      <div className="marquee-track">{children}</div>
      <div className="marquee-track">{children}</div>
    </div>
  );
}
