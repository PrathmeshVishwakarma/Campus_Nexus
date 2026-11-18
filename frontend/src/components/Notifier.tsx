import { useRef } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { useNexusEvents, type LiveEvent } from '../hooks/useNexusEvents'

/** Short two-tone beep via WebAudio (no asset needed). */
function beep(critical: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tones = critical ? [880, 660, 880] : [660]
    tones.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.18
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
      o.start(t); o.stop(t + 0.17)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch { /* audio blocked until user interaction */ }
}

function describe(e: LiveEvent): { title: string; body?: string; to?: string; critical?: boolean } | null {
  const d = e.data || {}
  const p = d.payload || {}
  switch (e.event) {
    case 'ALERT_CREATED':
      return { title: `${p.priority || 'Alert'}: ${p.title || ''}`, body: `from ${d.actor}`, to: '/alerts',
        critical: p.priority === 'CRITICAL' }
    case 'MESSAGE_SENT':
      return { title: `${d.actor}`, body: String(p.text || '').slice(0, 120), to: '/chat' }
    case 'FILE_COMMENT':
      return { title: `${d.actor} commented on ${d.resource}`, body: String(p.text || '').slice(0, 120),
        to: `/files/discussion?path=${encodeURIComponent(d.resource)}` }
    case 'VERSION_CONFLICT':
      return { title: `Edit conflict on ${d.resource}`, body: `${d.actor} saved v${p.version}`, to: '/files' }
    case 'ANOMALY_DETECTED':
      return { title: 'Sync paused: unusual file activity', body: p.reason, critical: true }
    default:
      return null
  }
}

/**
 * Raises toasts/sounds for live events. Whether an event notifies is decided
 * server-side from the user's notification preferences (frame.notify), and
 * frame.toast / frame.sound mirror their delivery choices.
 */
export function Notifier() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const seen = useRef(new Set<string>())
  useNexusEvents((e) => {
    if (!e.notify) return
    const id = e.data?.id
    if (id) {
      if (seen.current.has(id)) return
      seen.current.add(id)
      if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200))
    }
    const info = describe(e)
    if (!info) return
    if (e.sound !== false) beep(!!info.critical)
    if (e.toast !== false) {
      const opts = { description: info.body, duration: info.critical ? 15000 : 5000,
        action: info.to ? { label: 'Open', onClick: () => navigate(info.to!) } : undefined }
      info.critical ? toast.error(info.title, opts) : toast(info.title, opts)
    }
  }, token)
  return null
}
