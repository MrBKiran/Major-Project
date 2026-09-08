import axios from 'axios'
const BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'http://localhost:8000'
export const api = axios.create({ baseURL: BASE })
export const fetchVehicles = () => api.get('/api/vehicles/').then(r => r.data)
export const fetchVehicle = (vin: string) => api.get(`/api/vehicles/${vin}`).then(r => r.data)
export const fetchTelemetry = (vin: string) => api.get(`/api/telemetry/${vin}/latest`).then(r => r.data)
export const fetchPrediction = (vin: string) => api.get(`/api/predictions/${vin}`).then(r => r.data)
export const fetchSlots = () => api.get('/api/appointments/slots').then(r => r.data)
export const bookAppointment = (data: object) => api.post('/api/appointments/book', data).then(r => r.data)
export const runAgent = (vin: string) => api.post('/api/agents/run', { vin }).then(r => r.data)
export const fetchRuns = () => api.get('/api/agents/runs').then(r => r.data)
export const fetchAuditLog = () => api.get('/api/ueba/audit').then(r => r.data)
export const redTeamTest = (agent: string, tool: string) => api.post('/api/ueba/redteam', { agent, tool }).then(r => r.data)
export const runRCA = () => api.post('/api/rca/run').then(r => r.data)
export const fetchCapa = () => api.get('/api/rca/capa').then(r => r.data)
export const askVehicleChatbot = (vin: string, message: string, language?: string) => 
  api.post('/api/chat/ask', { vin, message, language: language || 'en' }).then(r => r.data)
export const fetchCommonIssues = () => api.get('/api/chat/common-issues').then(r => r.data)
