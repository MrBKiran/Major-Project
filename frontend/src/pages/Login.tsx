import React, { useState } from 'react'
import { useAuth, USER_PERSONAS, UserRole } from '../lib/AuthContext'
import { 
  Shield, Wrench, Car, Factory, UserCheck, Sparkles, ArrowRight, 
  Lock, Mail, CheckCircle2, MessageSquare, Bot, AlertTriangle 
} from 'lucide-react'

export default function Login() {
  const { loginAs } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin')

  const roleMeta: Record<UserRole, { 
    title: string; 
    desc: string; 
    icon: any; 
    tagColor: string; 
    badgeBg: string;
    borderColor: string; 
    bgTint: string;
    highlights: string[]
  }> = {
    admin: {
      title: 'Platform Administrator',
      desc: 'Full platform orchestrator: live fleet telemetry, autonomous LangGraph agents, UEBA zero-trust defense & plant CAPA.',
      icon: Shield,
      tagColor: 'text-purple-800 border-purple-300 bg-purple-100',
      badgeBg: 'bg-purple-900 text-white',
      borderColor: 'hover:border-purple-500 hover:shadow-purple-500/10',
      bgTint: 'from-purple-50/40 via-white to-white',
      highlights: ['All 6 Platform Tabs', 'Agent Execution Guard', 'Fleet Root Control']
    },
    adviser: {
      title: 'Service Adviser',
      desc: 'Workshop manager: vehicle health diagnostics, automated proactive service bookings & parts supply coordination.',
      icon: Wrench,
      tagColor: 'text-emerald-800 border-emerald-300 bg-emerald-100',
      badgeBg: 'bg-emerald-900 text-white',
      borderColor: 'hover:border-emerald-500 hover:shadow-emerald-500/10',
      bgTint: 'from-emerald-50/40 via-white to-white',
      highlights: ['Authorized Service Bays', 'Slot Allocation', 'Customer Quotes']
    },
    customer: {
      title: 'Vehicle Owner / Driver',
      desc: 'In-car digital cockpit: Mahindra Bolero B6 HUD, Hindi/English voice assistant, diagnostic chatbot & booking.',
      icon: Car,
      tagColor: 'text-amber-800 border-amber-300 bg-amber-100',
      badgeBg: 'bg-amber-900 text-white',
      borderColor: 'hover:border-amber-500 hover:shadow-amber-500/10',
      bgTint: 'from-amber-50/40 via-white to-white',
      highlights: ['Bolero B6 (MH12AB1001)', 'AI Problem Chatbot', 'Drive / Park Safety']
    },
    quality: {
      title: 'Plant Quality Engineer',
      desc: 'Manufacturing specialist: 5-Why RCA root cause clustering, 6M Ishikawa fishbone matrix & automated CAPA recall actions.',
      icon: Factory,
      tagColor: 'text-fuchsia-800 border-fuchsia-300 bg-fuchsia-100',
      badgeBg: 'bg-fuchsia-900 text-white',
      borderColor: 'hover:border-fuchsia-500 hover:shadow-fuchsia-500/10',
      bgTint: 'from-fuchsia-50/40 via-white to-white',
      highlights: ['Plant Pune-01', 'Ishikawa Decomposition', 'Warranty Cost Forecast']
    },
    security: {
      title: 'UEBA Security Officer',
      desc: 'Zero-trust watchdog: adversarial red team attacks, agent privilege validation & cryptographic SHA-256 audit trail.',
      icon: UserCheck,
      tagColor: 'text-rose-800 border-rose-300 bg-rose-100',
      badgeBg: 'bg-rose-900 text-white',
      borderColor: 'hover:border-rose-500 hover:shadow-rose-500/10',
      bgTint: 'from-rose-50/40 via-white to-white',
      highlights: ['Red Team Attack Suite', 'Policy RBAC Gate', 'Cryptographic Audit']
    }
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loginAs(selectedRole)
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col justify-between selection:bg-slate-900 selection:text-white">
      {/* Top Banner Header */}
      <header className="border-b border-slate-200/90 bg-white/90 backdrop-blur-md px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-base shadow-md shadow-slate-900/10">
            AS
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg text-slate-900 tracking-tight">AutoSaarthi</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
                v1.0.0-agentic
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">Enterprise Agentic Connected Vehicle Platform</p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 font-medium">
          <Bot size={15} className="text-blue-600" />
          <span>New: AI Vehicle Problem Diagnostic Chatbot Active</span>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="max-w-6xl w-full mx-auto px-4 py-10 flex-1 flex flex-col justify-center">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-slate-100 text-xs font-semibold mb-3 shadow-xs">
            <Sparkles size={13} className="text-cyan-400" />
            <span>Select Persona or Sign In</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Sign In to <span className="bg-gradient-to-r from-blue-700 via-indigo-600 to-cyan-600 bg-clip-text text-transparent">AutoSaarthi</span>
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
            Choose a persona below for immediate 1-click access to specific automotive portals, or sign in with custom credentials.
          </p>
        </div>

        {/* 5 Quick-Select Persona Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          {(Object.keys(USER_PERSONAS) as UserRole[]).map((role) => {
            const persona = USER_PERSONAS[role]
            const meta = roleMeta[role]
            const Icon = meta.icon

            return (
              <div
                key={role}
                onClick={() => loginAs(role)}
                className={`bg-white border border-slate-200 rounded-2xl p-4.5 shadow-xs hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col justify-between group ${meta.borderColor} bg-gradient-to-b ${meta.bgTint}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                      <Icon size={20} className="text-white" />
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.tagColor}`}>
                      {role}
                    </span>
                  </div>

                  <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-blue-700 transition-colors">
                    {persona.name}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-600 mb-2">
                    {meta.title}
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">
                    {meta.desc}
                  </p>

                  {/* Feature Highlights */}
                  <div className="space-y-1 pt-2 border-t border-slate-100">
                    {meta.highlights.map((h, i) => (
                      <div key={i} className="text-[10px] text-slate-600 flex items-center gap-1 font-medium">
                        <span className="w-1 h-1 rounded-full bg-slate-400" />
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-800 group-hover:text-blue-700">
                  <span>Enter as {role}</span>
                  <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            )
          })}
        </div>

        {/* Manual Login Card */}
        <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Lock size={16} className="text-slate-700" />
              <h2 className="text-sm font-extrabold text-slate-900">Sign In with Credentials</h2>
            </div>
            <span className="text-[10px] font-mono text-slate-500">Secure OAuth2</span>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Target Persona Role</label>
              <select
                value={selectedRole}
                onChange={(e) => {
                  const r = e.target.value as UserRole
                  setSelectedRole(r)
                  setEmail(USER_PERSONAS[r].email)
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="admin">Administrator (Rajesh Sharma) - Full Access</option>
                <option value="adviser">Service Adviser (Sunita Rao) - Fleet & Appointments</option>
                <option value="customer">Customer / Driver (Ramesh Kumar) - Bolero Cockpit</option>
                <option value="quality">Quality Engineer (Vikram Mehta) - Plant RCA</option>
                <option value="security">Security Officer (Priya Desai) - UEBA Defense</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email || USER_PERSONAS[selectedRole].email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors shadow-xs"
            >
              <CheckCircle2 size={15} />
              <span>Launch AutoSaarthi Platform</span>
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/90 bg-white py-3 px-6 text-center text-xs text-slate-500">
        AutoSaarthi Connected Vehicle & Agentic Intelligence Platform &copy; 2026. Built with FastAPI, PyTorch, LangGraph & React.
      </footer>
    </div>
  )
}
