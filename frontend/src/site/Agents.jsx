import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { AGENTS, HELPERS } from "./content.js";
import { DetailToggle, useDetail } from "./detail.jsx";

/**
 * Seven AI helpers, one team — and what each one is *not* allowed to do, which
 * is the point: a mistake or a break-in in one helper cannot spread to the rest.
 * In plain mode the lists are everyday actions; with technical details on they
 * are the policy file's own tool names (config/agent_policy.yaml).
 *
 * "Watch a job go through the team" hands the work down the line the way a
 * real job goes, one helper lighting up at a time.
 */

const RUN = [
  ["lead", "plans the job and hands it out", "runs.write_plan"],
  ["monitor", "reads the car's sensors and spots the problem", "telemetry.read_window"],
  ["mechanic", "works out which part and how long it has", "ml.predict_component_failure"],
  ["caller", "phones the owner and gets a yes", "voice.speak"],
  ["booking", "books a free slot nearby", "scheduler.confirm"],
  ["followup", "records the repair afterwards", "maintenance.append_record"],
  ["factory", "checks whether other cars share the fault", "defect.cluster"],
  ["lead", "closes the job", "runs.close"],
];
const BEAT_MS = 1100;

function AgentCard({ agent, live, tech }) {
  const helper = HELPERS[agent.id];
  return (
    <article className="s-agent" data-tone={helper.tone} data-live={live ? "true" : undefined}>
      <div className="s-agent-top">
        <i className="s-dot" />
        <h3>{helper.name}</h3>
        {tech && <code className="s-agent-id">{helper.tech}</code>}
      </div>
      <p className="s-agent-role">{agent.role}</p>
      {tech ? (
        <>
          <p className="s-agent-k">Allowed tools</p>
          <p className="s-chips">{agent.tech.can.map((t) => <code key={t}>{t}</code>)}</p>
          <p className="s-agent-k">Denied tools</p>
          <p className="s-chips s-chips-no">{agent.tech.cannot.map((t) => <code key={t}>{t}</code>)}</p>
        </>
      ) : (
        <div className="s-agent-lists">
          <ul aria-label={`${helper.name} can`}>
            {agent.can.map((c) => <li key={c} data-yes="true">{c}</li>)}
          </ul>
          <ul aria-label={`${helper.name} cannot`}>
            {agent.cannot.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {agent.note && <p className="s-agent-note">{agent.note}</p>}
    </article>
  );
}

export default function Agents() {
  const { on: tech } = useDetail();
  const [beat, setBeat] = useState(-1);
  const timer = useRef(0);
  const reduce = reducedMotion();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const play = () => {
    window.clearTimeout(timer.current);
    if (reduce) { setBeat(RUN.length); return; }
    let i = 0;
    const tick = () => {
      setBeat(i);
      i += 1;
      if (i <= RUN.length) timer.current = window.setTimeout(tick, BEAT_MS);
    };
    tick();
  };

  const running = beat >= 0 && beat < RUN.length;
  const [liveId, liveWhat, liveTool] = running ? RUN[beat] : [null, null, null];
  const status = running
    ? tech ? `${HELPERS[liveId].tech} → ${liveTool}` : `${HELPERS[liveId].name} ${liveWhat}.`
    : beat >= RUN.length ? "Job finished. Every helper stayed inside its own job." : "Press the button to follow one job from start to finish.";
  const [lead, ...team] = AGENTS;

  return (
    <section id="helpers" className="s-section s-agents" aria-labelledby="agents-title">
      <div className="s-wrap">
        <div className="s-head">
          <p className="s-eyebrow">The team behind it</p>
          <h2 id="agents-title" className="s-h2">Seven AI helpers. One team.</h2>
          <p className="s-lead">
            Instead of one all-powerful AI, AutoSaarthi uses seven small helpers. Each one does a single job and is
            only allowed to do that job — so a mistake, or a break-in, in one of them cannot spread to the rest.
          </p>
          <div className="s-head-actions">
            <button type="button" className="s-btn s-btn-ink" onClick={play} disabled={running}>
              {running ? "Following the job…" : beat >= RUN.length ? "Watch it again" : "Watch a job go through the team"}
            </button>
            <DetailToggle />
          </div>
          <p className="s-agents-status" aria-live="polite">{status}</p>
        </div>

        <div className="s-orchestra">
          <div className="s-orchestra-master">
            <AgentCard agent={lead} live={liveId === "lead"} tech={tech} />
          </div>
          <div className="s-orchestra-bus" aria-hidden="true">
            <i style={{ width: running ? `${Math.min(100, (beat / (RUN.length - 2)) * 100)}%` : beat >= RUN.length ? "100%" : "0%" }} />
          </div>
          <div className="s-orchestra-workers">
            {team.map((a) => <AgentCard key={a.id} agent={a} live={liveId === a.id} tech={tech} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
