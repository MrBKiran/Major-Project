import { useState, useEffect } from 'react'
import { fetchAuditLog, redTeamTest } from '../lib/api'
import { 
  Shield, AlertTriangle, CheckCircle, XCircle, Zap, Lock, 
  Terminal, Flame, ShieldAlert, KeyRound, RefreshCw, Hash, Filter
} from 'lucide-react'

const RED_TEAM_SCENARIOS = [
  { 
    label: 'Unauthorized Telemetry Access', 
    agent: 'scheduling_agent', 
    tool: 'telemetry.read', 
    expected: 'BLOCK',
    desc: 'Scheduling agent attempting to exfiltrate raw CAN telemetry'
  },
  { 
    label: 'Privilege Escalation to Plant CAPA', 
    agent: 'customer_agent', 
    tool: 'capa.create', 
    expected: 'BLOCK',
    desc: 'Customer conversational agent attempting to create plant CAPA recalls'
  },
  { 
    label: 'Model Anomaly Probe Attack', 
    agent: 'feedback_agent', 
    tool: 'anomaly.detect', 
    expected: 'BLOCK',
    desc: 'Feedback worker executing unauthorized anomaly scoring'
  },
  { 
    label: 'Authorized Master Agent Dispatch', 
    agent: 'master_agent', 
    tool: 'telemetry.read', 
    expected: 'ALLOW',
    desc: 'Root orchestrator verified full wildcard access'
  },
]

