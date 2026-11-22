import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { webglAvailable } from "../fx/Scene.jsx";
import { HELPERS, SCENARIOS } from "./content.js";
import { useDetail } from "./detail.jsx";

// three.js is the heaviest thing on the page; the car is its own chunk.
const HeroCar = lazy(() => import("./HeroCar.jsx"));

/**
 * The hero: the product running, not a picture of it. Four situations — a car
 * that needs a repair, a driver on the road, a factory problem, an attack —
 * each played one helper at a time, in plain words: who is working, what they
 * are doing, and what came of it. Choosing a situation re-colours the card and
 * the car with it. With technical details on, each step also shows the agent's
 * reasoning and the exact tool it called.
 *
 * It plays only while on screen, moves on when a situation finishes, and under
 * reduced motion shows every step already done.
 */

const PHASES = ["think", "tool", "exec"];
const PHASE_MS = { think: 1300, tool: 1100, exec: 1500 };
const STEP_MS = PHASE_MS.think + PHASE_MS.tool + PHASE_MS.exec;
const HOLD_MS = 4200;

const STATUS_TONE = { rising: "rose", falling: "rose", high: "rose", normal: "green", driving: "amber" };

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

function Tick() {
  return (
    <svg viewBox="0 0 16 16" className="s-step-icon" aria-hidden="true">
      <circle cx="8" cy="8" r="7" className="s-step-icon-ring" />
      <path d="M5 8.2 7.1 10.2 11 6" className="s-step-icon-tick" />
    </svg>
  );
}

function TechRows({ step, phase, state }) {
  const at = state === "done" ? PHASES.length : PHASES.indexOf(phase);
  const mark = (i) => (at > i ? <Tick /> : <span className="s-step-spin" aria-hidden="true" />);
  return (
    <div className="s-step-tech">
      <div className="s-step-row">{mark(0)}<div><b>Reasoning</b><p>{step.tech.think}</p></div></div>
      {at >= 1 && (
        <div className="s-step-row">{mark(1)}<div><b>Tool call</b><p className="s-code"><span>{step.tech.tool}</span>{step.tech.args}</p></div></div>
      )}
      {at >= 2 && (
        <div className="s-step-row">{mark(2)}<div><b>Returned</b><p className="s-code">{at > 2 ? step.tech.result : "…"}</p></div></div>
      )}
    </div>
  );
}

function Step({ step, n, total, state, phase }) {
  const { on: tech } = useDetail();
  const helper = HELPERS[step.helper];
  const status = state === "done" ? (step.blocked ? "Stopped" : "Done") : state === "active" ? "Working" : "Up next";
  return (
    <li className="s-step" data-state={state} data-tone={helper.tone} data-blocked={step.blocked ? "true" : undefined}>
      <div className="s-step-head">
        <span className="s-step-n" aria-hidden="true">{n}</span>
        <span className="s-step-who">
          <b>{helper.name}</b>
          {step.hijacked && <em className="s-step-tag">taken over</em>}
          {tech && <code>{helper.tech}</code>}
        </span>
        <span className="s-step-status"><span className="sr-only">Step {n} of {total}: </span>{status}</span>
      </div>
      {state === "active" && (
        <div className="s-step-body">
          <p className="s-step-doing">{step.doing}</p>
          {tech ? <TechRows step={step} phase={phase} state={state} /> : (
            <span className="s-step-bar" aria-hidden="true"><i style={{ animationDuration: `${STEP_MS}ms` }} /></span>
          )}
        </div>
      )}
      {state === "done" && (
        <div className="s-step-body">
          <p className="s-step-result">{step.result}</p>
          {tech && <p className="s-code s-step-techresult"><span>{step.tech.tool}</span>{step.tech.result}</p>}
        </div>
      )}
    </li>
  );
}

export default function LiveRun() {
  const reduce = reducedMotion();
  const { on: tech } = useDetail();
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
  const who = HELPERS[sc.steps[current].helper];
  const status = step >= total
    ? `All done · ${total} of ${total} steps`
    : tech
      ? `Step ${current + 1} of ${total} · ${who.tech} · ${phase === "think" ? "reasoning" : phase === "tool" ? "calling a tool" : "waiting for the result"}`
      : `Step ${current + 1} of ${total} · ${who.name} is working`;

  return (
    <div ref={root} className="s-run" data-tone={sc.tone}>
      <div className="s-run-tabs" role="tablist" aria-label="Choose a situation" onKeyDown={onKey}>
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
          <ul className="s-run-readings" aria-label="What the car is reporting">
            {sc.readings.map((r) => (
              <li key={r.label}>
                <span>{r.label}</span>
                <b>{r.value}</b>
                {r.status && <em data-tone={STATUS_TONE[r.status]}>{r.status}</em>}
              </li>
            ))}
          </ul>
          {car && <p className="s-run-drag" aria-hidden="true">Drag to turn the car</p>}
        </div>

        <div className="s-run-log">
          <div className="s-run-trigger">
            <span className="s-run-trigger-tag"><i className="s-dot" />What's happening</span>
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
            <button type="button" className="s-run-replay" onClick={() => choose(index)}>Play it again</button>
          )}
        </div>
      </div>
    </div>
  );
}
