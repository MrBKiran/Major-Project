import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Ctrl/⌘ + K: jump anywhere without leaving the keyboard. The command-menu
 * pattern from Untitled UI / Aceternity, written to the same accessibility bar
 * as `Dialog` in ui.jsx — a modal dialog with a labelled combobox, a listbox the
 * arrow keys move through, Escape to close, and focus returned to whatever had
 * it before.
 *
 * `items` are `{ id, label, hint?, keywords?, icon?, run }`.
 */
function matches(item, q) {
  if (!q) return true;
  const hay = `${item.label} ${item.keywords ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((part) => hay.includes(part));
}

export function CommandPalette({ open, onClose, items }) {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  const opener = useRef(null);
  const listId = useId();
  const labelId = useId();

  const results = useMemo(() => items.filter((i) => matches(i, query)), [items, query]);
  const active = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    setQuery("");
    setIndex(0);
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      opener.current?.focus?.();
    };
  }, [open]);

  function choose(item) {
    if (!item) return;
    onClose();
    item.run();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (results.length ? (Math.min(i, results.length - 1) + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (results.length ? (Math.min(i, results.length - 1) - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop; the list is driven by arrows
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          data-testid="palette-backdrop"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-sm"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="beam w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface-card shadow-2xl"
          >
            <h2 id={labelId} className="sr-only">Command palette</h2>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-fg-muted">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={input}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
                aria-label="Jump to"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
                placeholder="Jump to a page or action…"
                className="w-full rounded-md border border-border-strong bg-transparent px-2.5 py-1.5 text-body text-fg-strong outline-none placeholder:text-fg-subtle focus:border-accent/60"
              />
              <kbd className="kbd">Esc</kbd>
            </div>

            <ul id={listId} role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto p-1.5">
              {results.length === 0 && (
                <li role="presentation" className="px-3 py-6 text-center text-body-sm text-fg-muted">
                  Nothing matches “{query}”.
                </li>
              )}
              {results.map((item, i) => (
                <li
                  key={item.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerMove={() => setIndex(i)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-body-sm transition-colors duration-100 ${
                    i === active ? "bg-surface-inset text-fg-strong" : "text-fg-secondary"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {item.icon && <span aria-hidden className={i === active ? "text-accent-ink" : "text-fg-subtle"}>{item.icon}</span>}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.hint && <span className="shrink-0 text-caption text-fg-muted">{item.hint}</span>}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-4 border-t border-border bg-surface-page px-4 py-2 text-caption text-fg-muted">
              <span className="flex items-center gap-1.5"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
              <span className="flex items-center gap-1.5"><kbd className="kbd">↵</kbd> open</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Ctrl/⌘ + K toggles; returns the open state and its setter. */
export function usePaletteHotkey() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}
