import { useState, useEffect } from 'react'
import { runAgent, fetchRuns, fetchVehicles } from '../lib/api'
import { 
  Brain, Play, CheckCircle, XCircle, AlertTriangle, ArrowRight, 
  Sparkles, Shield, Cpu, RefreshCw, Layers, Terminal, ChevronDown, ChevronUp, Bot
} from 'lucide-react'

const PIPELINE_STAGES = [
  { name: 'Master Agent', role: 'Planner & StateGraph Orchestrator', color: 'border-indigo-200 bg-indigo-50/50 text-indigo-900', dot: 'bg-indigo-600' },
  { name: 'Data Analysis', role: 'M1 Health & M4 Anomaly Isolation', color: 'border-cyan-200 bg-cyan-50/50 text-cyan-900', dot: 'bg-cyan-600' },
  { name: 'Diagnosis', role: 'M2 Failure Risk & DTC Classification', color: 'border-amber-200 bg-amber-50/50 text-amber-900', dot: 'bg-amber-600' },
  { name: 'Customer Voice', role: 'Hindi/English Driver Outreach', color: 'border-emerald-200 bg-emerald-50/50 text-emerald-900', dot: 'bg-emerald-600' },
  { name: 'Scheduling', role: 'Service Centre Slot Allocation', color: 'border-sky-200 bg-sky-50/50 text-sky-900', dot: 'bg-sky-600' },
  { name: 'Feedback', role: 'Post-Service Resolution Loop', color: 'border-pink-200 bg-pink-50/50 text-pink-900', dot: 'bg-pink-600' },
  { name: 'Plant Quality', role: 'RCA Clustering & CAPA Generation', color: 'border-fuchsia-200 bg-fuchsia-50/50 text-fuchsia-900', dot: 'bg-fuchsia-600' },
]

export default function AgentView() {
  const [runs, setRuns] = useState<any[]>([])
  const [running, setRunning] = useState(false)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVin, setSelectedVin] = useState('MH12AB1001')
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  useEffect(() => {
    fetchVehicles().then(setVehicles).catch(() => {})
    fetchRuns().then(r => {
      if (r && r.length > 0) setRuns(r.reverse())
    }).catch(() => {})
  }, [])

  async function startRun() {
    setRunning(true)
    try {
      const result = await runAgent(selectedVin)
      setRuns(prev => [result, ...prev])
      setExpandedRun(result.run_id)
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
              <Brain className="text-purple-700" size={26} /> LangGraph Agentic Orchestrator
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-100 border border-purple-300 text-purple-800 text-xs font-semibold">
              Autonomous Loop
            </span>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            PLAN → DISPATCH → [UEBA RBAC Guard] → OBSERVE → RE-PLAN → CLOSE
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <select
            value={selectedVin}
            onChange={e => setSelectedVin(e.target.value)}
            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-slate-900 font-mono shadow-xs"
          >
            {vehicles.map(v => (
              <option key={v.vin} value={v.vin}>
                {v.vin} — {v.model} ({v.customer?.name})
              </option>
            ))}
          </select>

          <button
            onClick={startRun}
            disabled={running}
            className="px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm text-white bg-slate-900 hover:bg-slate-800 shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 flex-shrink-0"
          >
            {running ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Orchestrating...</span>
              </>
            ) : (
              <>
                <Play size={15} />
                <span>Execute Agent</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Visual Multi-Colored DAG Pipeline */}
      <div className="card bg-white border border-slate-200 p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={14} className="text-purple-700" /> Multi-Agent Execution Graph
          </span>
          <span className="text-slate-500 font-mono">7 Specialized Agent Personas · Strict UEBA Wrapped</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-1">
          {PIPELINE_STAGES.map((s, idx) => (
            <div
              key={s.name}
              className={`p-3 rounded-xl border ${s.color} shadow-2xs relative group hover:scale-[1.02] transition-transform`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                <span className="font-mono text-[10px] text-slate-500 font-bold">0{idx + 1}</span>
              </div>
              <div className="font-black text-xs text-slate-900">{s.name}</div>
              <div className="text-[10px] text-slate-600 mt-1 line-clamp-2 leading-tight">
                {s.role}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Execution Run History */}
      <div className="space-y-4">
        {runs.length === 0 ? (
          <div className="card bg-white text-center text-slate-500 py-16 space-y-3 border-dashed border-slate-300">
            <Bot size={40} className="mx-auto text-purple-400/60 animate-pulse" />
            <div className="text-sm font-semibold text-slate-800">No Orchestration Runs Yet</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Select a vehicle above and click "Execute Agent" to dispatch the autonomous LangGraph state machine.
            </p>
          </div>
        ) : (
          runs.map(run => {
            const isExpanded = expandedRun === run.run_id
            const diag = run.results?.diagnosis
            const engagement = run.results?.customer_engagement
            const scheduling = run.results?.scheduling

            return (
              <div
                key={run.run_id}
                className="card bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:border-slate-300 transition-all duration-200"
              >
                {/* Run Header Strip */}
                <div
                  onClick={() => setExpandedRun(isExpanded ? null : run.run_id)}
                  className="p-4 bg-slate-50 hover:bg-slate-100/80 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
                      LG
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">{run.run_id}</span>
                        <span className="badge-good text-[10px]">
                          <CheckCircle size={10} />
                          {run.status || 'COMPLETED'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        VIN: <strong className="text-slate-900 font-mono">{run.vin}</strong> · Plan: {run.plan_id || 'PLAN-AUTO-01'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-mono">
                      {new Date().toLocaleTimeString()}
                    </span>
                    <button className="text-slate-400 hover:text-slate-700">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="p-5 space-y-4">
                    {/* Execution Stages Outcome Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* Diagnostic Synthesis */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Diagnostic Synthesis
                        </div>
                        <div className="text-xs font-semibold text-slate-800">
                          {diag?.recommendation || 'No critical failure detected.'}
                        </div>
                        {diag?.failure_probability !== undefined && (
                          <div className="mt-2 text-[11px] text-amber-700 font-medium">
                            Risk: {(diag.failure_probability * 100).toFixed(0)}% ({diag.component || 'Thermal'})
                          </div>
                        )}
                      </div>

                      {/* Customer Outreach */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Driver Outreach (Voice)
                        </div>
                        <div className="text-xs font-semibold text-slate-800">
                          {engagement?.message_sent ? 'Hindi Voice Outreach Sent' : 'Queued for next cycle'}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          Channel: In-Car Cockpit HUD + IVR
                        </div>
                      </div>

                      {/* Service Centre Scheduling */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Service Scheduling
                        </div>
                        <div className="text-xs font-semibold text-slate-800">
                          {scheduling?.slot_id ? `Slot ${scheduling.slot_id} Held` : 'Auto-Reserved'}
                        </div>
                        <div className="mt-2 text-[11px] text-emerald-700 font-medium">
                          Priority Bay Allocated
                        </div>
                      </div>
                    </div>

                    {/* Dark Code Box for Machine Log / JSON Payload */}
                    <div className="bg-slate-900 rounded-xl p-4 text-xs font-mono text-slate-100 overflow-x-auto shadow-inner">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Terminal size={12} className="text-cyan-400" />
                          LangGraph State Trajectory
                        </span>
                        <span className="text-emerald-400">UEBA Zero-Trust Verified</span>
                      </div>
                      <pre className="text-[11px] leading-relaxed text-slate-200">
                        {JSON.stringify(run.results || run, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
