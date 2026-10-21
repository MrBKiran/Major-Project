/**
 * Slide 5 — Security Console (UEBA).
 *
 * Three things a security analyst needs in one screen: what every agent is
 * allowed to do (the policy matrix), proof the audit trail hasn't been
 * tampered with (the hash chain), and a way to prove the guard actually
 * catches something — the red-team runner fires real scripted attacks
 * through the live registry and guard, not a canned animation.
 */

import { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { pluralize } from "@autosaarthi/core";
import { Badge, Card, Empty, Skeleton, SkeletonStatRow, Stat } from "../ui.jsx";

const DECISION_TONE = { BLOCK: "danger", FLAG: "warn", ALLOW: "good", INVALID: "slate" };

export default function SecurityConsole() {
  const { can } = useAuth();
  const [matrix, setMatrix] = useState(null);
  const [events, setEvents] = useState(null);
  const [chain, setChain] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState([]);
  const [connected, setConnected] = useState(false);

  const load = () => {
    Promise.all([api.get("/api/ueba/matrix"), api.get("/api/ueba/events", { limit: 60 })])
      .then(([m, e]) => { setMatrix(m); setEvents(e); })
      .catch((e) => setError(e.message || String(e)));
  };

  useEffect(load, []);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/events`);
    // The server accepts the socket but sends nothing until it has the
    // credential, and a browser cannot set an Authorization header on a
    // WebSocket — so the token is the first message. (Not a query parameter:
    // URLs end up in access logs.) "Live" only lights once the server says the
    // token was accepted; a refusal closes the socket with 4401/4403.
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: getToken() }));
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const payload = JSON.parse(ev.data);
      if (payload.type === "auth_ok") {
        setConnected(true);
        return;
      }
      setLive((prev) => [payload, ...prev].slice(0, 40));
    };
    return () => ws.close();
  }, []);

  async function verifyChain() {
    setChain("checking");
    const res = await api.get("/api/ueba/verify-chain");
    setChain(res);
  }

  async function release(agentId) {
    await api.post(`/api/ueba/release/${agentId}`, {});
    load();
  }

  if (error) return <Empty icon="search">Could not load security console — {error}</Empty>;
  if (!matrix || !events) {
    return (
      <div className="space-y-5">
        <SkeletonStatRow count={5} />
        <Card title="Agent × Tool policy matrix">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        </Card>
      </div>
    );
  }

  const { stats } = events;
  const agents = Object.entries(matrix.matrix);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat value={stats.total} label="audited calls" />
        <Stat value={stats.blocked} label="blocked" tone="danger" />
        <Stat value={stats.flagged} label="flagged" tone="warn" />
        <Stat value={agents.filter(([, a]) => a.quarantined).length} label="quarantined agents" tone="danger" />
        <div className="rounded-lg border border-border bg-surface-inset/60 px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-fg-subtle"}`} />
            <span className="text-caption font-medium uppercase tracking-wider text-fg-tertiary">
              {connected ? "live" : "disconnected"}
            </span>
          </div>
          <button
            onClick={verifyChain}
            className="num mt-1 text-body-sm font-semibold text-accent-ink hover:underline"
          >
            Verify audit chain →
          </button>
          {chain && chain !== "checking" && (
            <div className={`mt-1 text-caption ${chain.valid ? "text-ok" : "text-p1"}`}>
              {chain.valid ? `intact — ${chain.rows} rows` : `BROKEN at row ${chain.broken_at}`}
            </div>
          )}
        </div>
      </div>

      <Card title="Agent × Tool policy matrix" subtitle="What each worker agent may call, enforced on every invocation">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map(([id, a]) => (
            <div
              key={id}
              className={`rounded-lg border p-3.5 transition-colors duration-300 ${
                a.quarantined ? "border-p1/50 bg-p1/5" : "border-border bg-surface-inset/40 hover:border-fg-subtle"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                  <span className="text-body-sm font-semibold text-fg">{a.display_name}</span>
                </div>
                <Badge tone={a.clearance === "restricted" ? "danger" : a.clearance === "pii" ? "warn" : "slate"}>
                  {a.clearance}
                </Badge>
              </div>
              {a.quarantined && (
                <div className="mt-2 flex items-center justify-between rounded-md border border-p1/40 bg-p1/10 px-2.5 py-1.5">
                  <Badge tone="danger" pulse>QUARANTINED</Badge>
                  {can("ueba:release") && (
                    <button onClick={() => release(id)} className="text-caption font-medium text-accent-ink transition hover:underline">
                      Release
                    </button>
                  )}
                </div>
              )}
              <PolicyCounts agent={a} />
            </div>
          ))}
        </div>
      </Card>

      {can("redteam:run") && <RedTeam onDone={load} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Audit trail" subtitle={`Last ${events.events.length} tool calls, hash-chained`}>
          <EventTable rows={events.events.slice().reverse()} />
        </Card>
        <Card title="Live trace" subtitle="Raw event bus — every tool call as it happens">
          {live.length === 0 ? (
            <Empty>Waiting for activity — trigger a run or a red-team attack.</Empty>
          ) : (
            <ul className="max-h-[420px] space-y-1.5 overflow-y-auto text-label">
              {live.map((ev, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-inset/30 px-2.5 py-1.5">
                  <span className="w-16 shrink-0 font-mono text-caption text-fg-subtle">{ev.type}</span>
                  {ev.decision && <Badge tone={DECISION_TONE[ev.decision] ?? "slate"}>{ev.decision}</Badge>}
                  <span className="truncate text-fg-tertiary">
                    {ev.agent_id ? `${ev.agent_id} → ` : ""}{ev.tool ?? ev.title ?? ev.msg ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function PolicyCounts({ agent }) {
  const limits = Object.keys(agent.rate_limits).length;
  return (
    <div className="mt-2.5 text-caption text-fg-muted">
      <span className="text-ok">{agent.allow.length} allowed</span>
      {agent.deny.length > 0 && <span className="ml-2 text-p1">{agent.deny.length} explicit deny</span>}
      {limits > 0 && <span className="ml-2 text-fg-muted">{pluralize(limits, "rate limit")}</span>}
    </div>
  );
}

function EventTable({ rows }) {
  if (rows.length === 0) return <Empty>No audited calls yet.</Empty>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-label">
        <thead className="sticky top-0 bg-surface-card">
          <tr className="border-b border-border text-left text-caption uppercase tracking-wider text-fg-muted">
            <th className="pb-2 font-medium">Agent</th>
            <th className="pb-2 font-medium">Tool</th>
            <th className="pb-2 font-medium">Decision</th>
            <th className="pb-2 text-right font-medium">Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq} className="border-b border-border/50 last:border-0">
              <td className="py-2 text-fg-secondary">{r.agent_id}</td>
              <td className="py-2 font-mono text-caption text-fg-tertiary">{r.tool}</td>
              <td className="py-2"><Badge tone={DECISION_TONE[r.decision] ?? "slate"}>{r.decision}</Badge></td>
              <td className="num py-2 text-right text-fg-muted">{r.risk_score.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RedTeam({ onDone }) {
  const [scenarios, setScenarios] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api.get("/api/redteam/scenarios").then((d) => setScenarios(d.scenarios));
  }, []);

  async function run(id) {
    setRunning(id);
    try {
      const res = await api.post("/api/redteam/run", { attack_id: id });
      setResults((r) => ({ ...r, [id]: res }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { error: e.message || String(e) } }));
    } finally {
      setRunning(null);
      onDone();
    }
  }

  async function reset() {
    setResetting(true);
    await api.post("/api/redteam/reset", {});
    setResults({});
    setResetting(false);
    onDone();
  }

  return (
    <Card
      title="Red team"
      subtitle="Fires real scripted attacks through the live tool registry and guard — nothing here is simulated"
      right={
        <button
          onClick={reset}
          disabled={resetting}
          className="rounded-lg border border-border px-3 py-1.5 text-label font-medium text-fg-secondary transition duration-150 hover:border-fg-muted active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
        >
          Reset quarantine / limiters
        </button>
      }
    >
      {!scenarios ? (
        <Empty>Loading scenarios…</Empty>
      ) : (
        <div className="space-y-2.5">
          {scenarios.map((s) => {
            const res = results[s.id];
            return (
              <div key={s.id} className="rounded-lg border border-border bg-surface-inset/40 p-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-body-sm font-semibold text-fg">
                      {s.id} — {s.title}
                    </div>
                    <p className="mt-1 text-label leading-relaxed text-fg-muted">{s.narrative}</p>
                  </div>
                  <button
                    onClick={() => run(s.id)}
                    disabled={running === s.id}
                    className="shrink-0 rounded-lg border border-border-strong bg-surface-card px-3 py-1.5 text-label font-semibold text-fg transition duration-150 hover:bg-surface-inset active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
                  >
                    {running === s.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" /> Firing…
                      </span>
                    ) : "Run attack"}
                  </button>
                </div>
                {res && (
                  <div className="animate-in mt-3 rounded-md border border-border/70 bg-surface-card px-3 py-2.5 text-label">
                    {res.error ? (
                      <span className="text-p1">{res.error}</span>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={res.passed ? "good" : "danger"}>
                            {res.passed ? "CAUGHT as expected" : "did not match expected outcome"}
                          </Badge>
                          <Badge tone={DECISION_TONE[res.final_decision] ?? "slate"}>{res.final_decision}</Badge>
                          {res.quarantined && <Badge tone="danger" pulse>agent quarantined</Badge>}
                          <span className="text-fg-subtle">caught by {res.caught_by_layers?.length === 1 ? "layer" : "layers"} {res.caught_by_layers?.join(", ")}</span>
                        </div>
                        {res.recovery && <p className="mt-1.5 text-fg-muted">{res.recovery}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
