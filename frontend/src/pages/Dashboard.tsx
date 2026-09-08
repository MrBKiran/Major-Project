import { useEffect, useState, useMemo } from 'react'
import { fetchVehicles, fetchPrediction } from '../lib/api'
import { useTelemetry, TelemetryData } from '../hooks/useTelemetry'
import { 
  Activity, AlertTriangle, CheckCircle, XCircle, Thermometer, Zap, 
  Search, Gauge, Fuel, ShieldAlert, ChevronRight, X, Sparkles, SlidersHorizontal, Eye
} from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { useNavigate } from 'react-router-dom'

const healthColor: Record<string, { badge: string; text: string; border: string; glow: string; bg: string }> = {
  Critical: {
    badge: 'badge-critical',
    text: 'text-rose-600',
    border: 'border-rose-200',
    glow: 'hover:border-rose-400 hover:shadow-md shadow-rose-100/50',
    bg: 'from-rose-50/50 via-white to-white'
  },
  'Needs Service': {
    badge: 'badge-needs-service',
    text: 'text-amber-700',
    border: 'border-amber-200',
    glow: 'hover:border-amber-400 hover:shadow-md shadow-amber-100/50',
    bg: 'from-amber-50/50 via-white to-white'
  },
  Good: {
    badge: 'badge-good',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    glow: 'hover:border-emerald-400 hover:shadow-md shadow-emerald-100/50',
    bg: 'from-emerald-50/40 via-white to-white'
  },
  Excellent: {
    badge: 'badge-excellent',
    text: 'text-cyan-700',
    border: 'border-cyan-200',
    glow: 'hover:border-cyan-400 hover:shadow-md shadow-cyan-100/50',
    bg: 'from-cyan-50/40 via-white to-white'
  },
  Unknown: {
    badge: 'bg-slate-100 text-slate-600 border border-slate-200',
    text: 'text-slate-600',
    border: 'border-slate-200',
    glow: 'hover:border-slate-300',
    bg: 'from-slate-50 to-white'
  }
}

