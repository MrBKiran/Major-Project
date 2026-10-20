/**
 * Slide 1 — Fleet Monitoring.
 *
 * A scoped list (an OEM sees its brand, a dealer its centre's cars, an owner
 * their own vehicle — /api/fleet applies the row predicate server-side, this
 * page never filters client-side) with a drill-down into one vehicle's live
 * telemetry, standing predictions, and service history.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { formatDate } from "@autosaarthi/core";
import { Badge, Card, CHART, Empty, SeverityPill, Skeleton, SkeletonStatRow, Stat } from "../ui.jsx";

export default function FleetMonitoring() {
  const { can } = useAuth();
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/api/fleet", { limit: 100 })
      .then((d) => {
        setFleet(d);
        if (d.vehicles.length) setSelected(d.vehicles[0].vin);
      })
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) return <Empty icon="search">Could not load fleet — {error}</Empty>;
  if (!fleet) {
    return (
      <div className="space-y-5">
        <SkeletonStatRow />
        <Card title="Fleet">
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const { vehicles, page_counts, page, scope } = fleet;

  if (!vehicles.length) {
    return (
      <Empty>
        No vehicles in scope for {scope.org} ({scope.kind}). Nothing to show —
        this is not an error, just an empty fleet.
      </Empty>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={page.total ?? vehicles.length} label="vehicles in scope" sub={scope.org} />
        <Stat value={page_counts.p1} label="P1 — urgent" tone="danger" />
        <Stat
          value={page_counts.at_risk - page_counts.p1}
          label="P2 / P3 — watch"
          tone="warn"
        />
        <Stat value={page_counts.healthy} label="healthy" tone="good" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr]">
        <Card
          title="Fleet"
          subtitle={`Sorted by severity · ${scope.kind} scope`}
          className="overflow-hidden"
        >
          <div className="-mx-5 -mb-5 max-h-[560px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-ink-800">
                <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 pb-2 font-medium">Vehicle</th>
                  <th className="pb-2 font-medium">Issue</th>
                  <th className="pb-2 pr-5 text-right font-medium">Severity</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr
                    key={v.vin}
                    onClick={() => setSelected(v.vin)}
                    className={`cursor-pointer border-b border-edge/50 transition last:border-0 hover:bg-ink-700/40 ${
                      selected === v.vin ? "bg-ink-700 shadow-[inset_3px_0_0_0_var(--color-accent)]" : ""
                    }`}
                  >
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-slate-200">{v.model}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {v.vin} · {v.city}
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-400">
                      {v.component ? (
                        <>
                          {v.component.replace(/_/g, " ")}
                          {v.days_to_failure != null && (
                            <span className="ml-1.5 text-[11px] text-slate-600">
                              ~{v.days_to_failure}d
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-5 text-right">
                      <SeverityPill severity={v.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {selected && <VehicleDetail vin={selected} canTrigger={can("agent:trigger")} />}
      </div>

      {can("prediction:read") && <ModelPerformance />}
    </div>
  );
}

/** The M1/M2/M4 comparison tables the training scripts actually wrote — read
 * straight from ml/artifacts/*.json, so this always matches the models the
 * fleet page's own predictions came from, not a description of them. M4 is
 * deliberately NOT rendered as a metrics table: its own artifact is labelled
 * "NOT demo-ready" (recall is at noise level — see the note), and showing
 * that as if it were a working result would misrepresent it. */
