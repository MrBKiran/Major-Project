import { useState, useEffect, useRef } from 'react'
import { useTelemetry } from '../hooks/useTelemetry'
import { fetchPrediction, bookAppointment, fetchSlots, askVehicleChatbot, fetchVehicles } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { 
  Mic, MicOff, Volume2, VolumeX, Car, AlertTriangle, ShieldCheck, Gauge, 
  Thermometer, Zap, Fuel, Sparkles, CheckCircle2, Lock, Radio, Activity,
  Send, Bot, Wrench, ArrowRight, IndianRupee, RefreshCw
} from 'lucide-react'

interface Message {
  id: string
  role: 'driver' | 'ai'
  text: string
  time: string
  severity?: 'CRITICAL' | 'WARNING' | 'INFO' | 'NORMAL'
  checklist?: string[]
  recommended_action?: any
  repair_estimate?: any
}

const HERO_VIN = 'MH12AB1001'

export default function VehicleConsole() {
  const { user } = useAuth()
  const telemetry = useTelemetry()
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVin, setSelectedVin] = useState<string>(user?.assignedVin || HERO_VIN)
  const [driveState, setDriveState] = useState<'DRIVING' | 'PARKED'>('DRIVING')
  const [prediction, setPrediction] = useState<any>(null)
  const [conversation, setConversation] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [slots, setSlots] = useState<any[]>([])
  const [booked, setBooked] = useState(false)
  
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const activeVin = selectedVin
  const telem = telemetry[activeVin]

  // Fetch fleet vehicles & slots
  useEffect(() => {
    fetchVehicles().then(setVehicles).catch(() => {})
    fetchSlots().then(setSlots).catch(() => {})
  }, [])

  // Fetch prediction whenever active VIN changes
  useEffect(() => {
    fetchPrediction(activeVin).then(setPrediction).catch(() => {})
  }, [activeVin])

  // Active vehicle metadata
  const currentVehicle = vehicles.find(v => v.vin === activeVin) || {
    vin: activeVin,
    model: 'Bolero',
    variant: 'B6',
    customer: { name: user?.name || 'Ramesh Kumar', language: 'hi' }
  }

  // Initial welcome and proactive alert based on live telemetry & ML models
  useEffect(() => {
    if (prediction && conversation.length === 0) {
      const prob = prediction?.failure?.failure_probability || 0.90
      const custName = currentVehicle.customer?.name || 'Driver'
      const isHindi = (currentVehicle.customer?.language === 'hi') || (user?.role === 'customer')

      const initialText = isHindi
        ? `Namaste ${custName} ji! Aapke ${currentVehicle.model} ${currentVehicle.variant} ka engine coolant temperature ${(telem?.coolant_temp || 96.5).toFixed(1)}°C tak badh gaya hai. Hamare AI diagnostic model ke mutabik water pump mein ${(prob*100).toFixed(0)}% failure risk hai. Kya main nazdiki service center mein slot reserve karoon?`
        : `Hello ${custName}, your ${currentVehicle.model} ${currentVehicle.variant} engine coolant is reading ${(telem?.coolant_temp || 96.5).toFixed(1)}°C with an estimated ${(prob*100).toFixed(0)}% water pump failure risk. Would you like me to hold a priority service slot?`

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const firstMsg: Message = {
        id: 'initial-alert',
        role: 'ai',
        text: initialText,
        time,
        severity: (telem?.coolant_temp || 96.5) > 98 ? 'CRITICAL' : 'WARNING',
        checklist: [
          'Pull over safely if temperature climbs above 100°C',
          'Turn AC OFF and run cabin heater on MAX',
          'Let engine idle 90 seconds before shutting off ignition'
        ],
        recommended_action: {
          label: 'Reserve Priority Service Slot',
          action_type: 'BOOK_APPOINTMENT'
        }
      }

      setConversation([firstMsg])
      speak(initialText)
    }
  }, [prediction, activeVin])

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, loading])

  // Natural text-to-speech
  function speak(text: string) {
    if (!ttsEnabled || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const plain = text.replace(/[*_#`🚨⚠️🔍✅•]/g, '').slice(0, 260)
    const u = new SpeechSynthesisUtterance(plain)
    u.lang = 'en-IN'
    u.rate = 0.98
    u.onstart = () => setIsSpeaking(true)
    u.onend = () => setIsSpeaking(false)
    synthRef.current = u
    window.speechSynthesis.speak(u)
  }

  // Voice speech-to-text
  function handleVoiceInput() {
    if (!('webkitSpeechRecognition' in window)) {
      handleUserSubmit('Why is my coolant temperature rising and is it safe to drive?')
      return
    }
    const rec = new (window as any).webkitSpeechRecognition()
    rec.lang = 'hi-IN'
    rec.interimResults = false
    setIsListening(true)
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript
      handleUserSubmit(text)
    }
    rec.onend = () => setIsListening(false)
    rec.onerror = () => {
      setIsListening(false)
      handleUserSubmit('Haan, priority service slot hold kar do')
    }
    rec.start()
  }

  // Handle message sending to realistic Chatbot backend
  async function handleUserSubmit(overrideText?: string) {
    const query = (overrideText || inputValue).trim()
    if (!query || loading) return

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const driverMsg: Message = {
      id: `driver-${Date.now()}`,
      role: 'driver',
      text: query,
      time
    }

    setConversation(prev => [...prev, driverMsg])
    setInputValue('')
    setLoading(true)

    try {
      // Direct call to realistic backend diagnostic engine
      const res = await askVehicleChatbot(activeVin, query)
      
      // Auto-book if user confirmed booking
      const lower = query.toLowerCase()
      if (lower.includes('book') || lower.includes('haan') || lower.includes('yes') || lower.includes('kar do') || lower.includes('hold')) {
        if (driveState === 'PARKED') {
          bookAppointment({ vin: activeVin, slot_id: 'SLOT-001' }).then(() => setBooked(true)).catch(() => {})
        }
      }

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: res.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        severity: res.severity,
        checklist: res.checklist,
        recommended_action: res.recommended_action,
        repair_estimate: res.repair_estimate
      }

      setConversation(prev => [...prev, aiMsg])
      speak(res.reply)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const speed = telem ? Math.round(telem.speed) : 62
  const rpm = telem ? Math.round(telem.rpm) : 2350
  const coolant = telem ? telem.coolant_temp : 96.8
  const battery = telem ? telem.battery_voltage : 12.3

  // Quick vehicle-specific prompts
  const quickPrompts = [
    { label: '🔥 Coolant Temperature', text: `Why is the coolant temperature on my ${currentVehicle.model} rising?` },
    { label: '⚡ Battery Check', text: `Is my battery voltage at ${battery.toFixed(1)}V safe to start?` },
    { label: '⚠️ Explain DTC P0217', text: 'Explain DTC P0217 and required emergency repair actions.' },
    { label: '🔧 Repair Estimate', text: `How much does water pump replacement cost for my ${currentVehicle.model}?` },
    { label: '📅 Confirm Slot', text: 'Haan, service slot confirm kar do.' },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Cockpit Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <Car className="text-blue-700" size={24} /> In-Car Digital Cockpit
            </h1>
            
            {/* Vehicle Selector for Multi-Vehicle Diagnostic */}
            <select
              value={selectedVin}
              onChange={(e) => {
                setSelectedVin(e.target.value)
                setConversation([])
                setBooked(false)
              }}
              className="bg-amber-100 border border-amber-300 text-amber-900 rounded-lg px-2 py-0.5 text-xs font-mono font-bold focus:outline-none cursor-pointer"
            >
              {vehicles.map(v => (
                <option key={v.vin} value={v.vin}>
                  {v.vin} — {v.model} ({v.customer?.name})
                </option>
              ))}
            </select>
          </div>
          <p className="text-slate-600 text-xs mt-1">
            {currentVehicle.model} {currentVehicle.variant} · Driver: {currentVehicle.customer?.name} ({currentVehicle.customer?.phone})
          </p>
        </div>

        {/* Drive Mode Selector Switch */}
        <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 shadow-xs">
          <button
            onClick={() => setDriveState('DRIVING')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
              driveState === 'DRIVING'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Lock size={13} />
            <span>DRIVING MODE</span>
          </button>
          <button
            onClick={() => setDriveState('PARKED')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
              driveState === 'PARKED'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck size={13} />
            <span>PARKED MODE</span>
          </button>
        </div>
      </div>

      {/* Driver Safety Banner */}
      {driveState === 'DRIVING' ? (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex items-center gap-3 text-amber-900 text-xs shadow-xs">
          <div className="w-8 h-8 rounded-xl bg-amber-200 flex items-center justify-center flex-shrink-0 text-amber-800">
            <AlertTriangle size={18} className="animate-pulse" />
          </div>
          <div className="flex-1">
            <span className="font-bold uppercase tracking-wider text-amber-900">Driver Voice Protocol Active:</span>
            <span className="text-slate-700 ml-1.5">
              Vehicle is in motion ({speed} km/h). Speak to the AI Assistant or use quick chips below. Touch-typing is restricted for safety.
            </span>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center gap-3 text-emerald-900 text-xs shadow-xs">
          <div className="w-8 h-8 rounded-xl bg-emerald-200 flex items-center justify-center flex-shrink-0 text-emerald-800">
            <ShieldCheck size={18} />
          </div>
          <div className="flex-1">
            <span className="font-bold uppercase tracking-wider text-emerald-900">Vehicle Stationary (PARKED):</span>
            <span className="text-slate-700 ml-1.5">
              Full interactive diagnostics unlocked. You can confirm repair bookings, review mechanical checklists, and type queries.
            </span>
          </div>
        </div>
      )}

      {/* Futuristic Instrument Cluster / Gauges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Speedometer Gauge in Cyan */}
        <div className="card-cyan p-4 rounded-2xl text-center relative overflow-hidden group shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs text-cyan-800 font-bold mb-1">
            <Gauge size={15} />
            <span>VEHICLE SPEED</span>
          </div>
          <div className="my-2">
            <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-slate-900 group-hover:text-blue-700 transition-colors">
              {speed}
            </span>
            <span className="text-xs text-cyan-800 font-bold ml-1.5">KM/H</span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full" style={{ width: `${Math.min((speed / 140) * 100, 100)}%` }} />
          </div>
        </div>

        {/* Tachometer in Purple */}
        <div className="card-purple p-4 rounded-2xl text-center relative overflow-hidden group shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs text-purple-800 font-bold mb-1">
            <Activity size={15} />
            <span>ENGINE TACHOMETER</span>
          </div>
          <div className="my-2">
            <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-slate-900 group-hover:text-purple-800 transition-colors">
              {rpm}
            </span>
            <span className="text-xs text-purple-800 font-bold ml-1.5">RPM</span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" style={{ width: `${Math.min((rpm / 4000) * 100, 100)}%` }} />
          </div>
        </div>

        {/* Coolant Gauge in Amber/Red */}
        <div className={`p-4 rounded-2xl text-center relative overflow-hidden transition-all shadow-xs ${coolant > 98 ? 'card-rose animate-pulse' : 'card-amber'}`}>
          <div className="flex items-center justify-center gap-1.5 text-xs text-amber-800 font-bold mb-1">
            <Thermometer size={15} />
            <span>COOLANT TEMP</span>
          </div>
          <div className="my-2">
            <span className={`text-4xl sm:text-5xl font-black font-mono tracking-tight ${coolant > 98 ? 'text-rose-600' : 'text-slate-900'}`}>
              {coolant.toFixed(1)}
            </span>
            <span className="text-xs text-amber-800 font-bold ml-1.5">°C</span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full" style={{ width: `${Math.min((coolant / 120) * 100, 100)}%` }} />
          </div>
        </div>

        {/* Battery & Diagnostics in Emerald */}
        <div className="card-emerald p-4 rounded-2xl text-center relative overflow-hidden group shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-800 font-bold mb-1">
            <Zap size={15} />
            <span>BATTERY VOLTAGE</span>
          </div>
          <div className="my-2">
            <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-slate-900 group-hover:text-emerald-800 transition-colors">
              {battery.toFixed(1)}
            </span>
            <span className="text-xs text-emerald-800 font-bold ml-1.5">V</span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full" style={{ width: `${Math.min(((battery - 10) / 4) * 100, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* REALISTIC IN-CAR AI DIAGNOSTIC CHATBOT & VOICE ASSISTANT CENTER */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl p-5 shadow-2xl space-y-4">
        {/* Cockpit Header with Animated Equalizer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-sm">
              <Bot size={20} />
            </div>
            <div>
              <div className="font-black text-sm text-white flex items-center gap-2">
                <span>AutoSaarthi AI Diagnostic Co-Pilot</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono">Bilingual (Hindi / English)</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Connected to {currentVehicle.model} {currentVehicle.variant} ({activeVin}) · Driver: <strong className="text-slate-200">{currentVehicle.customer?.name}</strong>
              </div>
            </div>
          </div>

          {/* Equalizer Visualizer & Sound Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 h-7 px-3 bg-slate-950 rounded-xl border border-slate-800">
              <span className={`w-1 bg-cyan-400 rounded-full ${isSpeaking || isListening ? 'animate-eq-1' : 'h-1.5'}`} />
              <span className={`w-1 bg-purple-400 rounded-full ${isSpeaking || isListening ? 'animate-eq-2' : 'h-2'}`} />
              <span className={`w-1 bg-pink-400 rounded-full ${isSpeaking || isListening ? 'animate-eq-3' : 'h-3'}`} />
              <span className={`w-1 bg-amber-400 rounded-full ${isSpeaking || isListening ? 'animate-eq-4' : 'h-1.5'}`} />
              <span className={`w-1 bg-emerald-400 rounded-full ${isSpeaking || isListening ? 'animate-eq-5' : 'h-2'}`} />
              <span className="text-[10px] text-slate-400 font-mono ml-2">
                {isSpeaking ? 'AI Voice Speaking...' : isListening ? 'Listening to Driver...' : 'Voice Ready'}
              </span>
            </div>

            <button
              onClick={() => setTtsEnabled(prev => !prev)}
              title={ttsEnabled ? 'Mute Audio' : 'Enable Audio'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              {ttsEnabled ? <Volume2 size={16} className="text-cyan-400" /> : <VolumeX size={16} />}
            </button>
          </div>
        </div>

        {/* Live Conversation Stream */}
        <div className="space-y-3.5 min-h-[220px] max-h-[360px] overflow-y-auto pr-1">
          {conversation.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-xl p-4 rounded-2xl text-xs leading-relaxed shadow-md ${
                  m.role === 'ai'
                    ? 'bg-slate-800 border border-slate-700 text-slate-100 rounded-tl-sm'
                    : 'bg-emerald-900/90 border border-emerald-600/50 text-emerald-100 rounded-tr-sm'
                }`}
              >
                {/* Message Header */}
                <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400 mb-2 border-b border-slate-700/60 pb-1.5">
                  <span className="font-bold flex items-center gap-1.5">
                    {m.role === 'ai' ? (
                      <>
                        <Bot size={13} className="text-purple-400" />
                        <span className="text-purple-300">AutoSaarthi Automotive Co-Pilot</span>
                      </>
                    ) : (
                      <>
                        <Car size={13} className="text-emerald-300" />
                        <span className="text-emerald-300">Driver ({currentVehicle.customer?.name})</span>
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {m.severity && m.severity !== 'NORMAL' && (
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono ${
                        m.severity === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : m.severity === 'WARNING'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      }`}>
                        {m.severity}
                      </span>
                    )}
                    <span className="font-mono text-slate-500">{m.time}</span>
                    {m.role === 'ai' && (
                      <button
                        onClick={() => speak(m.text)}
                        title="Replay Audio"
                        className="hover:text-cyan-300 text-slate-400"
                      >
                        <Volume2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Body Text */}
                <div className="whitespace-pre-wrap font-sans text-xs sm:text-[13px] leading-relaxed">
                  {m.text}
                </div>

                {/* Mechanical Checklist */}
                {m.checklist && m.checklist.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-700/60 space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Step-by-Step Safety Procedure:
                    </div>
                    {m.checklist.map((step, idx) => (
                      <div key={idx} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1 flex-shrink-0" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Repair & Cost Estimate Card */}
                {m.repair_estimate && (
                  <div className="mt-3 p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Estimated Repair Impact</div>
                      <div className="font-bold text-amber-400 mt-0.5">{m.repair_estimate.component}</div>
                      <div className="text-[10px] text-slate-400">{m.repair_estimate.warranty_status}</div>
                    </div>
                    {m.repair_estimate.estimated_cost_inr !== undefined && (
                      <div className="text-right">
                        <span className="font-mono font-bold text-emerald-400 flex items-center gap-0.5 justify-end">
                          <IndianRupee size={12} /> {m.repair_estimate.estimated_cost_inr}
                        </span>
                        <div className="text-[10px] text-slate-500">{m.repair_estimate.labor_time}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* 1-Click Action Button */}
                {m.recommended_action && !booked && (
                  <div className="mt-3 pt-2">
                    <button
                      onClick={() => {
                        bookAppointment({ vin: activeVin, slot_id: 'SLOT-001' }).then(() => setBooked(true)).catch(() => {})
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 transition-all"
                    >
                      <Wrench size={14} />
                      <span>{m.recommended_action.label}</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-3 flex items-center gap-2 text-xs text-slate-300">
                <RefreshCw size={14} className="animate-spin text-cyan-400" />
                <span>Interrogating {currentVehicle.model} CAN telemetry & predictive models...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Driver Question Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Quick Prompts:</span>
          {quickPrompts.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleUserSubmit(chip.text)}
              disabled={loading}
              className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-700 transition-colors disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Voice & Text Input Controls */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleVoiceInput}
            disabled={loading}
            title="Speak query (Hindi / English)"
            className={`p-3 rounded-2xl transition-all shadow-md flex-shrink-0 ${
              isListening
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-white hover:bg-slate-100 text-slate-900'
            }`}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleUserSubmit()
              }
            }}
            disabled={driveState === 'DRIVING'}
            placeholder={
              driveState === 'DRIVING'
                ? 'Driving Mode: Use microphone above or click quick prompts...'
                : 'Ask about overheating, battery drain, oil pressure, weird noises...'
            }
            className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
          />

          <button
            onClick={() => handleUserSubmit()}
            disabled={!inputValue.trim() || loading || driveState === 'DRIVING'}
            className="p-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold transition-all shadow-md shadow-cyan-500/20 flex-shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* Slot Confirmation Card — Only in PARKED */}
      {driveState === 'PARKED' && !booked && slots.length > 0 && (
        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
              <Sparkles size={14} /> Service Centre Priority Slot Held
            </span>
            <span className="badge-good text-[10px]">SLOT-001</span>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center">
            <div>
              <div className="font-bold text-slate-900 text-sm">{slots[0].center}</div>
              <div className="text-xs text-slate-500 mt-0.5">Date: {slots[0].date} at {slots[0].time}</div>
            </div>
            <div className="text-right">
              <span className="text-xs text-emerald-700 font-bold">Water Pump Check</span>
              <div className="text-[10px] text-slate-500">Free Inspection</div>
            </div>
          </div>

          <button
            onClick={() => {
              bookAppointment({ vin: activeVin, slot_id: slots[0].slot_id }).then(() => setBooked(true))
            }}
            className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-md transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={16} /> Confirm Appointment Booking
          </button>
        </div>
      )}

      {/* Booking Success Banner */}
      {booked && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-center font-bold text-sm shadow-xs flex items-center justify-center gap-2">
          <CheckCircle2 size={20} className="text-emerald-700" />
          <span>Service appointment confirmed for {currentVehicle.model} ({activeVin})! Technician notified.</span>
        </div>
      )}
    </div>
  )
}
