import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents, type LiveEvent } from '../hooks/useNexusEvents'
import { systemNotify } from '../lib/push'

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
      return { title: `${p.priority || 'Alert'}: ${p.title || ''}`, body: `from ${d.actor} — open Alerts to acknowledge`, to: '/alerts',
        critical: p.priority === 'CRITICAL' }
    case 'MESSAGE_SENT':
      return { title: `${d.actor}`, body: String(p.text || '').slice(0, 120), to: '/chat' }
    case 'FILE_COMMENT':
      return { title: `${d.actor} commented on ${d.resource}`, body: String(p.text || '').slice(0, 120),
        to: `/files?file=${encodeURIComponent(d.resource)}&tab=discussion` }
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
  // events suppressed only by do-not-disturb, summarised when it ends
  const held = useRef<{ kind: string }[]>([])

  useNexusEvents((e) => {
    const id = e.data?.id
    if (id) {
      if (seen.current.has(id)) return
      seen.current.add(id)
      if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200))
    }
    if (e.held) { held.current.push({ kind: e.event }); return }
    if (!e.notify) return
    const info = describe(e)
    if (!info) return
    if (e.sound !== false) beep(!!info.critical)
    if (e.event === 'ALERT_CREATED') {
      try { navigator.vibrate?.(info.critical ? [200, 100, 200, 100, 200] : [200]) } catch { /* unsupported */ }
      // tab in the background: also raise a system notification
      if (document.hidden) systemNotify(info.title, info.body || '', id || 'alert', info.to || '/alerts')
    }
    if (e.toast !== false) {
      const opts = { description: info.body, duration: info.critical ? 15000 : 5000,
        action: info.to ? { label: 'Open', onClick: () => navigate(info.to!) } : undefined }
      info.critical ? toast.error(info.title, opts) : toast(info.title, opts)
    }
  }, token)

  // When do-not-disturb ends, show one quiet summary of what was held back.
  useEffect(() => {
    if (!token) return
    const t = setInterval(async () => {
      if (!held.current.length) return
      try {
        const d = await api('/api/notifications/dnd')
        if (d.active) return
      } catch { return }
      const items = held.current.splice(0)
      const n = (k: string) => items.filter(i => i.kind === k).length
      const parts = [
        n('MESSAGE_SENT') && `${n('MESSAGE_SENT')} message${n('MESSAGE_SENT') === 1 ? '' : 's'}`,
        n('ALERT_CREATED') && `${n('ALERT_CREATED')} alert${n('ALERT_CREATED') === 1 ? '' : 's'}`,
        n('FILE_COMMENT') && `${n('FILE_COMMENT')} file comment${n('FILE_COMMENT') === 1 ? '' : 's'}`,
      ].filter(Boolean)
      toast('While you were in Do Not Disturb', { description: parts.join(' · ') || `${items.length} update(s)`,
        duration: 10000, action: { label: n('ALERT_CREATED') ? 'Alerts' : 'Chat', onClick: () => navigate(n('ALERT_CREATED') ? '/alerts' : '/chat') } })
    }, 60_000)
    return () => clearInterval(t)
  }, [token, navigate])

  return null
}
