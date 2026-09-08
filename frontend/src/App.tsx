import React, { useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { 
  Car, Activity, Brain, Shield, Factory, Calendar, Radio, Sparkles, 
  LogOut, ChevronDown, Check, User, AlertCircle, Bot
} from 'lucide-react'
import { AuthProvider, useAuth, USER_PERSONAS, UserRole } from './lib/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import VehicleConsole from './pages/VehicleConsole'
import AgentView from './pages/AgentView'
import UEBAConsole from './pages/UEBAConsole'
import PlantDashboard from './pages/PlantDashboard'
import Appointments from './pages/Appointments'
import VehicleChatbot from './components/VehicleChatbot'

const navItems = [
  { 
    to: '/', 
    icon: Activity, 
    label: 'Fleet Telemetry', 
    shortLabel: 'Fleet',
    badge: 'Live',
    badgeColor: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    iconColor: 'text-cyan-600'
  },
  { 
    to: '/console', 
    icon: Car, 
    label: 'In-Car Cockpit', 
    shortLabel: 'In-Car',
    badge: 'Voice',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
    iconColor: 'text-amber-600'
  },
  { 
    to: '/agents', 
    icon: Brain, 
    label: 'Agent Graph', 
    shortLabel: 'Agents',
    badge: 'LangGraph',
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-300',
    iconColor: 'text-purple-600'
  },
  { 
    to: '/ueba', 
    icon: Shield, 
    label: 'UEBA Defense', 
    shortLabel: 'UEBA',
    badge: 'Zero-Trust',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
    iconColor: 'text-rose-600'
  },
  { 
    to: '/plant', 
    icon: Factory, 
    label: 'Plant RCA', 
    shortLabel: 'Plant',
    badge: 'CAPA',
    badgeColor: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
    iconColor: 'text-fuchsia-600'
  },
  { 
    to: '/appointments', 
    icon: Calendar, 
    label: 'Service Hub', 
    shortLabel: 'Service',
    badge: 'Bookings',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    iconColor: 'text-emerald-600'
  },
]

function AppShell() {
  const { user, logout, loginAs, canAccess } = useAuth()
  const location = useLocation()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  if (!user || location.pathname === '/login') {
    return <Login />
  }

  // Filter navigation tabs based on active user's permissions
  const visibleNav = navItems.filter(item => canAccess(item.to))

  // If user navigated to a restricted route, show a clean Access Denied card
  const isCurrentPathAllowed = canAccess(location.pathname)

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] text-slate-900 overflow-hidden relative">
      {/* Top Main Brand Header */}
      <header className="h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between z-30 shadow-xs">
        {/* Left: Brand & Tagline */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-sm shadow-md shadow-slate-900/10 tracking-wider">
            AS
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg text-slate-900 tracking-tight">AutoSaarthi</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
                v1.0.0-agentic
              </span>
            </div>
            <p className="hidden sm:block text-[11px] text-slate-500 font-medium">
              Autonomous Vehicle Telemetry, Diagnostics & UEBA Shield
            </p>
          </div>
        </div>

        {/* Right: Live Telemetry Status & Persona Switcher */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <Radio size={13} className="text-cyan-600 animate-pulse" />
            <span className="text-slate-500">Fleet Stream:</span>
            <span className="font-mono text-slate-900 font-bold">10 Nodes Active</span>
          </div>

          {/* User Persona Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 transition-all text-left"
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${user.avatarColor}`}>
                {user.name.charAt(0)}
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-bold text-slate-900 leading-tight">{user.name}</div>
                <div className="text-[10px] font-semibold text-slate-500">{user.roleLabel}</div>
              </div>
              <ChevronDown size={14} className="text-slate-500" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in zoom-in duration-100">
                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Switch Persona / Role</span>
                  <span className="text-[10px] font-mono text-blue-600 font-semibold">1-Click</span>
                </div>

                <div className="py-1">
                  {(Object.keys(USER_PERSONAS) as UserRole[]).map((role) => {
                    const p = USER_PERSONAS[role]
                    const isSelected = p.role === user.role
                    return (
                      <button
                        key={role}
                        onClick={() => {
                          loginAs(role)
                          setDropdownOpen(false)
                        }}
                        className={`w-full px-4 py-2.5 flex items-center justify-between text-left text-xs transition-colors ${
                          isSelected ? 'bg-slate-100 text-slate-900 font-bold' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${p.avatarColor}`}>
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{p.name}</div>
                            <div className="text-[10px] text-slate-500">{p.roleLabel}</div>
                          </div>
                        </div>
                        {isSelected && <Check size={14} className="text-blue-600" />}
                      </button>
                    )
                  })}
                </div>

                <div className="border-t border-slate-100 px-2 pt-2 mt-1">
                  <button
                    onClick={() => {
                      setDropdownOpen(false)
                      logout()
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <LogOut size={14} />
                    <span>Sign Out to Login Screen</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Switch User / Login Screen Button */}
          <button
            onClick={logout}
            title="Switch User / Sign Out"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors shadow-2xs"
          >
            <User size={14} className="text-slate-500" />
            <span className="hidden sm:inline">Switch User</span>
          </button>
        </div>
      </header>

      {/* HORIZONTALLY ARRANGED TABS BAR */}
      <nav className="bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between overflow-x-auto shadow-xs select-none">
        <div className="flex items-center gap-1 sm:gap-2 py-1">
          {visibleNav.map(({ to, icon: Icon, label, shortLabel, badge, badgeColor, iconColor }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `group flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-150 border whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} className={isActive ? 'text-white' : iconColor} />
                  <span>{label}</span>
                  <span
                    className={`hidden md:inline-block text-[10px] font-bold px-1.5 py-0.2 rounded-full border transition-all ${
                      isActive 
                        ? 'bg-slate-800 text-slate-200 border-slate-700' 
                        : `${badgeColor}`
                    }`}
                  >
                    {badge}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Current Active Role Badge on Far Right of Tab Bar */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 py-2">
          <span>Active Role:</span>
          <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 font-mono text-[11px]">
            {user.role.toUpperCase()}
          </span>
        </div>
      </nav>

      {/* Dynamic Route Content Area */}
      <main className="flex-1 overflow-auto bg-[#f8fafc]">
        {!isCurrentPathAllowed ? (
          <div className="p-8 max-w-md mx-auto mt-16 text-center bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle size={26} />
            </div>
            <h2 className="text-lg font-black text-slate-900">Access Restricted</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your persona (<strong>{user.roleLabel}</strong>) does not have authorization to view this module.
            </p>
            <div className="pt-2">
              <button
                onClick={() => loginAs('admin')}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs shadow-sm hover:bg-slate-800 transition-colors"
              >
                Switch to Admin Persona
              </button>
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/console" element={<VehicleConsole />} />
            <Route path="/agents" element={<AgentView />} />
            <Route path="/ueba" element={<UEBAConsole />} />
            <Route path="/plant" element={<PlantDashboard />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      {/* Persistent AI Vehicle Problem Diagnostic Chatbot Widget */}
      <VehicleChatbot />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
