import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Thermometer, Gauge, Zap, Droplet } from 'lucide-react'

const VEHICLES = [
  { vin: 'MH12AB1001', model: 'Bolero', owner: 'Ramesh Kumar', scenario: 'coolant_rising' },
  { vin: 'MH12AB1002', model: 'Scorpio', owner: 'Priya Singh', scenario: 'normal' },
  { vin: 'MH12AB1003', model: 'Thar', owner: 'Arjun Mehta', scenario: 'declined' },
  { vin: 'MH12AB1004', model: 'XUV700', owner: 'Sunita Rao', scenario: 'normal' },
  { vin: 'MH12AB1005', model: 'Bolero', owner: 'Vikram Das', scenario: 'oil_low' },
  { vin: 'MH12AB1006', model: 'Scorpio', owner: 'Kavita Nair', scenario: 'normal' },
  { vin: 'MH12AB1007', model: 'Thar', owner: 'Rohit Sharma', scenario: 'battery_weak' },
  { vin: 'MH12AB1008', model: 'XUV300', owner: 'Anita Patel', scenario: 'normal' },
  { vin: 'MH12AB1009', model: 'Bolero', owner: 'Suresh Gupta', scenario: 'coolant_rising' },
  { vin: 'MH12AB1010', model: 'XUV700', owner: 'Deepa Iyer', scenario: 'normal' },
]

function mockTelemetry(v: typeof VEHICLES[0], tick: number) {
  const base = { coolant: 88, oil: 35, battery: 12.5, speed: 55, rpm: 2000 }
  if (v.scenario === 'coolant_rising') base.coolant = 90 + tick * 0.5
  if (v.scenario === 'oil_low') base.oil = 22
  if (v.scenario === 'battery_weak') base.battery = 11.8
  return {
    coolant: +(base.coolant + Math.random() * 2).toFixed(1),
    oil: +(base.oil + Math.random()).toFixed(1),
    battery: +(base.battery + Math.random() * 0.1).toFixed(2),
    speed: +(base.speed + Math.random() * 20 - 10).toFixed(0),
    rpm: +(base.rpm + Math.random() * 300 - 150).toFixed(0),
  }
}

function getHealth(v: typeof VEHICLES[0], telemetry: ReturnType<typeof mockTelemetry>) {
  if (v.scenario === 'coolant_rising' && telemetry.coolant > 100) return 'Critical'
  if (v.scenario === 'oil_low') return 'Needs Service'
  if (v.scenario === 'coolant_rising') return 'Needs Service'
  if (v.scenario === 'battery_weak') return 'Needs Service'
  return 'Good'
}

const healthColor: Record<string, string> = {
  Critical: 'text-red-400',
  'Needs Service': 'text-yellow-400',
  Good: 'text-green-400',
  Excellent: 'text-emerald-400',
}

export default function FleetDashboard() {
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState(VEHICLES[0])
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const t = mockTelemetry(selected, tick)
    setHistory(prev => [...prev.slice(-20), { tick, ...t }])
  }, [tick, selected.vin])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Fleet Dashboard</h1>

      {/* Fleet Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {VEHICLES.map(v => {
          const t = mockTelemetry(v, tick)
          const health = getHealth(v, t)
          return (
            <button
              key={v.vin}
              onClick={() => { setSelected(v); setHistory([]) }}
              className={`card text-left hover:border-brand transition-colors ${selected.vin === v.vin ? 'border-brand' : ''}`}
            >
              <div className="font-semibold text-sm">{v.model}</div>
              <div className="text-xs text-slate-400 truncate">{v.owner}</div>
              <div className={`text-xs font-bold mt-1 ${healthColor[health]}`}>{health}</div>
              <div className="text-xs text-slate-500 mt-0.5">{t.coolant}°C</div>
            </button>
          )
        })}
      </div>

      {/* Selected Vehicle Detail */}
      {(() => {
        const t = mockTelemetry(selected, tick)
        const health = getHealth(selected, t)
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Stats */}
            <div className="card space-y-3">
              <h2 className="font-bold text-lg">{selected.model} – {selected.vin}</h2>
              <p className="text-sm text-slate-400">{selected.owner}</p>
              <div className={`text-sm font-bold ${healthColor[health]}`}>Health: {health}</div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <Stat icon={<Thermometer size={14}/>} label="Coolant" value={`${t.coolant}°C`} warn={t.coolant > 100} />
                <Stat icon={<Gauge size={14}/>} label="Oil Press." value={`${t.oil} PSI`} warn={t.oil < 25} />
                <Stat icon={<Zap size={14}/>} label="Battery" value={`${t.battery}V`} warn={t.battery < 12.0} />
                <Stat icon={<Droplet size={14}/>} label="Speed" value={`${t.speed} km/h`} warn={false} />
              </div>

              {health !== 'Good' && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-300">
                  ⚠️ {selected.scenario === 'coolant_rising' ? 'Coolant temp rising – possible water pump issue' :
                       selected.scenario === 'oil_low' ? 'Oil pressure critically low' :
                       'Battery voltage below threshold'}
                </div>
              )}
            </div>

            {/* Coolant Chart */}
            <div className="card md:col-span-2">
              <h3 className="font-semibold mb-3 text-sm text-slate-300">Coolant Temperature Trend</h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={history}>
                  <XAxis dataKey="tick" hide />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#16213e', border: '1px solid #0f3460', fontSize: 12 }}
                    formatter={(v: any) => [`${v}°C`, 'Coolant']}
                  />
                  <Line type="monotone" dataKey="coolant" stroke="#e63946" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Stat({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg ${warn ? 'bg-red-900/20 border border-red-800' : 'bg-[#0f3460]/40'}`}>
      <span className={warn ? 'text-red-400' : 'text-slate-400'}>{icon}</span>
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        <div className={`text-sm font-semibold ${warn ? 'text-red-300' : 'text-white'}`}>{value}</div>
      </div>
    </div>
  )
}
