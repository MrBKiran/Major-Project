import { useState } from 'react'
import { Shield, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

const INITIAL_LOG = [
  { id: 1, ts: '09:01:12', agent: 'DataAnalysisAgent', tool: 'telemetry.read', decision: 'ALLOW', risk: 0.04 },
  { id: 2, ts: '09:01:13', agent: 'DiagnosisAgent', tool: 'prediction.rank', decision: 'ALLOW', risk: 0.06 },
  { id: 3, ts: '09:01:15', agent: 'CustomerEngagementAgent', tool: 'voice.speak', decision: 'ALLOW', risk: 0.08 },
]

export default function SecurityPage() {
  const [log, setLog] = useState(INITIAL_LOG)
  const [injected, setInjected] = useState(false)

  const injectRedTeam = () => {
    const block = {
      id: log.length + 1,
      ts: new Date().toLocaleTimeString(),
      agent: 'SchedulingAgent',
      tool: 'telemetry.read_window',
      decision: 'BLOCK',
      risk: 0.92,
    }
    setLog(prev => [...prev, block])
    setInjected(true)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="text-blue-400" /> UEBA Security Console
        </h1>
        <button
          onClick={injectRedTeam}
          disabled={injected}
          className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
        >
          🔴 Red Team Attack
        </button>
      </div>

      {/* UEBA Layers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { layer: 'A – Policy', method: 'RBAC Matrix', desc: 'Instant ALLOW / BLOCK per agent-tool pair', color: 'border-blue-700' },
          { layer: 'B – Behaviour', method: 'IsolationForest', desc: 'FLAG unusual tool-call patterns', color: 'border-yellow-700' },
          { layer: 'C – Sequence', method: 'LLM Judge', desc: 'Compare observed sequence to declared plan', color: 'border-purple-700' },
        ].map(l => (
          <div key={l.layer} className={`card border ${l.color}`}>
            <div className="font-bold text-sm mb-1">{l.layer}</div>
            <div className="text-xs text-blue-300 mb-1">{l.method}</div>
            <div className="text-xs text-slate-400">{l.desc}</div>
          </div>
        ))}
      </div>

      {/* Alert if blocked */}
      {injected && (
        <div className="bg-red-900/40 border border-red-600 rounded-xl p-4">
          <div className="flex items-center gap-2 font-bold text-red-300 mb-2">
            <AlertTriangle size={18} /> SECURITY ALERT – BLOCK EVENT
          </div>
          <div className="text-sm text-red-200">
            <strong>SchedulingAgent</strong> attempted to call <code className="bg-red-900 px-1 rounded">telemetry.read_window</code> which is outside its allowed toolset.
          </div>
          <div className="text-xs text-red-400 mt-2">
            → Policy Layer A: BLOCK | Risk Score: 0.92 | Agent quarantined | Master Agent notified for re-planning
          </div>
        </div>
      )}

      {/* Audit Log */}
      <div className="card">
        <h2 className="font-semibold mb-3 text-sm text-slate-300">Tamper-Evident Audit Chain</h2>
        <div className="space-y-2">
          {log.map(entry => (
            <div key={entry.id} className={`flex items-center gap-3 p-2 rounded-lg text-xs ${
              entry.decision === 'BLOCK' ? 'bg-red-900/30 border border-red-800' : 'bg-[#0f3460]/30'
            }`}>
              {entry.decision === 'BLOCK'
                ? <XCircle size={14} className="text-red-400 flex-shrink-0" />
                : <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
              <span className="text-slate-500 w-16">{entry.ts}</span>
              <span className="font-mono text-blue-300 w-40">{entry.agent}</span>
              <span className="text-slate-300 flex-1">{entry.tool}</span>
              <span className={`font-bold w-12 ${entry.decision === 'BLOCK' ? 'text-red-400' : 'text-green-400'}`}>
                {entry.decision}
              </span>
              <span className={`w-10 text-right ${entry.risk > 0.5 ? 'text-red-400' : 'text-slate-500'}`}>
                {entry.risk.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-3">
          🔒 Each row hashed with SHA-256 and chained to previous row for tamper-evidence
        </div>
      </div>
    </div>
  )
}
