import { useState, useEffect } from 'react'
import { fetchSlots, bookAppointment, fetchVehicles } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { 
  Calendar, CheckCircle, Clock, MapPin, Wrench, Sparkles, 
  Car, ShieldCheck, CheckCircle2, ChevronRight, User
} from 'lucide-react'

export default function Appointments() {
  const { user } = useAuth()
  const [slots, setSlots] = useState<any[]>([])
  const [booked, setBooked] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVin, setSelectedVin] = useState(user?.assignedVin || 'MH12AB1001')
  const [bookingLoading, setBookingLoading] = useState<string | null>(null)

  useEffect(() => { 
    fetchSlots().then(setSlots).catch(() => {})
    fetchVehicles().then(setVehicles).catch(() => {})
  }, [])

  async function book(slot_id: string) {
    setBookingLoading(slot_id)
    try {
      const appt = await bookAppointment({ 
        vin: selectedVin, 
        slot_id, 
        notes: 'Priority Coolant System & Water Pump Inspection (AutoSaarthi Proactive)' 
      })
      setBooked(prev => [appt, ...prev])
    } catch (e) {
      console.error(e)
    }
    setBookingLoading(null)
  }

  const selectedVehicleObj = vehicles.find(v => v.vin === selectedVin)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
              <Calendar className="text-emerald-700" size={26} /> Proactive Service Booking Hub
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-semibold">
              Authorized Service Centres
            </span>
          </div>
          <p className="text-slate-600 text-xs sm:text-sm mt-1">
            Automated workshop slot reservation · Priority parts allocation · Zero customer wait time
          </p>
        </div>

        {/* Target Vehicle Selector */}
        <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs shadow-xs">
          <Car size={15} className="text-blue-600" />
          <span className="text-slate-500 font-medium">Target Vehicle:</span>
          <select
            value={selectedVin}
            onChange={e => setSelectedVin(e.target.value)}
            className="bg-transparent text-slate-900 font-mono font-bold focus:outline-none"
          >
            {vehicles.map(v => (
              <option key={v.vin} value={v.vin} className="bg-white text-slate-900">
                {v.vin} ({v.model})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Target Vehicle Banner */}
      {selectedVehicleObj && (
        <div className="card-emerald p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800">
              <Wrench size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 text-sm">
                  {selectedVehicleObj.model} {selectedVehicleObj.variant}
                </span>
                <span className="font-mono text-xs text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded font-bold border border-emerald-200">
                  {selectedVehicleObj.vin}
                </span>
              </div>
              <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-2 font-medium">
                <span>Driver: {selectedVehicleObj.customer?.name}</span>
                <span>·</span>
                <span>Batch: {selectedVehicleObj.batch_id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="badge-good text-xs">
              <ShieldCheck size={13} /> Warranty Covered Service
            </span>
          </div>
        </div>
      )}

      {/* Available Slots Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={14} className="text-emerald-700" /> Available Service Windows ({slots.length})
          </span>
          <span className="text-xs text-slate-500 font-medium">Live Service Centre Capacity</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {slots.map((s, idx) => (
            <div
              key={s.slot_id}
              className="card bg-white border border-slate-200 hover:border-emerald-400 p-5 rounded-2xl flex flex-col justify-between gap-4 shadow-xs group transition-all"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                    {s.slot_id}
                  </span>
                  <span className="badge-good text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                    OPEN
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition-colors">
                  {s.center}
                </h3>

                <div className="space-y-1.5 mt-3 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <Calendar size={13} className="text-slate-400" />
                    <span className="font-semibold text-slate-800">{s.date}</span>
                    <span className="text-slate-400">·</span>
                    <Clock size={13} className="text-slate-400" />
                    <span className="font-semibold text-slate-800">{s.time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-slate-400" />
                    <span>Station Bay #{idx + 2} · Express Diagnostics</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => book(s.slot_id)}
                disabled={bookingLoading === s.slot_id}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {bookingLoading === s.slot_id ? (
                  <span>Reserving Slot...</span>
                ) : (
                  <>
                    <CheckCircle size={14} />
                    <span>Reserve Priority Service</span>
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Booked Appointments Stream */}
      {booked.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-200">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-700" /> Confirmed Service Bookings ({booked.length})
          </span>

          <div className="space-y-2">
            {booked.map((b, idx) => (
              <div
                key={idx}
                className="card bg-white border border-slate-200 p-4 rounded-xl flex items-center justify-between shadow-2xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    ✓
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">
                      Appointment Confirmed for VIN: {b.vin || selectedVin}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Status: <strong className="text-emerald-700">CONFIRMED</strong> · Slot: {b.slot_id} · Notes: {b.notes || 'Routine check'}
                    </div>
                  </div>
                </div>

                <span className="badge-good text-xs">
                  Active in CRM
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
