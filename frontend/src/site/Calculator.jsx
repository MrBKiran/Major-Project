import { useRef, useState } from "react";
import { Ticker } from "../fx";
import { COSTS } from "./content.js";

/**
 * "What waiting costs": the proof as something to try, not a claim to read. Pick a part, then flip
 * between fixing it early and waiting for it to fail, and the bill, the bars and the multiple all
 * move. (The before/after switch that does the persuading on Congrue, on our own repair-versus-
 * breakdown figures.) Nothing here is scroll-driven: it is a small tool, and it works with the
 * keyboard, the mouse or a thumb.
 */

const rupees = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const times = (v) => `${v.toFixed(1)}×`;
const WHEN = [
  { id: "early", label: "Fix it early" },
  { id: "late", label: "Wait for the breakdown" },
];

/** Arrow keys move a radio group's choice and its focus together. */
function useRadioKeys(ids, value, onChange) {
  const refs = useRef([]);
  const keys = (i) => (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + ids.length) % ids.length;
    onChange(ids[next]);
    refs.current[next]?.focus();
  };
  return { ref: (i) => (el) => { refs.current[i] = el; }, keys, tab: (id) => (id === value ? 0 : -1) };
}

export default function Calculator() {
  const [partId, setPartId] = useState("water_pump");
  const [when, setWhen] = useState("early");
  const part = COSTS.find((c) => c.id === partId);
  const early = when === "early";
  const total = early ? part.repair : part.breakdown;
  const ratio = part.breakdown / part.repair;
  const parts = useRadioKeys(COSTS.map((c) => c.id), partId, setPartId);
  const whens = useRadioKeys(WHEN.map((w) => w.id), when, setWhen);

  return (
    <section id="cost" className="s-section s-cost" aria-labelledby="cost-title">
      <div className="s-wrap">
        <div className="s-head">
          <p className="s-eyebrow">Try it</p>
          <h2 id="cost-title" className="s-h2">What waiting costs.</h2>
          <p className="s-lead">
            Pick a part, then choose when it gets fixed. These are the repair and breakdown figures AutoSaarthi
            quotes owners, so the difference you see is the one an owner is shown.
          </p>
        </div>

        <div className="s-calc" data-tone={part.tone}>
          <div className="s-calc-controls">
            <p className="s-calc-k" id="calc-part">Which part is wearing out?</p>
            <div role="radiogroup" aria-labelledby="calc-part" className="s-parts">
              {COSTS.map((c, i) => (
                <button
                  key={c.id}
                  ref={parts.ref(i)}
                  type="button"
                  role="radio"
                  aria-checked={c.id === partId}
                  tabIndex={parts.tab(c.id)}
                  data-tone={c.tone}
                  className="s-part"
                  onClick={() => setPartId(c.id)}
                  onKeyDown={parts.keys(i)}
                >
                  <i className="s-dot" aria-hidden="true" />
                  {c.label}
                </button>
              ))}
            </div>

            <p className="s-calc-k" id="calc-when">And when does it get fixed?</p>
            <div role="radiogroup" aria-labelledby="calc-when" className="s-seg">
              <i className="s-seg-thumb" aria-hidden="true" data-pos={early ? 0 : 1} />
              {WHEN.map((w, i) => (
                <button
                  key={w.id}
                  ref={whens.ref(i)}
                  type="button"
                  role="radio"
                  aria-checked={w.id === when}
                  tabIndex={whens.tab(w.id)}
                  className="s-seg-opt"
                  onClick={() => setWhen(w.id)}
                  onKeyDown={whens.keys(i)}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <p className="s-calc-warn">
              {part.critical && <strong>A safety part. </strong>}
              The car's readings give about <b>{part.warning} days</b> of notice before this one fails.
            </p>
          </div>

          <div className="s-calc-out" data-when={when}>
            <p className="s-calc-k">{early ? "You pay" : "You would pay"}</p>
            <p className="s-calc-total"><Ticker value={total} format={rupees} /></p>
            <p className="s-calc-sub" aria-live="polite">
              {early
                ? `Once, at a time that suits you: about ${part.minutes} minutes in the workshop.`
                : part.breaks}
            </p>

            <div className="s-calc-bars">
              {[["early", "Fix it early", part.repair], ["late", "Wait for the breakdown", part.breakdown]].map(([id, label, value]) => (
                <button
                  key={id}
                  type="button"
                  className="s-bar"
                  data-on={when === id ? "true" : undefined}
                  data-kind={id}
                  aria-pressed={when === id}
                  onClick={() => setWhen(id)}
                >
                  <span className="s-bar-top"><span>{label}</span><b>{rupees(value)}</b></span>
                  <span className="s-bar-track" aria-hidden="true">
                    <i style={{ width: `${(value / part.breakdown) * 100}%` }} />
                  </span>
                </button>
              ))}
            </div>

            <p className="s-calc-ratio">
              Waiting costs <b><Ticker value={ratio} format={times} /></b> as much{!early && ", and that is before the day you lose"}.
            </p>
          </div>
        </div>

        <p className="s-calc-foot">
          Figures are typical for the cars shown. Real prices vary by car, part and city, and a warning is a
          prediction from the car's readings, not a promise.
        </p>
      </div>
    </section>
  );
}