export default function Dashboard() {
  const [vehicles, setVehicles] = useState<any[]>([])
  const [predictions, setPredictions] = useState<Record<string, any>>({})
  const [filter, setFilter] = useState<'ALL' | 'Critical' | 'Needs Service' | 'Healthy'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null)
  const [heroHistory, setHeroHistory] = useState<any[]>([])

  const telemetry = useTelemetry()
  const navigate = useNavigate()

  useEffect(() => {
    fetchVehicles().then(setVehicles).catch(console.error)
  }, [])

  useEffect(() => {
    vehicles.forEach(v => {
      fetchPrediction(v.vin).then(p => setPredictions(prev => ({ ...prev, [v.vin]: p }))).catch(() => {})
    })
  }, [vehicles])

  // Accumulate telemetry trend points for hero vehicle MH12AB1001
  useEffect(() => {
    const heroTelem = telemetry['MH12AB1001']
    if (heroTelem) {
      setHeroHistory(prev => {
        const next = [
          ...prev, 
          { 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            coolant: Number(heroTelem.coolant_temp.toFixed(1)),
            rpm: Math.round(heroTelem.rpm),
            speed: Math.round(heroTelem.speed)
          }
        ]
        return next.slice(-15) // Keep last 15 ticks
      })
    }
  }, [telemetry['MH12AB1001']?.coolant_temp])

  // Filter vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const pred = predictions[v.vin]
      const health = pred?.health?.class || 'Unknown'
      
      const matchesFilter = 
        filter === 'ALL' ? true :
        filter === 'Healthy' ? ['Good', 'Excellent'].includes(health) :
        health === filter

      const q = searchQuery.toLowerCase()
      const matchesSearch = !q || 
        v.vin.toLowerCase().includes(q) || 
        v.model.toLowerCase().includes(q) || 
        v.customer?.name.toLowerCase().includes(q)

      return matchesFilter && matchesSearch
    })
  }, [vehicles, predictions, filter, searchQuery])

  // Counts
  const counts = useMemo(() => {
    const total = vehicles.length
    const critical = Object.values(predictions).filter((p: any) => p?.health?.class === 'Critical').length
    const needsService = Object.values(predictions).filter((p: any) => p?.health?.class === 'Needs Service').length
    const healthy = Object.values(predictions).filter((p: any) => ['Good','Excellent'].includes(p?.health?.class)).length
    return { total, critical, needsService, healthy }
  }, [vehicles, predictions])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Fleet Telemetry Command</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-100 border border-cyan-300 text-cyan-800 text-xs font-semibold">
              Live M1/M2 ML
            </span>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            Real-time degradation detection · Component failure forecasting · Anomaly isolation
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search VIN, Model, Customer..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-all shadow-xs"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* High-Contrast Colorful Stat KPI Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Vehicles */}
        <div className="card bg-gradient-to-br from-cyan-50/70 via-white to-white border-cyan-200 hover:border-cyan-400 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-800 tracking-wider uppercase">Active Fleet</span>
            <Activity size={18} className="text-cyan-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{counts.total}</span>
            <span className="text-xs text-cyan-700 font-medium">vehicles live</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span>Streaming MQTT & synthetic</span>
          </div>
        </div>

        {/* Critical Attention */}
        <div className="card bg-gradient-to-br from-rose-50/70 via-white to-white border-rose-200 hover:border-rose-400 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-800 tracking-wider uppercase">Critical Severity</span>
            <XCircle size={18} className="text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-600">{counts.critical}</span>
            <span className="text-xs text-rose-600 font-medium">urgent breakdown risk</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-700 font-medium">
            Overheating / DTC active
          </div>
        </div>

        {/* Needs Service */}
        <div className="card bg-gradient-to-br from-amber-50/70 via-white to-white border-amber-200 hover:border-amber-400 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 tracking-wider uppercase">Needs Service</span>
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-700">{counts.needsService}</span>
            <span className="text-xs text-amber-700 font-medium">proactive booking</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-800 font-medium">
            Preventive service scheduled
          </div>
        </div>

        {/* Healthy */}
        <div className="card bg-gradient-to-br from-emerald-50/70 via-white to-white border-emerald-200 hover:border-emerald-400 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 tracking-wider uppercase">Optimal State</span>
            <CheckCircle size={18} className="text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-700">{counts.healthy}</span>
            <span className="text-xs text-emerald-700 font-medium">good / excellent</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-800 font-medium">
            Telemetric baseline nominal
          </div>
        </div>
      </div>

      {/* Hero Vehicle Spotlight & Live Recharts Trend (Dark Structural Contrast Accent) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                Hero Scenario In Progress
              </span>
              <span className="font-mono text-xs text-slate-400">VIN: MH12AB1001</span>
            </div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Mahindra Bolero B6 — Thermal Escalation Detected
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Coolant temperature is trending upward abnormally (+0.5°C/cycle). The XGBoost M2 Failure Predictor identifies a <strong className="text-amber-300">90% water pump failure risk</strong> within 39 days. Proactive voice outreach triggered.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button 
                onClick={() => navigate('/console')}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 transition-all flex items-center gap-1.5"
              >
                In-Car Cockpit HUD <ChevronRight size={14} />
              </button>
              <button 
                onClick={() => navigate('/agents')}
                className="px-3.5 py-1.5 rounded-lg bg-purple-600/40 hover:bg-purple-600/60 border border-purple-500/40 text-purple-200 font-bold text-xs transition-all flex items-center gap-1.5"
              >
                <Sparkles size={13} className="text-purple-300" /> Run LangGraph Agent
              </button>
            </div>
          </div>

          {/* Real-time Recharts Area Graph */}
          <div className="w-full lg:w-96 h-40 bg-slate-950/80 rounded-xl border border-slate-800 p-3 flex flex-col">
            <div className="flex justify-between items-center text-xs mb-1 px-1">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Thermometer size={13} className="text-amber-400" /> Live Coolant (°C)
              </span>
              <span className="font-mono font-bold text-amber-400">
                {telemetry['MH12AB1001'] ? `${telemetry['MH12AB1001'].coolant_temp.toFixed(1)} °C` : '96.2 °C'}
              </span>
            </div>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={heroHistory.length > 0 ? heroHistory : [
                  { time: '1', coolant: 88 }, { time: '2', coolant: 91 }, { time: '3', coolant: 94 }, { time: '4', coolant: 97 }, { time: '5', coolant: 101 }
                ]}>
                  <defs>
                    <linearGradient id="coolantGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide={true} />
                  <YAxis domain={['auto', 'auto']} hide={true} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Area type="monotone" dataKey="coolant" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#coolantGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Count */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-slate-500 mr-1" />
          {[
            { id: 'ALL', label: `All Vehicles (${counts.total})` },
            { id: 'Critical', label: `Critical (${counts.critical})` },
            { id: 'Needs Service', label: `Needs Service (${counts.needsService})` },
            { id: 'Healthy', label: `Healthy (${counts.healthy})` },
          ].map(tab => {
            const isSelected = filter === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <span className="text-xs text-slate-500 font-medium">
          Showing {filteredVehicles.length} of {vehicles.length} units
        </span>
      </div>

      {/* Vehicle Grid (Whitish Cards with Darker Typography & High-Contrast Metrics) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filteredVehicles.map(v => {
          const pred = predictions[v.vin]
          const telem: TelemetryData | undefined = telemetry[v.vin]
          const health = pred?.health?.class || 'Unknown'
          const style = healthColor[health] || healthColor['Unknown']
          const hasDtc = telem?.dtc && telem.dtc.length > 0

          return (
            <div
              key={v.vin}
              onClick={() => setSelectedVehicle({ ...v, pred, telem })}
              className={`card bg-gradient-to-b ${style.bg} border ${style.border} ${style.glow} cursor-pointer group hover:-translate-y-1 transition-all duration-200 shadow-xs`}
            >
              {/* Card Header */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 text-base group-hover:text-blue-700 transition-colors">
                      {v.model}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono border border-slate-200">
                      {v.variant}
                    </span>
                  </div>
                  <div className="font-mono text-slate-500 text-xs mt-0.5">{v.vin}</div>
                  <div className="text-slate-700 text-xs mt-1 flex items-center gap-1.5 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-600" />
                    <span>{v.customer?.name}</span>
                    <span className="text-slate-500 text-[10px]">({v.customer?.language?.toUpperCase()})</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span className={style.badge}>
                    {health === 'Critical' && <XCircle size={12} />}
                    {health === 'Needs Service' && <AlertTriangle size={12} />}
                    {['Good', 'Excellent'].includes(health) && <CheckCircle size={12} />}
                    <span>{health}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Yr {v.manufacture_year}</span>
                </div>
              </div>

              {/* Real-time Telemetry Metrics Grid */}
              {telem ? (
                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-200/90">
                  {/* Coolant */}
                  <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mb-0.5 font-medium">
                      <Thermometer size={13} className={telem.coolant_temp > 105 ? 'text-rose-600' : 'text-cyan-600'} />
                      <span>Coolant</span>
                    </div>
                    <div className={`font-mono text-sm font-bold ${telem.coolant_temp > 105 ? 'text-rose-600' : 'text-slate-900'}`}>
                      {telem.coolant_temp.toFixed(1)}°C
                    </div>
                  </div>

                  {/* RPM */}
                  <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mb-0.5 font-medium">
                      <Gauge size={13} className="text-purple-600" />
                      <span>Engine</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-slate-900">
                      {Math.round(telem.rpm)} <span className="text-[10px] text-slate-500 font-normal">rpm</span>
                    </div>
                  </div>

                  {/* Battery */}
                  <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mb-0.5 font-medium">
                      <Zap size={13} className={telem.battery_voltage < 11.8 ? 'text-amber-600' : 'text-emerald-600'} />
                      <span>Battery</span>
                    </div>
                    <div className={`font-mono text-sm font-bold ${telem.battery_voltage < 11.8 ? 'text-amber-600' : 'text-slate-900'}`}>
                      {telem.battery_voltage.toFixed(1)}V
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-slate-500">Connecting telemetry stream...</div>
              )}

              {/* Failure Risk Strip */}
              {pred?.failure && (
                <div className="mt-3 pt-3 border-t border-slate-200/90 flex justify-between items-center text-xs">
                  <span className="text-slate-600 flex items-center gap-1 font-medium">
                    <ShieldAlert size={13} className={pred.failure.severity === 'P1' ? 'text-rose-600' : 'text-amber-600'} />
                    Failure Probability:
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900">
                      {(pred.failure.failure_probability * 100).toFixed(0)}%
                    </span>
                    <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                      pred.failure.severity === 'P1'
                        ? 'bg-rose-100 text-rose-800 border border-rose-300'
                        : pred.failure.severity === 'P2'
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}>
                      {pred.failure.severity}
                    </span>
                  </div>
                </div>
              )}

              {/* DTC Error Codes */}
              {hasDtc && (
                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">DTC:</span>
                  {telem.dtc.map((code: string) => (
                    <span key={code} className="badge-critical text-[10px] px-2 py-0.5 font-mono animate-pulse">
                      {code}
                    </span>
                  ))}
                </div>
              )}

              {/* Action Hint */}
              <div className="mt-3 text-[11px] text-blue-600 group-hover:text-blue-800 font-semibold flex items-center justify-end gap-1">
                <span>View Full Telemetry</span>
                <ChevronRight size={13} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Vehicle Deep-Dive Modal */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150 text-slate-900">
            {/* Modal Header */}
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-slate-900">{selectedVehicle.model} {selectedVehicle.variant}</h3>
                  <span className={healthColor[selectedVehicle.pred?.health?.class]?.badge || 'badge-good'}>
                    {selectedVehicle.pred?.health?.class || 'Healthy'}
                  </span>
                </div>
                <div className="font-mono text-sm text-blue-700 font-semibold mt-1">{selectedVehicle.vin}</div>
              </div>
              <button 
                onClick={() => setSelectedVehicle(null)}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Customer & Manufacturing Meta */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="text-slate-500 font-medium">Customer</span>
                <div className="font-semibold text-slate-900 mt-0.5">{selectedVehicle.customer?.name}</div>
              </div>
              <div>
                <span className="text-slate-500 font-medium">Phone</span>
                <div className="font-mono text-slate-900 mt-0.5">{selectedVehicle.customer?.phone}</div>
              </div>
              <div>
                <span className="text-slate-500 font-medium">Assembly Plant</span>
                <div className="font-semibold text-slate-900 mt-0.5">{selectedVehicle.plant_id}</div>
              </div>
              <div>
                <span className="text-slate-500 font-medium">Batch Code</span>
                <div className="font-mono text-amber-700 font-bold mt-0.5">{selectedVehicle.batch_id}</div>
              </div>
            </div>

            {/* Real-time Telemetry Snapshot */}
            {selectedVehicle.telem && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Live Diagnostics</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="card-amber p-3 rounded-xl text-center">
                    <span className="text-[11px] text-amber-800 font-semibold">Coolant Temp</span>
                    <div className="text-lg font-black text-slate-900 mt-1">{selectedVehicle.telem.coolant_temp.toFixed(1)} °C</div>
                  </div>
                  <div className="card-purple p-3 rounded-xl text-center">
                    <span className="text-[11px] text-purple-800 font-semibold">Engine RPM</span>
                    <div className="text-lg font-black text-slate-900 mt-1">{Math.round(selectedVehicle.telem.rpm)}</div>
                  </div>
                  <div className="card-cyan p-3 rounded-xl text-center">
                    <span className="text-[11px] text-cyan-800 font-semibold">Vehicle Speed</span>
                    <div className="text-lg font-black text-slate-900 mt-1">{Math.round(selectedVehicle.telem.speed)} km/h</div>
                  </div>
                  <div className="card-emerald p-3 rounded-xl text-center">
                    <span className="text-[11px] text-emerald-800 font-semibold">Battery Voltage</span>
                    <div className="text-lg font-black text-slate-900 mt-1">{selectedVehicle.telem.battery_voltage.toFixed(1)} V</div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => { setSelectedVehicle(null); navigate('/console') }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs transition-colors"
              >
                In-Car Console
              </button>
              <button
                onClick={() => { setSelectedVehicle(null); navigate('/agents') }}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-md transition-colors"
              >
                Dispatch LangGraph Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
