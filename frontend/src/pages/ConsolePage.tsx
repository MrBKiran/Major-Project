import { useState } from 'react'
import { Mic, MicOff, CheckCircle } from 'lucide-react'

type DriveState = 'PARKED' | 'DRIVING' | 'STOPPED_BRIEF'

const CONVERSATION = [
  { role: 'ai', text: 'Ramesh ji, aapki Bolero ka coolant temperature pichhle 6 dinon se badh raha hai.' },
  { role: 'user', text: 'Car theek chal rahi hai.' },
  { role: 'ai', text: 'Is trend se water pump mein problem ho sakti hai. Breakdown se pehle check karwa lete hain.' },
  { role: 'user', text: 'Haan, book kar do.' },
  { role: 'ai', text: 'Bilkul. Slot hold kar liya hai. Parkng ke baad confirm card dikhega.' },
]

export default function ConsolePage() {
  const [driveState, setDriveState] = useState<DriveState>('DRIVING')
  const [convStep, setConvStep] = useState(0)
  const [listening, setListening] = useState(false)
  const [slotConfirmed, setSlotConfirmed] = useState(false)

  const nextLine = () => setConvStep(s => Math.min(s + 1, CONVERSATION.length - 1))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">In-Car Console</h1>
        <div className="flex gap-2">
          {(['PARKED', 'DRIVING', 'STOPPED_BRIEF'] as DriveState[]).map(s => (
            <button
              key={s}
              onClick={() => setDriveState(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                driveState === s ? 'bg-brand border-brand text-white' : 'border-slate-600 text-slate-400 hover:border-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Drive State Banner */}
      {driveState === 'DRIVING' && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 text-center">
          <div className="text-2xl mb-1">🚗</div>
          <div className="font-bold text-yellow-300">DRIVING MODE</div>
          <div className="text-sm text-yellow-400 mt-1">Touch booking controls locked. Voice only.</div>
        </div>
      )}

      {/* Voice Conversation */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Voice Conversation</h2>
          <button
            onClick={() => setListening(l => !l)}
            className={`p-2 rounded-full transition-colors ${listening ? 'bg-brand animate-pulse' : 'bg-[#0f3460] hover:bg-brand'}`}
          >
            {listening ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
        </div>

        <div className="space-y-3 min-h-[200px]">
          {CONVERSATION.slice(0, convStep + 1).map((line, i) => (
            <div key={i} className={`flex ${line.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                line.role === 'ai'
                  ? 'bg-[#0f3460] text-slate-200'
                  : 'bg-brand text-white'
              }`}>
                {line.role === 'ai' && <span className="text-xs text-slate-400 block mb-0.5">AutoSaarthi AI</span>}
                {line.text}
              </div>
            </div>
          ))}
        </div>

        {convStep < CONVERSATION.length - 1 && (
          <button
            onClick={nextLine}
            className="w-full bg-[#0f3460] hover:bg-brand text-white text-sm py-2 rounded-lg transition-colors"
          >
            ▶ Next Line (Demo)
          </button>
        )}
      </div>

      {/* Slot Confirmation – only shows when PARKED */}
      {driveState === 'PARKED' && convStep >= 3 && !slotConfirmed && (
        <div className="card border-green-700 bg-green-900/20">
          <h3 className="font-semibold text-green-300 mb-3">📅 Service Slot Available</h3>
          <div className="text-sm space-y-1">
            <div><span className="text-slate-400">Centre:</span> Mahindra Service – Koramangala</div>
            <div><span className="text-slate-400">Date:</span> Tomorrow, 10:00 AM</div>
            <div><span className="text-slate-400">Job:</span> Water Pump Inspection + Coolant Flush</div>
          </div>
          <button
            onClick={() => setSlotConfirmed(true)}
            className="mt-4 w-full bg-green-700 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            Confirm Booking
          </button>
        </div>
      )}

      {slotConfirmed && (
        <div className="card border-green-700 flex items-center gap-3">
          <CheckCircle className="text-green-400" size={24} />
          <div>
            <div className="font-semibold text-green-300">Booking Confirmed!</div>
            <div className="text-xs text-slate-400">Service reminder set for tomorrow 9:00 AM.</div>
          </div>
        </div>
      )}

      {driveState === 'DRIVING' && convStep >= 3 && (
        <div className="card border-yellow-700 bg-yellow-900/10 text-sm text-yellow-300">
          ⏸ Slot is held. Confirmation card will appear when you park.
        </div>
      )}
    </div>
  )
}
