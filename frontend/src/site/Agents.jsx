import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { AGENTS } from "./content.js";

/**
 * Seven agents, one orchestra — and what each is *not* allowed to do, which is
 * the point. The lists are the policy file's own (config/agent_policy.yaml).
 *
 * "Run the orchestra" hands a baton down the chain the way a real run goes:
 * the Master plans, each worker lights up with the tool it calls, and the
 * Master closes the run. Every card is a button too: pressing one pins it.
 */

const RUN = [
  ["master", "runs.write_plan"],
  ["data", "telemetry.read_window"],
  ["diagnosis", "ml.predict_component_failure"],
  ["engage", "voice.speak"],
  ["schedule", "scheduler.confirm"],
  ["feedback", "maintenance.append_record"],
  ["quality", "defect.cluster"],
  ["master", "runs.close"],
];
const BEAT_MS = 900;

function AgentCard({ agent, live, pinned, onPin, call }) {
  return (
    <button
      type="button"
      className="s-agent"
      data-tone={agent.tone}
      data-live={live ? "true" : undefined}
      aria-pressed={pinned}
      onClick={onPin}
    >
      <span className="s-agent-top">
        <i className="s-dot" />
        <b>{agent.name}</b>
        {live && <span className="s-agent-call">{call}</span>}
      </span>
      <span className="s-agent-role">{agent.role}</span>
      <span className="s-agent-k">Can call</span>
      <span className="s-chips">{agent.can.map((t) => <code key={t}>{t}</code>)}</span>
      <span className="s-agent-k">Denied</span>
      <span className="s-chips s-chips-no">{agent.cannot.map((t) => <code key={t}>{t}</code>)}</span>
      {agent.note && <span className="s-agent-note">{agent.note}</span>}
    </button>
  );
}

export default function Agents() {
  const [beat, setBeat] = useState(-1);
  const [pinned, setPinned] = useState(null);
  const timer = useRef(0);
  const reduce = reducedMotion();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const play = () => {
    window.clearTimeout(timer.current);
    if (reduce) { setBeat(RUN.length - 1); return; }
    let i = 0;
    const tick = () => {
      setBeat(i);
      i += 1;
      if (i <= RUN.length) timer.current = window.setTimeout(tick, BEAT_MS);
    };
    tick();
  };

  const running = beat >= 0 && beat < RUN.length;
  const [liveId, liveCall] = running ? RUN[beat] : [null, null];
  const master = AGENTS[0];
  const workers = AGENTS.slice(1);

  return (
    <section id="agents" className="s-section s-agents" aria-labelledby="agents-title">
      <div className="s-wrap">
        <div className="s-head">
          <p className="s-eyebrow">Coordinate</p>
          <h2 id="agents-title" className="s-h2">Seven agents. One orchestra.</h2>
          <p className="s-lead">
            A Master agent plans; six workers analyse, diagnose, talk, schedule, follow up and report to the plant.
            Each one holds only the tools its job needs — the rest are refused before they run.
          </p>
          <div className="s-head-actions">
            <button type="button" className="s-btn s-btn-ink" onClick={play} disabled={running}>
              {running ? "Running…" : beat >= RUN.length ? "Run it again" : "Run the orchestra"}
            </button>
            <p className="s-agents-status" aria-live="polite">
              {running
                ? `${AGENTS.find((a) => a.id === liveId).name} → ${liveCall}`
                : beat >= RUN.length ? "Run closed · 8 calls · 0 refused" : "Press run to watch the baton move"}
            </p>
          </div>
        </div>

        <div className="s-orchestra">
          <div className="s-orchestra-master">
            <AgentCard agent={master} live={liveId === "master"} call={liveCall} pinned={pinned === "master"} onPin={() => setPinned(pinned === "master" ? null : "master")} />
          </div>
          <div className="s-orchestra-bus" aria-hidden="true"><i style={{ width: running ? `${Math.min(100, (beat / (RUN.length - 2)) * 100)}%` : beat >= RUN.length ? "100%" : "0%" }} /></div>
          <div className="s-orchestra-workers">
            {workers.map((a) => (
              <AgentCard key={a.id} agent={a} live={liveId === a.id} call={liveCall} pinned={pinned === a.id} onPin={() => setPinned(pinned === a.id ? null : a.id)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
