import { useState } from 'react'
import { CheckCircle, Circle, AlertCircle, RefreshCw } from 'lucide-react'

type StepStatus = 'idle' | 'running' | 'done' | 'replanning' | 'blocked'

const INITIAL_STEPS = [
  { id: 'plan', label: 'PLAN', desc: 'Master Agent creates ordered plan' },
  { id: 'data', label: 'DataAnalysisAgent', desc: 'Reads telemetry, runs M1/M4 models' },
  { id: 'diag', label: 'DiagnosisAgent', desc: 'Ranks failure risks, assigns severity' },
  { id: 'ce', label: 'CustomerEngagementAgent', desc: 'Voice conversation with driver' },
  { id: 'sched', label: 'SchedulingAgent', desc: 'Holds & confirms service slot' },
  { id: 'fb', label: 'FeedbackAgent', desc: 'Collects CSAT/NPS post-service' },
  { id: 'close', label: 'CLOSE', desc: 'Save run summary & emit final event' },
]

export default function AgentsPage() {
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>(
    Object.fromEntries(INITIAL_STEPS.map(s => [s.id, 'idle']))
  )
  const [running, setRunning] = useState(false)
  const [redTeam, setRedTeam] = useState(false)

  const runDemo = async () => {
    setRunning(true)
    setRedTeam(false)
    const reset = Object.fromEntries(INITIAL_STEPS.map(s => [s.id, 'idle' as StepStatus]))
    setStatuses(reset)

    const steps = INITIAL_STEPS.map(s => s.id)
    for (let i = 0; i < steps.length; i++) {
      setStatuses(prev => ({ ...prev, [steps[i]]: 'running' }))
      await delay(900)
      setStatuses(prev => ({ ...prev, [steps[i]]: 'done' }))
    }
    setRunning(false)
  }

  const runRedTeam = async () => {
    setRunning(true)
    setRedTeam(true)
    const reset = Object.fromEntries(INITIAL_STEPS.map(s => [s.id, 'idle' as StepStatus]))
    setStatuses(reset)

    for (const step of ['plan', 'data', 'diag', 'ce']) {
      setStatuses(prev => ({ ...prev, [step]: 'running' }))
      await delay(700)
      setStatuses(prev => ({ ...prev, [step]: 'done' }))
    }

    // Scheduling agent gets blocked
    setStatuses(prev => ({ ...prev, sched: 'running' }))
    await delay(600)
    setStatuses(prev => ({ ...prev, sched: 'blocked' }))
    await delay(400)

    // Re-plan
    setStatuses(prev => ({ ...prev, plan: 'replanning' }))
    await delay(800)
    setStatuses(prev => ({ ...prev, plan: 'done', sched: 'blocked' }))

    for (const step of ['fb', 'close']) {
      setStatuses(prev => ({ ...prev, [step]: 'running' }))
      await delay(700)
      setStatuses(prev => ({ ...prev, [step]: 'done' }))
    }
    setRunning(false)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">LangGraph Master Agent</h1>
        <div className="flex gap-3">
          <button
            onClick={runDemo}
            disabled={running}
            className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            ▶ Run Normal Flow
          </button>
          <button
            onClick={runRedTeam}
            disabled={running}
            className="bg-purple-700 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            🔴 Red Team Demo
          </button>
        </div>
      </div>

      {redTeam && (
        <div className="bg-purple-900/30 border border-purple-700 rounded-xl p-3 text-sm text-purple-300">
          🛡 Red Team: SchedulingAgent attempted to call <code className="bg-purple-900 px-1 rounded">telemetry.read_window</code> — BLOCKED by UEBA policy. Master Agent re-plans.
        </div>
      )}

      {/* Agent Flow */}
      <div className="card space-y-2">
        {INITIAL_STEPS.map((step, i) => {
          const status = statuses[step.id]
          return (
            <div key={step.id}>
              <div className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                status === 'running' ? 'bg-blue-900/30 border border-blue-700' :
                status === 'done' ? 'bg-green-900/20' :
                status === 'blocked' ? 'bg-red-900/30 border border-red-700' :
                status === 'replanning' ? 'bg-yellow-900/30 border border-yellow-700' :
                'opacity-50'
              }`}>
                <div className="mt-0.5">
                  {status === 'running' ? <RefreshCw size={16} className="text-blue-400 animate-spin" /> :
                   status === 'done' ? <CheckCircle size={16} className="text-green-400" /> :
                   status === 'blocked' ? <AlertCircle size={16} className="text-red-400" /> :
                   status === 'replanning' ? <RefreshCw size={16} className="text-yellow-400" /> :
                   <Circle size={16} className="text-slate-600" />}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {step.label}
                    {status === 'blocked' && <span className="badge-p1">BLOCKED</span>}
                    {status === 'replanning' && <span className="badge-p2">RE-PLANNING</span>}
                  </div>
                  <div className="text-xs text-slate-400">{step.desc}</div>
                </div>
              </div>
              {i < INITIAL_STEPS.length - 1 && (
                <div className="ml-5 w-0.5 h-3 bg-slate-700 rounded" />
              )}
            </div>
          )
        })}
      </div>

      {/* Agent Role Table */}
      <div className="card">
        <h3 className="font-semibold mb-3">Agent Roles & Permissions</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-left border-b border-slate-700">
              <th className="pb-2">Agent</th>
              <th className="pb-2">Allowed Tools</th>
              <th className="pb-2">UEBA Layer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {[
              { agent: 'DataAnalysisAgent', tools: 'telemetry.read, ml.predict', layer: 'Policy + Behaviour' },
              { agent: 'DiagnosisAgent', tools: 'prediction.rank, shap.explain', layer: 'Policy' },
              { agent: 'CustomerEngagementAgent', tools: 'customer.profile, voice.speak', layer: 'Policy + Sequence' },
              { agent: 'SchedulingAgent', tools: 'slot.hold, slot.confirm', layer: 'Policy + Behaviour' },
              { agent: 'FeedbackAgent', tools: 'feedback.collect, record.update', layer: 'Policy' },
              { agent: 'MfgQualityAgent', tools: 'cluster.defects, capa.draft', layer: 'Policy + Sequence' },
            ].map(r => (
              <tr key={r.agent} className="text-xs">
                <td className="py-2 font-mono text-blue-300">{r.agent}</td>
                <td className="py-2 text-slate-300">{r.tools}</td>
                <td className="py-2 text-slate-400">{r.layer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
