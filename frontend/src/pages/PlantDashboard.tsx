import { useState } from 'react'
import { runRCA, fetchCapa } from '../lib/api'
import { 
  Factory, AlertTriangle, FileText, RefreshCw, GitCommit, CheckCircle2, 
  Sparkles, TrendingUp, IndianRupee, ShieldCheck, Download, Layers, ArrowRight
} from 'lucide-react'

const ISHIKAWA_CAUSES = {
  Material: { color: 'border-amber-200 bg-amber-50/60 text-amber-900', dot: 'bg-amber-600', causes: ['Sub-optimal alloy grade', 'Supplier change Q3 2023'] },
  Method: { color: 'border-purple-200 bg-purple-50/60 text-purple-900', dot: 'bg-purple-600', causes: ['Insufficient thermal cycle testing', 'Standard validation protocol only'] },
  Machine: { color: 'border-cyan-200 bg-cyan-50/60 text-cyan-900', dot: 'bg-cyan-600', causes: ['Assembly torque out of spec', 'Incorrect seating depth'] },
  Environment: { color: 'border-emerald-200 bg-emerald-50/60 text-emerald-900', dot: 'bg-emerald-600', causes: ['High Deccan Plateau ambient heat', 'Dusty road operating profile'] },
  Measurement: { color: 'border-rose-200 bg-rose-50/60 text-rose-900', dot: 'bg-rose-600', causes: ['No in-field vibration monitoring', 'Sensor thermal lag (+3.2s)'] },
  Man: { color: 'border-sky-200 bg-sky-50/60 text-sky-900', dot: 'bg-sky-600', causes: ['Line assembly training gap', 'QC batch sampling rate low (5%)'] },
}

export default function PlantDashboard() {
  const [capaList, setCapaList] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [running, setRunning] = useState(false)

  async function triggerRCA() {
    setRunning(true)
    try {
      const result = await runRCA()
      setReports(result.reports || [])
      const capa = await fetchCapa()
      setCapaList(capa)
    } catch (e) {
      console.error(e)
    }
    setRunning(false)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
              <Factory className="text-fuchsia-700" size={26} /> Manufacturing Quality & RCA Loop
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-fuchsia-100 border border-fuchsia-300 text-fuchsia-800 text-xs font-semibold">
              Plant Pune-01 Feedback
            </span>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            Telemetry Defect Clustering → 5-Why Deep Dive → Ishikawa (Fishbone) → Automated CAPA Recalls
          </p>
        </div>

        <button
          onClick={triggerRCA}
          disabled={running}
          className="px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm text-white bg-slate-900 hover:bg-slate-800 shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 flex-shrink-0"
        >
          <RefreshCw size={15} className={running ? 'animate-spin' : ''} />
          <span>{running ? 'Running Pipeline...' : 'Run RCA Pipeline'}</span>
        </button>
      </div>

      {reports.length === 0 && capaList.length === 0 ? (
        <div className="card bg-white text-center text-slate-500 py-16 space-y-3 border-dashed border-slate-300 shadow-xs">
          <Factory size={42} className="mx-auto text-fuchsia-400/50 animate-pulse" />
          <div className="text-sm font-semibold text-slate-800">No Active RCA Cluster Selected</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click "Run RCA Pipeline" above to group recurring telemetry anomalies across batches and construct the Ishikawa root cause graph.
          </p>
        </div>
      ) : null}

      {/* Generated RCA & CAPA Reports */}
      {reports.map(r => (
        <div
          key={r.record_id}
          className="card bg-white border border-slate-200 p-6 space-y-6 shadow-xs animate-in fade-in zoom-in duration-200"
        >
          {/* Report Top Strip */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-fuchsia-800 bg-fuchsia-50 px-2.5 py-0.5 rounded border border-fuchsia-200">
                  {r.record_id}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase">
                  BATCH: {r.batch_id}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                  {r.affected_vehicles} FLEET VEHICLES AFFECTED
                </span>
              </div>
              <h2 className="text-lg font-black text-slate-900 mt-2">{r.failure_mode}</h2>
              <p className="text-xs text-slate-600 mt-1">{r.cluster_summary}</p>
            </div>

            <div className="bg-slate-900 text-white rounded-xl p-4 sm:w-64 border border-slate-800 shadow-md">
              <div className="text-[10px] uppercase font-bold text-slate-400">Projected Warranty Impact</div>
              <div className="text-xl font-black text-amber-400 flex items-center gap-1 mt-1">
                <IndianRupee size={18} />
                <span>₹{(r.estimated_warranty_cost / 100000).toFixed(1)} Lakhs</span>
              </div>
              <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                <ShieldCheck size={12} />
                <span>Saved by proactive recall</span>
              </div>
            </div>
          </div>

          {/* 5-Why Root Cause Analysis */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <GitCommit size={14} className="text-purple-700" /> 5-Why Root Cause Investigation Chain
            </span>

            <div className="space-y-2">
              {r.five_why?.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex items-start gap-3 shadow-2xs"
                >
                  <div className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                    W{idx + 1}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">{item.why}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{item.answer}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ishikawa (Fishbone) Diagram Matrix */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={14} className="text-cyan-700" /> 6M Ishikawa (Fishbone) Decomposition
            </span>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {(Object.keys(ISHIKAWA_CAUSES) as (keyof typeof ISHIKAWA_CAUSES)[]).map(cat => {
                const conf = ISHIKAWA_CAUSES[cat]
                return (
                  <div
                    key={cat}
                    className={`p-3 rounded-xl border ${conf.color} shadow-2xs space-y-2`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${conf.dot}`} />
                      <span className="font-bold text-xs">{cat}</span>
                    </div>
                    <ul className="space-y-1">
                      {conf.causes.map((c, i) => (
                        <li key={i} className="text-[11px] leading-tight text-slate-700 list-disc list-inside">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Corrective & Preventive Action (CAPA) Plan */}
          {r.capa && (
            <div className="bg-emerald-50/70 border border-emerald-300 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-700" /> Plant CAPA Recommendation
                </span>
                <span className="badge-good text-[10px]">VERIFIED CAPA</span>
              </div>

              <div className="text-xs text-slate-800 font-medium">
                {r.capa.description}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-emerald-200">
                <div>
                  <span className="text-slate-500 font-medium">Action Type</span>
                  <div className="font-bold text-slate-900 mt-0.5">{r.capa.action_type || 'Assembly Recalibration'}</div>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Owner</span>
                  <div className="font-bold text-slate-900 mt-0.5">{r.capa.owner || 'Plant Pune-01 QC Team'}</div>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Target Completion</span>
                  <div className="font-bold text-slate-900 mt-0.5">{r.capa.target_date || '7 Business Days'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
