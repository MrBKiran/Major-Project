import { useLayoutEffect, useRef, useState } from "react";

/**
 * The app's navigation on a desktop-width window: a sidebar, as a web app has,
 * instead of a row of tabs squeezed into a header. The current section is marked
 * with `aria-current`, not only by colour, and a lit bar springs between items as
 * the section changes.
 *
 * The same permission-filtered list drives this, the horizontal `SectionNav`
 * (used on narrow windows) and the command palette, so none of them can show a
 * page the person's role does not have.
 */
export function SideNav({ tabs, active, onSelect, icon }) {
  const navRef = useRef(null);
  const btnRefs = useRef({});
  const [mark, setMark] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[active];
      setMark(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !navRef.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [active, tabs.length]);

  return (
    <nav ref={navRef} aria-label="Main" className="relative flex flex-col gap-1 px-3">
      {tabs.length === 0 ? (
        <p className="px-3 py-2 text-body-sm text-fg-subtle">Your role has no pages assigned.</p>
      ) : (
        <>
          {mark && (
            <>
              <span
                aria-hidden
                className="absolute inset-x-3 rounded-xl bg-surface-card shadow-sm ring-1 ring-border transition-[top,height] duration-500 ease-[cubic-bezier(0.34,1.35,0.64,1)]"
                style={{ top: mark.top, height: mark.height }}
              />
              <span
                aria-hidden
                className="absolute -left-0 w-[3px] rounded-r-full bg-accent transition-[top,height] duration-500 ease-[cubic-bezier(0.34,1.35,0.64,1)]"
                style={{ top: mark.top + 8, height: Math.max(0, mark.height - 16) }}
              />
            </>
          )}
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              ref={(el) => { btnRefs.current[t.id] = el; }}
              onClick={() => onSelect(t.id)}
              aria-current={active === t.id ? "page" : undefined}
              className={`group relative z-[1] flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-body-sm font-medium transition-colors duration-200 ${
                active === t.id ? "text-fg-strong" : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              <span
                aria-hidden
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-110 ${
                  active === t.id ? "bg-accent/12 text-accent-ink" : "bg-surface-inset text-fg-subtle"
                }`}
              >
                {icon(t.id)}
              </span>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </>
      )}
    </nav>
  );
}
