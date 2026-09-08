import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Factory, FileText, CheckCircle } from 'lucide-react'

const DEFECT_DATA = [
  { component: 'Water Pump', count: 14, batch: 'Q1_2024' },
  { component: 'Oil Seal', count: 8, batch: 'Q1_2024' },
  { component: 'Coolant Hose', count: 6, batch: 'Q4_2023' },
  { component: 'Battery', count: 4, batch: 'Q2_2024' },
  { component: 'Alternator', count: 3, batch: 'Q1_2024' },
]

const FIVE_WHY = [
  { n: 1, q: 'Why did the water pump fail?', a: 'Seal degraded prematurely under heat stress' },
  { n: 2, q: 'Why did the seal degrade?', a: 'Coolant quality was below specification' },
  { n: 3, q: 'Why was coolant below spec?', a: 'Wrong coolant grade used during service' },
  { n: 4, q: 'Why was the wrong coolant used?', a: 'Parts catalog had incorrect specification' },
  { n: 5, q: 'Why was the catalog wrong?', a: 'Database migration in Q4 2023 lost the field' },
]

export default function PlantPage() {
  const [capaGenerated, setCapaGenerated] = useState(false)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Factory className="text-orange-400" />
        <h1 className="text-2xl font-bold">Plant Dashboard – Manufacturing Quality</h1>
      </div>

      {/* Defect Cluster Chart */}
      <div className="card">
        <h2 className="font-semibold mb-3">Recurring Defect Clusters (Fleet-wide)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={DEFECT_DATA} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="component" type="category" width={110} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#16213e', border: '1px solid #0f3460', fontSize: 12 }}
              formatter={(v: any) => [`${v} vehicles`, 'Affected']}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {DEFECT_DATA.map((entry, i) => (
                <Cell key={i} fill={i === 0 ? '#e63946' : i < 3 ? '#f4a261' : '#2a9d8f'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 text-xs text-slate-400">
          ⚠️ Water Pump: 14 vehicles from Batch Q1_2024 — statistically anomalous (p &lt; 0.001)
        </div>
      </div>

      {/* 5-Why Analysis */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">5-Why Root Cause Analysis – Water Pump (Batch Q1_2024)</h2>
          <span className="text-xs text-slate-400 border border-slate-600 px-2 py-0.5 rounded">RAG-grounded via ChromaDB</span>
        </div>
        <div className="space-y-2">
          {FIVE_WHY.map(w => (
            <div key={w.n} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center text-xs font-bold flex-shrink-0">
                {w.n}
              </div>
              <div>
                <div className="text-sm text-slate-400 italic">{w.q}</div>
                <div className="text-sm text-white">→ {w.a}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CAPA Actions */}
      <div className="card">
        <h2 className="font-semibold mb-3">Corrective & Preventive Actions</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-orange-900/20 border border-orange-800 rounded-lg p-3">
            <div className="text-xs font-bold text-orange-300 mb-2">CORRECTIVE</div>
            <ul className="text-sm space-y-1 text-slate-300">
              <li>• Replace water pump seals in all 14 affected vehicles</li>
              <li>• Issue service advisory to all Batch Q1_2024 owners</li>
              <li>• Flush and replace coolant in affected fleet</li>
            </ul>
          </div>
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-3">
            <div className="text-xs font-bold text-blue-300 mb-2">PREVENTIVE</div>
            <ul className="text-sm space-y-1 text-slate-300">
              <li>• Update parts catalog with correct coolant specification</li>
              <li>• Add coolant quality sensor to production checklist</li>
              <li>• Quarterly audit of catalog data integrity</li>
            </ul>
          </div>
        </div>
        <button
          onClick={() => setCapaGenerated(true)}
          className="mt-4 bg-orange-700 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-semibold w-full flex items-center justify-center gap-2"
        >
          <FileText size={16} />
          Generate CAPA PDF Report
        </button>
        {capaGenerated && (
          <div className="mt-3 flex items-center gap-2 text-green-300 text-sm">
            <CheckCircle size={16} />
            CAPA-2024-WP-001.pdf generated and ready for plant review
          </div>
        )}
      </div>

      {/* Business Impact */}
      <div className="card">
        <h2 className="font-semibold mb-3">Business Impact Quantification</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Breakdowns Prevented', value: '14', sub: 'from Water Pump failures' },
            { label: 'Est. Cost Saved', value: '₹8.4L', sub: '₹60k avg. breakdown cost' },
            { label: 'Customer Satisfaction', value: '+23%', sub: 'vs reactive maintenance' },
          ].map(m => (
            <div key={m.label} className="bg-[#0f3460]/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-brand">{m.value}</div>
              <div className="text-xs font-semibold mt-1">{m.label}</div>
              <div className="text-xs text-slate-400">{m.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
