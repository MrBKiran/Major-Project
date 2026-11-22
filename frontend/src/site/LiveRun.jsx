import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { webglAvailable } from "../fx/Scene.jsx";
import { SCENARIOS } from "./content.js";

// three.js is the heaviest thing on the page; the car is its own chunk.
const HeroCar = lazy(() => import("./HeroCar.jsx"));

/**
 * The hero: the product running, not a picture of it. Four real runs — an
 * owner's car, a car on the move, a plant-quality cluster and an attack — each
 * played step by step the way the agents take them: think, pick the tool,
 * execute. Choosing a run re-colours the whole card and the car with it.
 *
 * It plays only while on screen, moves on to the next run when one finishes, and
 * under reduced motion shows every step already done.
 */

const PHASES = ["think", "tool", "exec"];
const PHASE_MS = { think: 1100, tool: 1000, exec: 1500 };
const HOLD_MS = 3800;

export function SvgCar({ className = "" }) {
  return (
    <svg viewBox="0 0 480 200" className={className} aria-hidden="true">
      <ellipse cx="240" cy="178" rx="210" ry="12" className="s-svgcar-shadow" />
      <path
        className="s-svgcar-body"
        d="M22 150 L22 108 Q22 92 38 90 L150 84 L212 30 Q220 24 236 24 L402 22 Q418 22 424 34 L440 84 Q458 88 458 104 L458 150 Q458 158 450 158 L404 158 A44 44 0 0 0 318 158 L160 158 A44 44 0 0 0 74 158 L30 158 Q22 158 22 150 Z"
      />
      <path className="s-svgcar-glass" d="M162 84 L216 38 Q222 34 232 34 L300 34 L300 84 Z M314 84 L314 34 L398 33 Q408 33 412 42 L426 84 Z" />
      {[117, 361].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="158" r="34" className="s-svgcar-tyre" />
          <circle cx={cx} cy="158" r="19" className="s-svgcar-rim" />
        </g>
      ))}
    </svg>
  );
}

function StepIcon({ state }) {
  if (state === "done") {
    return (
      <svg viewBox="0 0 16 16" className="s-step-icon" aria-hidden="true">
        <circle cx="8" cy="8" r="7" className="s-step-icon-ring" />
        <path d="M5 8.2 7.1 10.2 11 6" className="s-step-icon-tick" />
      </svg>
    );
  }
  if (state === "active") return <span className="s-step-spin" aria-hidden="true" />;
  return <span className="s-step-wait" aria-hidden="true" />;
}