function ModelPerformance() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    api.get("/api/models/metrics").then(setMetrics).catch(() => setMetrics({}));
  }, []);

  if (!metrics) {
    return (
      <Card title="Model performance">
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  const m1 = metrics.m1_metrics;
  const m2 = metrics.m2_metrics;
  const m4 = metrics.m4_metrics;
  if (!m1 && !m2 && !m4) return null;

  return (
    <Card title="Model performance" subtitle="Read from the training run's own artifacts — not a claim, a receipt">
      <div className="grid gap-5 lg:grid-cols-2">
        {m1 && (
          <div>
            <h3 className="text-[12px] font-semibold text-slate-300">
              M1 — health classifier <span className="font-normal text-slate-500">({m1.n_train} train / {m1.n_test} test)</span>
            </h3>
            <table className="mt-2.5 w-full text-[12px]">
              <thead>
                <tr className="border-b border-edge text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                  <th className="pb-1.5 font-medium">Model</th>
                  <th className="pb-1.5 text-right font-medium">Accuracy</th>
                  <th className="pb-1.5 text-right font-medium">F1 (macro)</th>
                </tr>
              </thead>
              <tbody>
                {m1.comparison_table.map((r) => (
                  <tr key={r.model} className="border-b border-edge/50 last:border-0">
                    <td className="py-1.5 text-slate-300">
                      {r.model}
                      {r.model === m1.model && <Badge tone="accent">production</Badge>}
                    </td>
                    <td className="num py-1.5 text-right text-slate-400">{(r.accuracy * 100).toFixed(1)}%</td>
                    <td className="num py-1.5 text-right text-slate-400">{r.f1_macro.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m1.shap_top_features?.length > 0 && (
              <p className="mt-2.5 text-[11px] text-slate-500">
                Weighs most on: {m1.shap_top_features.slice(0, 4).map((f) => f.feature.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </div>
        )}

        {m2 && (
          <div>
            <h3 className="text-[12px] font-semibold text-slate-300">M2 — component &amp; time-to-failure</h3>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Stat value={`${(m2.component_classifier.accuracy * 100).toFixed(1)}%`} label="component accuracy" />
              <Stat value={`±${m2.progress_regressor.mae_days_equivalent.toFixed(1)}d`} label="days-to-failure MAE" />
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
              Severity rule: <code className="rounded bg-ink-700/60 px-1 py-0.5 text-slate-400">{m2.severity_rule}</code>
            </p>
          </div>
        )}
      </div>

      {m4 && (
        <div className="mt-4 rounded-lg border border-edge bg-ink-700/30 px-3.5 py-3 text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-400">M4 — anomaly detector: </span>
          not shown as a result. Its own evaluation is honest about why:{" "}
          <span className="text-slate-500">{m4.limitation}</span>
        </div>
      )}
    </Card>
  );
}

function VehicleDetail({ vin, canTrigger }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    setRunResult(null);
    api.get(`/api/vehicle/${vin}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [vin]);

  async function triggerRun() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post("/api/runs/trigger", { vin, trigger: "manual", wait: true });
      setRunResult(res);
    } catch (e) {
      setRunResult({ error: e.message || String(e) });
    } finally {
      setRunning(false);
    }
  }

  if (error) return <Card title="Vehicle"><Empty>{error}</Empty></Card>;
  if (!data) return <Card title="Vehicle"><Empty>Loading {vin}…</Empty></Card>;

  const { vehicle, series, predictions, maintenance_history, dtc_codes } = data;

  return (
    <div className="space-y-5">
      <Card
        title={vehicle.model}
        subtitle={`${vin} · ${vehicle.plant} · batch ${vehicle.batch_id}`}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen(true)}
              className="rounded-lg border border-edge px-3 py-1.5 text-[12px] font-semibold text-slate-300 transition duration-150 hover:border-accent/50 hover:text-accent active:scale-[0.97]"
            >
              Chat with assistant
            </button>
            {canTrigger && (
              <button
                onClick={triggerRun}
                disabled={running}
                className="rounded-lg bg-accent-deep px-3 py-1.5 text-[12px] font-semibold text-white transition duration-150 hover:bg-accent active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              >
                {running ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-white pulse-soft" /> Running agents…
                  </span>
                ) : "Run agent analysis"}
              </button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat value={vehicle.odometer?.toLocaleString("en-IN") ?? "—"} label="odometer (km)" />
          <Stat value={vehicle.city} label="city" />
          <Stat value={dtc_codes.length} label="active DTCs" tone={dtc_codes.length ? "warn" : "good"} />
        </div>

        {runResult && (
          <div className="mt-4 rounded-lg border border-edge bg-ink-700/40 px-4 py-3 text-[12px]">
            {runResult.error ? (
              <span className="text-p1">{runResult.error}</span>
            ) : (
              <>
                <span className="font-semibold text-slate-200">
                  Master-graph run {runResult.status}
                </span>
                <span className="ml-2 text-slate-500">job {runResult.job_id}</span>
                {runResult.result && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">
                    {JSON.stringify(runResult.result, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      <Card title="Telemetry" subtitle="Coolant temp (°C) and battery voltage (V), last 4h">
        {series.length === 0 ? (
          <Empty>No telemetry published in this window.</Empty>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false}
                  minTickGap={40}
                />
                <YAxis yAxisId="temp" stroke={CHART.series.temp} fontSize={11} tickLine={false} axisLine={false} width={32} />
                <YAxis yAxisId="volt" orientation="right" stroke={CHART.series.volt} fontSize={11} tickLine={false} axisLine={false} width={32} />
                <Tooltip
                  contentStyle={CHART.tooltip}
                  labelFormatter={(t) => new Date(t).toLocaleString()}
                />
                <Line yAxisId="temp" type="monotone" dataKey="coolant_temp" stroke={CHART.series.temp} dot={false} strokeWidth={1.5} name="Coolant °C" />
                <Line yAxisId="volt" type="monotone" dataKey="battery_voltage" stroke={CHART.series.volt} dot={false} strokeWidth={1.5} name="Battery V" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Predictions" subtitle="Latest run per component">
          {predictions.length === 0 ? (
            <Empty>No active predictions — healthy.</Empty>
          ) : (
            <ul className="space-y-2">
              {predictions.map((p) => (
                <li key={p.component} className="flex items-center justify-between rounded-lg border border-edge bg-ink-700/40 px-3 py-2 text-[12px]">
                  <div>
                    <div className="font-medium text-slate-200">{p.component.replace(/_/g, " ")}</div>
                    <div className="text-slate-500">
                      {(p.failure_prob * 100).toFixed(0)}% prob
                      {p.days_to_failure != null && ` · ~${p.days_to_failure}d`}
                    </div>
                  </div>
                  <SeverityPill severity={p.severity} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Service history" subtitle="Most recent 10 records">
          {maintenance_history.length === 0 ? (
            <Empty>No service history yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {maintenance_history.map((h, i) => (
                <li key={i} className="rounded-lg border border-edge bg-ink-700/40 px-3 py-2 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-200">{h.service_type}</span>
                    <span className="text-slate-500">{formatDate(h.date)}</span>
                  </div>
                  {h.components_replaced?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {h.components_replaced.map((c) => (
                        <Badge key={c} tone="slate">{c.replace(/_/g, " ")}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {chatOpen && <ChatModal vin={vin} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

/** Owner-facing labels for the agent that produced a turn. Asking a question
 *  routes through TWO agents — the Diagnosis Agent is the only one allowed to
 *  read telemetry (config/agent_policy.yaml), so it gathers and the engagement
 *  agent speaks — and the badge is how that delegation is visible on screen
 *  rather than only in the audit log. */
const AGENT_LABELS = {
  customer_engagement_agent: "Engagement",
  scheduling_agent: "Scheduling",
  diagnosis_agent: "Diagnosis",
  master_agent: "Master",
};

/** A real conversation, not a script: every turn here comes from
 * /api/chat/start|reply, which runs the actual Customer Engagement Agent's
 * strategy sequence, the LLM intent router and the objection classifier
 * against whatever you type — the same config/strategies.yaml logic a live
 * voice call would use, just typed instead of spoken. Questions are answered
 * from real telemetry, fault codes and service history; accepting for real
 * books a real appointment. */
function ChatModal({ vin, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [session, setSession] = useState(null); // {run_id, plan, offered_slots, objections_handled}
  const [done, setDone] = useState(false);
  const [booking, setBooking] = useState(null);
  const [resumed, setResumed] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback((restart) => {
    setBusy(true);
    setError(null);
    setNote(null);
    if (restart) {
      setMessages([]);
      setDone(false);
      setBooking(null);
    }
    api.post("/api/chat/start", { vin, restart })
      .then((res) => {
        if (res.note) {
          setNote(res.note);
          setDone(true);
          return;
        }
        setMessages(res.turns);
        setResumed(Boolean(res.resumed));
        setBooking(res.booking ?? null);
        setDone(Boolean(res.done));
        setSession({ run_id: res.run_id, plan: res.plan, offered_slots: res.offered_slots, objections_handled: res.objections_handled });
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setBusy(false));
  }, [vin]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy || done || !session) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await api.post("/api/chat/reply", {
        vin, run_id: session.run_id, plan: session.plan, message: text,
        offered_slots: session.offered_slots, objections_handled: session.objections_handled,
      });
      // Stamp the routed intent back onto the message that caused it, so the
      // classification is shown against the words that produced it rather than
      // floating above an unrelated reply.
      setMessages((m) => {
        const next = [...m];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "user") {
            next[i] = { ...next[i], intent: res.intent, intentSource: res.intent_source };
            break;
          }
        }
        return [...next, ...res.turns];
      });
      setSession({ run_id: res.run_id, plan: res.plan, offered_slots: res.offered_slots, objections_handled: res.objections_handled });
      if (res.done) { setDone(true); setBooking(res.booking); }
    } catch (e) {
      setMessages((m) => [...m, { role: "system", text: e.message || String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[600px] w-full max-w-md flex-col overflow-hidden rounded-xl border border-edge bg-ink-800 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-slate-100">AutoSaarthi Assistant</h2>
              <p className="text-[11px] text-slate-500">customer_engagement_agent · {vin}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => load(true)}
                disabled={busy}
                className="rounded-md px-2 py-1 text-[11px] text-slate-500 transition hover:bg-ink-700 hover:text-slate-300 disabled:opacity-40"
                title="Close this conversation and begin a new one"
              >
                Start over
              </button>
            )}
            <button onClick={onClose} className="rounded-md p-1 text-slate-500 transition hover:bg-ink-700 hover:text-slate-300" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {error && <Empty icon="search">{error}</Empty>}
          {note && <Empty icon="inbox">{note}</Empty>}
          {resumed && messages.length > 0 && (
            <p className="pb-1 text-center text-[10.5px] text-slate-600">
              Continuing your earlier conversation
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-sm bg-accent text-white"
                    : m.role === "system"
                    ? "rounded-bl-sm border border-p1/30 bg-p1/10 text-p1"
                    : "rounded-bl-sm border border-edge bg-ink-700/60 text-slate-200"
                }`}
              >
                {(m.strategy || m.source || m.agent) && (
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider">
                    {m.agent && AGENT_LABELS[m.agent] && (
                      <span className="rounded bg-ink-600/70 px-1 py-px text-slate-400" title={m.agent}>
                        {AGENT_LABELS[m.agent]}
                      </span>
                    )}
                    {m.strategy && <span className="text-accent/70">{m.strategy}</span>}
                    {m.source && m.source !== "policy" && (
                      <span
                        className={`rounded px-1 py-px normal-case tracking-normal ${
                          m.source === "demo_fixture" || m.source === "static_fallback"
                            ? "bg-ink-600/60 text-slate-500"
                            : "bg-ok/15 text-ok"
                        }`}
                        title={
                          m.source === "demo_fixture" || m.source === "static_fallback"
                            ? "Templated fixture text, not a live model call"
                            : `Live model call (${m.source})`
                        }
                      >
                        {m.source === "demo_fixture" || m.source === "static_fallback" ? "template" : `live · ${m.source}`}
                      </span>
                    )}
                    {m.grounded_in > 0 && (
                      <span
                        className="rounded bg-p3/15 px-1 py-px normal-case tracking-normal text-p3"
                        title="Answered only from facts read out of this vehicle's own telemetry, fault codes and service history"
                      >
                        {m.grounded_in} facts
                      </span>
                    )}
                  </div>
                )}
                {m.role === "user" && m.intent && (
                  <div className="mb-1 text-right font-mono text-[9.5px] uppercase tracking-wider text-white/60"
                       title={`Routed by ${m.intentSource === "llm" ? "the live intent classifier" : "the deterministic fallback"}`}>
                    {m.intent}{m.intentSource === "llm" ? "" : " · fallback"}
                  </div>
                )}
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-edge bg-ink-700/60 px-3.5 py-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 pulse-soft" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 pulse-soft" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 pulse-soft" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {done && booking && (
            <div className={`rounded-lg border px-3.5 py-2.5 text-center text-[12px] font-medium ${
              booking.booked ? "border-ok/40 bg-ok/10 text-ok" : "border-p2/40 bg-p2/10 text-p2"
            }`}>
              {booking.booked ? `✓ Appointment ${booking.appointment_id} confirmed` : booking.reason || "Couldn't complete the booking"}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 border-t border-edge p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={busy || done || !session}
            placeholder={done ? "Conversation ended" : "Ask a question, or reply…"}
            className="flex-1 rounded-lg border border-edge bg-ink-900 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-accent/60 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={busy || done || !input.trim() || !session}
            className="rounded-lg bg-accent-deep px-3.5 py-2 text-white transition duration-150 hover:bg-accent active:scale-95 disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
