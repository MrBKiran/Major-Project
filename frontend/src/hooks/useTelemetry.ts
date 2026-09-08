import { useState, useEffect, useRef } from 'react'
export interface TelemetryData {
  vin: string; timestamp: string; speed: number; rpm: number;
  coolant_temp: number; oil_pressure: number; battery_voltage: number;
  fuel_level: number; engine_load: number; dtc: string[];
}
export function useTelemetry() {
  const [data, setData] = useState<Record<string, TelemetryData>>({})
  const ws = useRef<WebSocket | null>(null)
  useEffect(() => {
    const url = 'ws://localhost:8000/ws/telemetry'
    ws.current = new WebSocket(url)
    ws.current.onmessage = (e) => {
      try { const t: TelemetryData = JSON.parse(e.data); setData(prev => ({ ...prev, [t.vin]: t })) } catch {}
    }
    return () => ws.current?.close()
  }, [])
  return data
}