function Step({ step, n, total, state, phase }) {
  const reached = (p) => state === "done" || (state === "active" && PHASES.indexOf(phase) >= PHASES.indexOf(p));
  const finished = (p) => state === "done" || (state === "active" && PHASES.indexOf(phase) > PHASES.indexOf(p));
  const status = state === "done" ? (step.blocked ? "Blocked" : "Done") : state === "active" ? "Executing" : "Waiting";
  return (
    <li className="s-step" data-state={state} data-tone={step.tone} data-blocked={step.blocked ? "true" : undefined}>
      <div className="s-step-head">
        <span className="s-step-n">{String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        <span className="s-step-agent"><i className="s-dot" />{step.agent}</span>
        <span className="s-step-status">{status}</span>
      </div>
      {state === "done" && <p className="s-step-result">{step.result}</p>}
      {state === "active" && (
        <div className="s-step-body">
          <div className="s-step-row" data-on={reached("think")}>
            <StepIcon state={finished("think") ? "done" : "active"} />
            <div><b>Think and reason</b><p>{step.think}</p></div>
          </div>
          {reached("tool") && (
            <div className="s-step-row">
              <StepIcon state={finished("tool") ? "done" : "active"} />
              <div>
                <b>Pick the right tool</b>
                <p className="s-code"><span>{step.tool}</span> {step.args}</p>
              </div>
            </div>
          )}
          {reached("exec") && (
            <div className="s-step-row">
              <StepIcon state="active" />
              <div className="min-w-0 flex-1">
                <b>Execute</b>
                <p>Calling {step.tool.split(".")[0]}…</p>
                <span className="s-step-bar"><i style={{ animationDuration: `${PHASE_MS.exec}ms` }} /></span>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function LiveRun() {
  const reduce = reducedMotion();
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(reduce ? Infinity : 0);
  const [phase, setPhase] = useState("think");
  const [onScreen, setOnScreen] = useState(false);
  const [car, setCar] = useState(webglAvailable);
  const root = useRef(null);
  const tabs = useRef([]);
  const sc = SCENARIOS[index];
  const total = sc.steps.length;

  const choose = useCallback((i) => {
    setIndex(i);
    setStep(reduce ? Infinity : 0);
    setPhase("think");
  }, [reduce]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The clock: one timer for whichever beat comes next.
  useEffect(() => {
    if (reduce || !onScreen) return undefined;
    if (step >= total) {
      const t = window.setTimeout(() => choose((index + 1) % SCENARIOS.length), HOLD_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      const next = PHASES.indexOf(phase) + 1;
      if (next < PHASES.length) setPhase(PHASES[next]);
      else { setStep((s) => s + 1); setPhase("think"); }
    }, PHASE_MS[phase]);
    return () => window.clearTimeout(t);
  }, [reduce, onScreen, step, phase, total, index, choose]);

  const onKey = (e) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + SCENARIOS.length) % SCENARIOS.length;
    choose(next);
    tabs.current[next]?.focus();
  };

  const current = Math.min(step, total - 1);
  const status = step >= total
    ? `Run complete · ${total} of ${total} steps`
    : `Step ${current + 1} of ${total} · ${sc.steps[current].agent} · ${phase === "think" ? "Thinking" : phase === "tool" ? "Choosing a tool" : "Executing"}`;

  return (
    <div ref={root} className="s-run" data-tone={sc.tone}>
      <div className="s-run-tabs" role="tablist" aria-label="Choose a run" onKeyDown={onKey}>
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            ref={(b) => { tabs.current[i] = b; }}
            type="button"
            role="tab"
            id={`run-tab-${s.id}`}
            aria-selected={i === index}
            aria-controls="run-panel"
            tabIndex={i === index ? 0 : -1}
            data-tone={s.tone}
            onClick={() => choose(i)}
          >
            <i className="s-dot" />{s.tab}
          </button>
        ))}
      </div>

      <div className="s-run-body" role="tabpanel" id="run-panel" aria-labelledby={`run-tab-${sc.id}`}>
        <div className="s-run-stage">
          {car ? (
            <Suspense fallback={<SvgCar className="s-svgcar" />}>
              <HeroCar
                paint={sc.paint}
                tone={sc.tone}
                part={sc.part}
                label={sc.flag ?? ""}
                className="s-run-car"
                onUnsupported={() => setCar(false)}
              />
            </Suspense>
          ) : (
            <SvgCar className="s-svgcar" />
          )}
          <p className="s-run-vehicle">{sc.vehicle}</p>
          <ul className="s-run-readings" aria-label="Live readings">
            {sc.readings.map((r) => (
              <li key={r.label} data-trend={r.trend}>
                <span>{r.label}</span>
                <b>{r.value}{r.trend === "up" ? " ↑" : r.trend === "down" ? " ↓" : ""}</b>
              </li>
            ))}
          </ul>
          {car && <p className="s-run-drag" aria-hidden="true">Drag to turn the car</p>}
        </div>

        <div className="s-run-log">
          <div className="s-run-trigger">
            <span className="s-run-trigger-tag"><i className="s-dot" />Signal</span>
            <p>{sc.trigger}</p>
          </div>
          <p className="s-run-status" aria-live="polite">{status}</p>
          <ol className="s-steps">
            {sc.steps.map((st, i) => (
              <Step
                key={`${sc.id}-${i}`}
                step={st}
                n={i + 1}
                total={total}
                phase={phase}
                state={i < step ? "done" : i === step ? "active" : "waiting"}
              />
            ))}
          </ol>
          {step >= total && (
            <button type="button" className="s-run-replay" onClick={() => choose(index)}>Replay this run</button>
          )}
        </div>
      </div>
    </div>
  );
}
