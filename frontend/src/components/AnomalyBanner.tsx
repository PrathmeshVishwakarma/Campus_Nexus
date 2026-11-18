import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents } from '../hooks/useNexusEvents'

export default function AnomalyBanner() {
  const { token, role } = useAuth()
  const [paused, setPaused] = useState(false)
  const check = () => api('/api/ml/anomalies').then(d => setPaused(d.scheduler_paused)).catch(() => {})
  useEffect(() => { check(); const t = setInterval(check, 15000); return () => clearInterval(t) }, [])
  useNexusEvents((e) => {
    if (e.event === 'ANOMALY_DETECTED') setPaused(true)
    if (e.event === 'SYNC_RESUMED') setPaused(false)
  }, token)
  if (!paused) return null
  const resume = async () => {
    try {
      await api('/api/sync/resume-scheduler', { method: 'POST' })
      toast.success('Sync resumed'); setPaused(false)
    } catch (e: any) { toast.error(e.message) }
  }
  return <div className="rounded-2xl border-2 border-rose-500 bg-rose-600/30 p-4 flex items-center gap-3 shadow-lg shadow-rose-900/40">
    <ShieldAlert className="text-rose-200" size={22} />
    <div className="text-sm"><b className="text-rose-200">Anomaly detected — sync paused, versions preserved.</b>
      <div className="text-rose-300/80 text-xs">Possible mass modify/delete. Uploads are on hold until an admin reviews the timeline and resumes.</div></div>
    {role === 'admin'
      ? <button onClick={resume} className="ml-auto px-4 py-2 rounded-xl bg-emerald-600 font-semibold text-sm">Review & Resume</button>
      : <span className="ml-auto text-xs text-rose-200">Waiting for an admin</span>}
  </div>
}
