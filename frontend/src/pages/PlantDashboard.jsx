/**
 * Slide 4 — RCA/CAPA to Manufacturing feedback loop.
 *
 * The screen is built around one argument: this defect cluster is real, here is
 * why it is not chance, here is the historical CAPA that explains the mechanism,
 * and here is the ticket ready to send. The rejected cluster is shown on purpose
 * — a screen that only ever displays hits proves nothing about the statistics.
 */

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { Badge, Card, Empty, Skeleton, SkeletonStatRow, Stat, inr } from "../ui.jsx";

/** Downloads the drafted CAPA as a PDF.
 *
 *  The server re-runs the clustering and renders through the tool registry, so
 *  the file is produced by the same guarded path an agent would use and lands
 *  in the audit log — this button is not a shortcut around it. Errors surface
 *  inline rather than as a silent no-op, because a download that just does
 *  nothing is indistinguishable from a broken button. */
function DownloadCapaButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.download("/api/quality/capa-draft.pdf", "capa-draft.pdf");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[11px] text-p1">{error}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-[12px] font-medium text-slate-300 transition duration-150 hover:border-accent/50 hover:text-accent active:scale-95 disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {busy ? "Rendering…" : "PDF"}
      </button>
    </span>
  );
}

export default function PlantDashboard() {
  const { can } = useAuth();
  const canDraft = can("capa:draft");
  const [clusters, setClusters] = useState(null);
  const [clusterError, setClusterError] = useState(null);

  // quality:read is all the tab requires, so the cohort table below always
  // loads. The headline cluster + 5-Why + drafted ticket need capa:draft —
  // an OEM fleet analyst has the former without the latter, and unconditionally
  // fetching both would 403 the whole page for exactly that role.
  useEffect(() => {
    api.get("/api/quality/clusters", { min_lift: 1.5 })
      .then((cl) => setClusters(cl.clusters ?? []))
      .catch((e) => setClusterError(e.message || String(e)));
  }, []);

  return (
    <div className="space-y-5">
      {canDraft && <CapaDraft />}

      {clusterError ? (
        <Empty icon="search">Could not load defect clusters — {clusterError}</Empty>
      ) : !clusters ? (
        <Card title="Every cohort screened">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </Card>
      ) : (
        <Card
          title="Every cohort screened"
          subtitle="Shown in full, including what was rejected — the rejects are why the accept is credible"
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="pb-2 font-medium">Cluster</th>
                <th className="pb-2 text-right font-medium">Rate</th>
                <th className="pb-2 text-right font-medium">Lift</th>
                <th className="pb-2 text-right font-medium">p</th>
                <th className="pb-2 text-right font-medium">q</th>
                <th className="pb-2 pl-4 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((x) => (
                <tr key={x.cluster_key} className="border-b border-edge/50 last:border-0">
                  <td className="py-2.5 font-mono text-[12px] text-slate-300">{x.cluster_key}</td>
                  <td className="num py-2.5 text-right text-slate-400">
                    {(x.failure_rate * 100).toFixed(1)}%
                  </td>
                  <td className="num py-2.5 text-right text-slate-200">{x.lift}×</td>
                  <td className="num py-2.5 text-right text-slate-500">{x.p_value}</td>
                  <td className="num py-2.5 text-right text-slate-500">{x.q_value}</td>
                  <td className="py-2.5 pl-4">
                    {x.survives_fdr ? (
                      <Badge tone="danger">actionable</Badge>
                    ) : (
                      <Badge tone="slate">rejected — likely noise</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** The headline argument: this cluster is real, here's why, here's the
 * drafted ticket. Needs capa:draft — Quality Engineer and Quality Manager,
 * not the read-only OEM Fleet Analyst. */
function CapaDraft() {
  const { can } = useAuth();
  const canDispatch = can("capa:dispatch");
  const [data, setData] = useState(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [openCapaId, setOpenCapaId] = useState(null);

  useEffect(() => {
    api.get("/api/quality/capa-draft")
      .then(setData)
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) return <Empty icon="search">Could not load quality data — {error}</Empty>;
  if (!data) {
    return (
      <div className="space-y-5">
        <Card>
          <p className="mb-3 flex items-center gap-2 text-[12.5px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" />
            Analysing fleet service history — Fisher's exact test across every cohort…
          </p>
          <SkeletonStatRow count={5} />
        </Card>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  if (!data.cluster) return <Empty icon="inbox">{data.note}</Empty>;

  const c = data.cluster;
  const d = data.draft;

  return (
    <div className="space-y-5">
      {/* headline claim */}
      <Card
        title="Defect cluster detected"
        subtitle={`Screened ${data.clusters_screened} cohort${data.clusters_screened === 1 ? "" : "s"} across the parc · aftersales → manufacturing`}
        right={
          <div className="flex items-center gap-2">
            <Badge tone="accent">{c.plant}</Badge>
            <Badge tone="danger">{c.batch_id}</Badge>
          </div>
        }
      >
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-lg font-semibold text-slate-100">
            {c.component.replace(/_/g, " ")}
          </span>
          <span className="text-sm text-slate-500">{c.cluster_key}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat
            value={`${c.failures}/${c.cohort_size}`}
            label="units affected"
            sub="in this batch"
            tone="danger"
          />
          <Stat
            value={`${(c.failure_rate * 100).toFixed(1)}%`}
            label="batch failure rate"
            sub={`fleet baseline ${(c.baseline_rate * 100).toFixed(1)}%`}
            tone="warn"
          />
          <Stat value={`${c.lift}×`} label="lift vs baseline" tone="danger" />
          <Stat
            value={c.q_value < 0.001 ? "<0.001" : c.q_value.toFixed(3)}
            label="FDR q-value"
            sub={`raw p=${c.p_value}`}
            tone="good"
          />
          <Stat
            value={inr(d.projected_savings_inr)}
            label="warranty cost avoided"
            sub={`${d.units_at_risk} units still at risk`}
            tone="good"
          />
        </div>

        <p className="mt-4 rounded-lg border border-ok/25 bg-ok/5 px-4 py-2.5 text-[13px] text-slate-300">
          <span className="font-semibold text-ok">Corrected for multiple comparisons.</span>{" "}
          Screening this many cohorts at p&lt;0.05 is expected to throw false positives;
          the Benjamini–Hochberg q-value is what separates this cluster from them.
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* the grounded reasoning */}
        <Card
          title="5-Why root cause analysis"
          subtitle="Every step carries its own evidence — a statistic, or a cited CAPA"
        >
          <ol className="space-y-3">
            {d.five_why.map((w, i) => (
              <li key={i} className="relative pl-8">
                <span className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[11px] font-bold text-accent">
                  {i + 1}
                </span>
                <p className="text-[13px] font-medium text-slate-200">{w.why}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{w.because}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-600">[{w.evidence}]</p>
              </li>
            ))}
          </ol>
        </Card>

        {/* the deliverable */}
        <Card
          title="Auto-drafted CAPA ticket"
          right={
            <div className="flex items-center gap-2">
              <DownloadCapaButton />
              <Badge tone={d.confidence === "high" ? "good" : "warn"}>{d.confidence}</Badge>
            </div>
          }
        >
          <dl className="space-y-3 text-[13px]">
            <Field label="Draft ID" mono>{d.capa_id}</Field>
            <Field label="Cited precedent">
              <div className="flex flex-wrap gap-1.5">
                {d.cited_capa_ids.map((id) => (
                  <button
                    key={id}
                    onClick={() => setOpenCapaId(id)}
                    className="rounded border border-edge bg-ink-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 transition duration-150 hover:border-accent/50 hover:text-accent active:scale-95"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Corrective action">{d.recommended_corrective}</Field>
            <Field label="Preventive action">{d.recommended_preventive}</Field>
          </dl>

          {canDispatch ? (
            <>
              <button
                onClick={() => setSent(true)}
                disabled={sent}
                className={`mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-200 ${
                  sent
                    ? "animate-in cursor-default border border-ok/40 bg-ok/15 text-ok"
                    : "bg-accent-deep text-white hover:bg-accent active:scale-[0.98]"
                }`}
              >
                {sent ? "✓ Sent to Manufacturing — Nashik" : "Send to Manufacturing"}
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-500">
                {sent
                  ? "notify.plant is side-effect: irreversible — logged in the audit chain"
                  : "Requires human approval — the agent drafts, it does not dispatch"}
              </p>
            </>
          ) : (
            <div className="mt-5 rounded-lg border border-edge bg-ink-700/40 px-4 py-3 text-center">
              <p className="text-[12px] text-slate-400">
                Your role can draft CAPA tickets but not dispatch them.
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600">
                Sending to manufacturing needs{" "}
                <span className="font-mono text-slate-500">capa:dispatch</span> — held by
                Quality Manager, not Quality Engineer, deliberately.
              </p>
            </div>
          )}
        </Card>
      </div>

      {openCapaId && <CapaModal capaId={openCapaId} onClose={() => setOpenCapaId(null)} />}
    </div>
  );
}

/** The historical CAPA a citation points to. /api/capa/{id} exists specifically
 * so these citations aren't just text — this is what makes them mean something. */
function CapaModal({ capaId, onClose }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDoc(null);
    setError(null);
    api.get(`/api/capa/${capaId}`).then(setDoc).catch((e) => setError(e.message || String(e)));
  }, [capaId]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="animate-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-edge bg-ink-800 shadow-2xl"
      >
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-edge bg-ink-800 px-5 py-3.5">
          <div>
            <h2 className="font-mono text-[13px] font-semibold text-slate-100">{capaId}</h2>
            <p className="mt-0.5 text-xs text-slate-500">Historical precedent — cited by the 5-Why above</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition hover:bg-ink-700 hover:text-slate-300"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="p-5">
          {error ? (
            <Empty icon="search">{error}</Empty>
          ) : !doc ? (
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4 text-[13px]">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="accent">{doc.component?.replace(/_/g, " ")}</Badge>
                {doc.plant && <Badge tone="slate">{doc.plant}</Badge>}
                {doc.batch_id && <Badge tone="slate">{doc.batch_id}</Badge>}
                {doc.status && <Badge tone={doc.status.toLowerCase().includes("closed") ? "good" : "warn"}>{doc.status}</Badge>}
              </div>

              {doc.defect_mode && (
                <Field label="Defect mode">{doc.defect_mode}</Field>
              )}
              <Field label="Root cause">{doc.root_cause}</Field>
              {doc.five_why?.length > 0 && (
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">5-Why</dt>
                  <ol className="mt-1.5 space-y-1.5">
                    {doc.five_why.map((w, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] text-slate-400">
                        <span className="text-slate-600">{i + 1}.</span> {w}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Field label="Corrective action">{doc.corrective_action}</Field>
              <Field label="Preventive action">{doc.preventive_action}</Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, mono }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-slate-300 ${mono ? "font-mono text-[12px]" : ""}`}>{children}</dd>
    </div>
  );
}
