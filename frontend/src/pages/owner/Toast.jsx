import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SANS, tokens } from "../../device.jsx";
import { useNight } from "../../night.jsx";

/**
 * A short line that says a small thing happened ("Booking number copied") and goes away by itself
 * (React Bits' swipe toast, kept to what it is for). It sits where the thumb is, is announced to a
 * screen reader as it appears, pauses while the pointer is on it, and never asks for anything.
 * At most three at once: the oldest makes way.
 */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 3200;
let count = 0;

export function ToastProvider({ children }) {
  const night = useNight();
  const t = tokens(night);
  const reduce = useReducedMotion();
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const drop = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((all) => all.filter((x) => x.id !== id));
  }, []);

  const arm = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => drop(id), LIFETIME_MS));
  }, [drop]);

  const toast = useCallback((message) => {
    const id = ++count;
    setItems((all) => [...all.slice(-2), { id, message }]);
    arm(id);
  }, [arm]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed", left: 0, right: 0, bottom: "calc(16px + env(safe-area-inset-bottom))", zIndex: 50,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {items.map((x) => (
            <motion.div
              key={x.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
              onPointerEnter={() => clearTimeout(timers.current.get(x.id))}
              onPointerLeave={() => arm(x.id)}
              onClick={() => drop(x.id)}
              style={{
                pointerEvents: "auto", cursor: "pointer", maxWidth: "min(92vw, 420px)", padding: "11px 16px",
                borderRadius: 12, background: t.ink, color: t.page, fontFamily: SANS, fontSize: 14, fontWeight: 500,
                boxShadow: "0 12px 30px -12px rgba(0,0,0,0.45)",
              }}
            >
              {x.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
