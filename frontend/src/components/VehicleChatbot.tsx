import React, { useState, useEffect, useRef } from 'react'
import { 
  Bot, MessageSquare, X, Send, Mic, MicOff, Volume2, VolumeX, 
  Sparkles, AlertTriangle, CheckCircle2, ChevronDown, Wrench, 
  Thermometer, Zap, ShieldAlert, ArrowRight, RefreshCw, Car, Info, IndianRupee
} from 'lucide-react'
import { askVehicleChatbot, fetchVehicles, fetchTelemetry } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { useNavigate } from 'react-router-dom'

interface Message {
  id: string
  sender: 'user' | 'bot'
  text: string
  time: string
  severity?: 'CRITICAL' | 'WARNING' | 'INFO' | 'NORMAL'
  checklist?: string[]
  recommended_action?: {
    label: string
    action_type: string
    target_path?: string
    payload?: any
  }
  telemetry_snapshot?: any
  repair_estimate?: any
}

export default function VehicleChatbot() {
  const { user } = useAuth()
  const navigate = useNavigate()
  
  const [isOpen, setIsOpen] = useState(false)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVin, setSelectedVin] = useState<string>('MH12AB1001')
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const [isListening, setIsListening] = useState(false)
  const [currentTelemetry, setCurrentTelemetry] = useState<any>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Sync selected VIN with user assigned vehicle
  useEffect(() => {
    if (user?.assignedVin) {
      setSelectedVin(user.assignedVin)
    }
  }, [user])

  // Fetch vehicles list on mount
  useEffect(() => {
    fetchVehicles().then(setVehicles).catch(() => {})
  }, [])

  // Poll live telemetry for selected vehicle
  useEffect(() => {
    let mounted = true
    const update = () => {
      fetchTelemetry(selectedVin).then(t => {
        if (mounted) setCurrentTelemetry(t)
      }).catch(() => {})
    }
    update()
    const interval = setInterval(update, 5000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [selectedVin])

  const activeVehicle = vehicles.find(v => v.vin === selectedVin) || {
    model: 'Bolero',
    variant: 'B6',
    customer: { name: user?.name || 'Ramesh Kumar' }
  }

  // Initial welcome message for selected vehicle
  useEffect(() => {
    if (messages.length === 0 && selectedVin) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const custName = activeVehicle.customer?.name || 'Driver'
      const welcome: Message = {
        id: 'welcome',
        sender: 'bot',
        text: `Namaste ${custName}! I am your dedicated **AutoSaarthi Automotive Co-Pilot** for vehicle **${activeVehicle.model} ${activeVehicle.variant}** (${selectedVin}).\n\nI am monitoring your live CAN sensors, failure risk forecast, and active DTCs in real-time. How can I assist you with your vehicle right now?`,
        time,
        severity: 'INFO',
        checklist: [
          'Live CAN bus sensor feed connected',
          'Component wear & failure predictor online',
          'Express workshop service slot held'
        ]
      }
      setMessages([welcome])
    }
  }, [selectedVin, activeVehicle.model])

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  // Speech synthesis
  const speakText = (text: string) => {
    if (!ttsEnabled || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const plain = text.replace(/[*_#`🚨⚠️🔍✅•]/g, '').slice(0, 260)
    const u = new SpeechSynthesisUtterance(plain)
    u.lang = 'en-IN'
    u.rate = 1.0
    window.speechSynthesis.speak(u)
  }

  // Voice recognition
  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window)) {
      sendMessage(`Why is the coolant temperature on my ${activeVehicle.model} high?`)
      return
    }
    const rec = new (window as any).webkitSpeechRecognition()
    rec.lang = 'hi-IN'
    rec.interimResults = false
    setIsListening(true)
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInputValue(transcript)
      sendMessage(transcript)
    }
    rec.onend = () => setIsListening(false)
    rec.onerror = () => setIsListening(false)
    rec.start()
  }

  const sendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputValue).trim()
    if (!query || loading) return

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      time
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setLoading(true)

    try {
      const res = await askVehicleChatbot(selectedVin, query)
      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: res.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        severity: res.severity,
        checklist: res.checklist,
        recommended_action: res.recommended_action,
        telemetry_snapshot: res.telemetry_snapshot,
        repair_estimate: res.repair_estimate
      }
      setMessages(prev => [...prev, botMsg])
      speakText(res.reply)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const handleActionClick = (action: any) => {
    if (action.target_path) {
      navigate(action.target_path)
      setIsOpen(false)
    }
  }

  const isCritical = currentTelemetry?.coolant_temp > 98 || currentTelemetry?.battery_voltage < 11.9

  const quickPrompts = [
    { label: '🔥 Coolant Rising', text: `Why is the coolant temperature on my ${activeVehicle.model} rising?` },
    { label: '⚡ Battery Potential', text: `Is my battery voltage safe to start my ${activeVehicle.model}?` },
    { label: '⚠️ Explain DTC P0217', text: 'Explain Diagnostic Trouble Code P0217 and required repairs.' },
    { label: '🚗 300 km Highway Trip', text: `Is my ${activeVehicle.model} safe for a 300 km highway journey?` },
    { label: '🔧 Water Pump Cost', text: `How much does water pump replacement cost on my ${activeVehicle.model}?` }
  ]

  return (
    <>
      {/* Floating Circular Launcher Button */}
      <div className="fixed bottom-6 right-6 z-40">
        {!isOpen && (
          <button
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-2.5 px-4 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-2xl transition-all duration-200 hover:scale-105 border border-slate-700/80"
          >
            <div className="relative">
              <Bot size={20} className="text-cyan-400" />
              {isCritical && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              )}
            </div>
            <span className="text-xs font-black tracking-tight">AI Vehicle Assistant</span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Live
            </span>
          </button>
        )}
      </div>

      {/* Expandable Chatbot Dialog */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[430px] max-w-[92vw] h-[600px] max-h-[85vh] bg-white border border-slate-200/90 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          {/* Header Bar */}
          <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 shadow-sm">
                <Bot size={18} />
              </div>
              <div>
                <div className="font-extrabold text-xs tracking-tight flex items-center gap-2">
                  <span>AutoSaarthi AI Co-Pilot</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <span>Vehicle:</span>
                  <select
                    value={selectedVin}
                    onChange={(e) => {
                      setSelectedVin(e.target.value)
                      setMessages([])
                    }}
                    className="bg-slate-800 text-cyan-300 font-bold border border-slate-700 rounded px-1.5 py-0.2 text-[10px] focus:outline-none cursor-pointer"
                  >
                    {vehicles.map(v => (
                      <option key={v.vin} value={v.vin} className="bg-slate-900 text-white">
                        {v.vin} — {v.model} ({v.customer?.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTtsEnabled(prev => !prev)}
                title={ttsEnabled ? 'Mute Audio Readout' : 'Enable Audio Readout'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {ttsEnabled ? <Volume2 size={15} className="text-cyan-400" /> : <VolumeX size={15} />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Live Sensor Mini-Ticker */}
          {currentTelemetry && (
            <div className="bg-slate-50 border-b border-slate-200/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-600 font-mono">
              <span className="flex items-center gap-1">
                <Thermometer size={12} className={currentTelemetry.coolant_temp > 98 ? 'text-rose-600 font-bold' : 'text-cyan-600'} />
                <span>{currentTelemetry.coolant_temp?.toFixed(1)}°C</span>
              </span>
              <span className="flex items-center gap-1">
                <Zap size={12} className={currentTelemetry.battery_voltage < 11.9 ? 'text-amber-600' : 'text-emerald-600'} />
                <span>{currentTelemetry.battery_voltage?.toFixed(1)}V</span>
              </span>
              <span className="flex items-center gap-1">
                <Car size={12} className="text-slate-500" />
                <span>{Math.round(currentTelemetry.speed || 0)} km/h</span>
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                currentTelemetry.coolant_temp > 98
                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              }`}>
                {currentTelemetry.coolant_temp > 98 ? 'Critical Alert' : 'Nominal'}
              </span>
            </div>
          )}

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#f8fafc]">
            {messages.map((m) => {
              const isBot = m.sender === 'bot'
              return (
                <div key={m.id} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[88%] rounded-2xl p-3.5 text-xs shadow-xs leading-relaxed ${
                    isBot 
                      ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-xs' 
                      : 'bg-slate-900 text-white rounded-tr-xs shadow-sm'
                  }`}>
                    {/* Header line for bot */}
                    {isBot && (
                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-100 text-[10px]">
                        <span className="font-bold text-slate-900 flex items-center gap-1">
                          <Bot size={12} className="text-blue-600" />
                          <span>AutoSaarthi AI Co-Pilot</span>
                        </span>
                        <div className="flex items-center gap-1">
                          {m.severity && m.severity !== 'NORMAL' && (
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono ${
                              m.severity === 'CRITICAL'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : m.severity === 'WARNING'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}>
                              {m.severity}
                            </span>
                          )}
                          <button
                            onClick={() => speakText(m.text)}
                            title="Listen"
                            className="p-1 hover:text-blue-600 text-slate-400"
                          >
                            <Volume2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Main text formatted */}
                    <div className="whitespace-pre-wrap font-sans text-xs">
                      {m.text}
                    </div>

                    {/* Actionable Checklist */}
                    {m.checklist && m.checklist.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Recommended Steps:
                        </span>
                        {m.checklist.map((step, idx) => (
                          <div key={idx} className="text-[11px] text-slate-700 flex items-start gap-1.5 leading-snug">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1 flex-shrink-0" />
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Repair & Warranty Estimate */}
                    {m.repair_estimate && (
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-500">Repair Estimate</div>
                          <div className="font-bold text-slate-900 mt-0.5">{m.repair_estimate.component}</div>
                          <div className="text-[10px] text-emerald-700 font-medium">{m.repair_estimate.warranty_status}</div>
                        </div>
                        {m.repair_estimate.estimated_cost_inr !== undefined && (
                          <div className="text-right">
                            <span className="font-mono font-bold text-slate-900 flex items-center gap-0.5 justify-end">
                              <IndianRupee size={12} /> {m.repair_estimate.estimated_cost_inr}
                            </span>
                            <div className="text-[10px] text-slate-500">{m.repair_estimate.labor_time}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recommended Action Button */}
                    {m.recommended_action && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100">
                        <button
                          onClick={() => handleActionClick(m.recommended_action)}
                          className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                        >
                          <Wrench size={13} />
                          <span>{m.recommended_action.label}</span>
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    )}

                    {/* Time */}
                    <div className={`text-[9px] mt-1 text-right font-mono ${isBot ? 'text-slate-400' : 'text-slate-300'}`}>
                      {m.time}
                    </div>
                  </div>
                </div>
              )
            })}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-xs p-3 shadow-xs flex items-center gap-2 text-xs text-slate-600">
                  <RefreshCw size={14} className="animate-spin text-blue-600" />
                  <span>Analyzing CAN telemetry & diagnostic models...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompt Carousel */}
          <div className="bg-white px-3 py-2 border-t border-slate-100 overflow-x-auto flex gap-1.5 no-scrollbar">
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(qp.text)}
                disabled={loading}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] border border-slate-200 transition-colors flex-shrink-0 disabled:opacity-50"
              >
                {qp.label}
              </button>
            ))}
          </div>

          {/* Input Controls Bar */}
          <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
            <button
              onClick={handleVoiceInput}
              disabled={loading}
              title="Speak query (English / Hindi)"
              className={`p-2.5 rounded-xl transition-all shadow-xs flex-shrink-0 ${
                isListening
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={`Ask about ${activeVehicle.model} overheating, DTCs, battery...`}
              className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />

            <button
              onClick={() => sendMessage()}
              disabled={!inputValue.trim() || loading}
              className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white transition-colors shadow-xs flex-shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
