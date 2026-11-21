import { motion, useReducedMotion } from "motion/react";

/**
 * Words that resolve out of a blur one after another — the BlurText / SplitText
 * reveal from React Bits, on Motion. `parts` is a list of plain strings or
 * `{ text, className }`, so one word of a headline can carry its own colour.
 *
 * The text stays real text (each word is an inline-block span with a normal
 * space between), so selection, search and screen readers read it unchanged.
 */
export function BlurText({ parts, className = "", delay = 0.07, start = 0.1, as: Tag = "span" }) {
  const reduce = useReducedMotion();
  const words = parts.flatMap((part) => {
    const { text, className: cls = "" } = typeof part === "string" ? { text: part } : part;
    return text.split(" ").filter(Boolean).map((w) => ({ w, cls }));
  });

  return (
    <Tag className={className}>
      {words.map(({ w, cls }, i) => (
        <span key={`${w}-${i}`}>
          {reduce ? (
            <span className={cls}>{w}</span>
          ) : (
            <motion.span
              className={`inline-block ${cls}`}
              initial={{ opacity: 0, filter: "blur(12px)", y: 14 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              transition={{ duration: 0.7, delay: start + i * delay, ease: [0.16, 1, 0.3, 1] }}
            >
              {w}
            </motion.span>
          )}
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}