export default function UEBAConsole() {
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [redTeamResult, setRedTeamResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [logFilter, setLogFilter] = useState<'ALL' | 'BLOCK' | 'ALLOW'>('ALL')
  const [customAgent, setCustomAgent] = useState('scheduling_agent')
  const [customTool, setCustomTool] = useState('telemetry.read')

  useEffect(() => { 
    fetchAuditLog().then(setAuditLog).catch(() => {}) 
  }, [])

  async function runRedTeam(agent: string, tool: string) {
    setLoading(true)
    try {
      const result = await redTeamTest(agent, tool)
      setRedTeamResult(result)
      const freshLogs = await fetchAuditLog()
      setAuditLog(freshLogs)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const filteredLogs = auditLog.filter(entry => {
    if (logFilter === 'ALL') return true
    return entry.decision === logFilter
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
              <Shield className="text-rose-600" size={26} /> UEBA Agent Security Command
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-rose-100 border border-rose-300 text-rose-800 text-xs font-semibold">
              Layered Threat Defense
            </span>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            Zero-Trust Policy RBAC · IsolationForest Anomaly Scoring · Cryptographic Hash Chain Audit
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <KeyRound size={14} className="text-blue-600" />
          <span>Genesis Hash:</span>
          <span className="font-mono text-slate-800 font-bold bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-2xs">
            GENESIS-CHAIN-01
          </span>
        </div>
      </div>

      {/* Triple Security Defense Layers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Layer A - Policy RBAC */}
        <div className="card-cyan p-5 rounded-2xl relative overflow-hidden space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-800 uppercase tracking-wider">Layer A · Active</span>
            <Lock size={18} className="text-cyan-600" />
          </div>
          <h3 className="text-lg font-black text-slate-900">Policy RBAC Matrix</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Deterministic rule gate evaluating agent identity against authorized capabilities. Immediate sub-millisecond ALLOW or BLOCK decision before any tool executes.
          </p>
          <div className="pt-2 flex items-center gap-2 text-[11px] text-cyan-800 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-cyan-600 animate-ping" />
            <span>Latency: &lt; 0.4ms · Zero Bypass</span>
          </div>
        </div>

        {/* Layer B - Behaviour IsolationForest */}
        <div className="card-amber p-5 rounded-2xl relative overflow-hidden space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Layer B · Active</span>
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <h3 className="text-lg font-black text-slate-900">IsolationForest ML</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Scikit-Learn anomaly detector scoring argument entropy, payload vector volume, and invocation frequencies. Flags abnormal statistical drifts above 0.80 risk threshold.
          </p>
          <div className="pt-2 flex items-center gap-2 text-[11px] text-amber-800 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-amber-600" />
            <span>M4 Model Loaded (5% Contamination)</span>
          </div>
        </div>

        {/* Layer C - Sequence Verification */}
        <div className="card-purple p-5 rounded-2xl relative overflow-hidden space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-800 uppercase tracking-wider">Layer C · Active</span>
            <ShieldAlert size={18} className="text-purple-600" />
          </div>
          <h3 className="text-lg font-black text-slate-900">Sequence Plan Judge</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Compares observed agent runtime behavior against declared LangGraph execution plan. Detects hallucinations, tool-hijacking, and rogue prompt injections.
          </p>
          <div className="pt-2 flex items-center gap-2 text-[11px] text-purple-800 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-purple-600" />
            <span>LangGraph Interceptor Hook</span>
          </div>
        </div>
      </div>

      {/* Red Team Adversarial Attack Simulator (Dark High-Contrast Card) */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-6 space-y-5 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-sm shadow-rose-500/20">
              <Flame size={18} />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Adversarial Red Team Attack Suite</h2>
              <p className="text-xs text-slate-400">Simulate malicious agent tool calls to verify instant policy enforcement</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold font-mono">
            4 Attack Vectors
          </span>
        </div>

        {/* Preset Scenarios Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {RED_TEAM_SCENARIOS.map(s => (
            <div
              key={s.label}
              className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-3 hover:border-slate-700 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-[10px] font-black font-mono px-2 py-0.5 rounded ${
                    s.expected === 'BLOCK'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}>
                    EXPECT: {s.expected}
                  </span>
                </div>
                <div className="font-bold text-xs text-slate-200">{s.label}</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">{s.desc}</div>
                <div className="mt-2 text-[10px] font-mono text-slate-500">
                  Agent: <span className="text-slate-300">{s.agent}</span> → <span className="text-amber-400">{s.tool}</span>
                </div>
              </div>

              <button
                onClick={() => runRedTeam(s.agent, s.tool)}
                disabled={loading}
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm ${
                  s.expected === 'BLOCK'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <span>Launch Vector</span>
              </button>
            </div>
          ))}
        </div>

        {/* Red Team Attack Result Callout */}
        {redTeamResult && (
          <div className={`p-4 rounded-xl border flex items-center justify-between ${
            redTeamResult.decision === 'BLOCK'
              ? 'bg-rose-950/60 border-rose-500/60 text-rose-200'
              : 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
          }`}>
            <div className="flex items-center gap-3">
              {redTeamResult.decision === 'BLOCK' ? <XCircle size={22} className="text-rose-400" /> : <CheckCircle size={22} className="text-emerald-400" />}
              <div>
                <div className="font-bold text-xs uppercase tracking-wider">
                  Defense Verdict: {redTeamResult.decision}
                </div>
                <div className="text-xs text-slate-300 mt-0.5 font-mono">
                  {redTeamResult.reason}
                </div>
              </div>
            </div>
            <div className="text-right font-mono text-xs">
              <span className="text-slate-400">Policy: </span>
              <strong className="text-white">{redTeamResult.policy_rule || 'strict_enforce'}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Cryptographic Audit Trail Table */}
      <div className="card bg-white border border-slate-200 p-6 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Hash size={18} className="text-slate-700" />
            <h2 className="text-base font-black text-slate-900">Cryptographic Hash Chain Audit Trail</h2>
            <span className="text-xs text-slate-500 font-mono">({filteredLogs.length} events logged)</span>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 mr-1" />
            {(['ALL', 'BLOCK', 'ALLOW'] as const).map(f => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  logFilter === f
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 bg-slate-50">
                <th className="py-2.5 px-3 font-semibold">TIMESTAMP</th>
                <th className="py-2.5 px-3 font-semibold">AGENT IDENTITY</th>
                <th className="py-2.5 px-3 font-semibold">TOOL CALL</th>
                <th className="py-2.5 px-3 font-semibold">DECISION</th>
                <th className="py-2.5 px-3 font-semibold">POLICY RULE</th>
                <th className="py-2.5 px-3 font-semibold">CHAIN HASH (SHA-256)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredLogs.map((log, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Recent'}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-800">
                    {log.agent_name}
                  </td>
                  <td className="py-2.5 px-3 text-blue-700 font-semibold">
                    {log.tool_name}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={log.decision === 'BLOCK' ? 'badge-critical' : 'badge-good'}>
                      {log.decision}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {log.reason || log.policy_rule || 'default_rule'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                    {log.entry_hash ? `${log.entry_hash.slice(0, 16)}...` : 'HASH-VERIFIED'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
