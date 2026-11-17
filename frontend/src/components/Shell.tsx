import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Activity, Bell, FolderOpen, LogOut, MessageSquare, Moon, Network, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'

const links = [
  { to: '/', label: 'Dashboard', icon: Activity, end: true },
  { to: '/files', label: 'Files', icon: FolderOpen, end: false },
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: false },
  { to: '/alerts', label: 'Alerts', icon: Bell, end: false },
  { to: '/network', label: 'Network', icon: Network, end: false },
]

const BADGE_COLOR: Record<string, string> = {
  CRITICAL: 'var(--error)',
  URGENT: 'var(--warning)',
  IMPORTANT: 'var(--accent)',
  NORMAL: 'var(--muted)',
  INFO: 'var(--muted)',
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [light, setLight] = React.useState(() => localStorage.getItem('nexus_theme') === 'light')
  const [unacked, setUnacked] = React.useState<{ count: number; priority: string | null }>({ count: 0, priority: null })
  const audioRef = React.useRef<AudioContext | null>(null)

  // Acknowledged count badge: refresh on load, on alert events (WS) and on a
  // slow poll so it stays correct even if the socket drops on mobile.
  React.useEffect(() => {
    if (!token) { setUnacked({ count: 0, priority: null }); return }
    let alive = true
    let ws: WebSocket | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    const headers = { headers: { Authorization: `Bearer ${token}` } }

    const refresh = async () => {
      try {
        const r = await api('/api/alerts/unacked/count', headers)
        if (alive) setUnacked({ count: r.count ?? 0, priority: r.priority ?? null })
      } catch { /* keep last value */ }
    }

    // Popup when someone else raises an alert for this user. Uses a service
    // worker where available (required on Android Chrome), then falls back to
    // the page Notification API; always also shows an in-app toast.
    const notifyAlert = async (data: any) => {
      const p = data?.payload || {}
      if (data?.actor && data.actor === user) return
      if (p.scope === 'selected' && Array.isArray(p.targets) && !p.targets.includes(user)) return
      const title = `${p.priority || 'ALERT'}: ${p.title || 'New alert'}`
      const body = `${data?.actor || 'Someone'} raised an alert — open Alerts to acknowledge.`
      const openAlerts = () => {
        try { window.focus() } catch {}
        navigate('/alerts')
      }

      try { navigator.vibrate?.([200, 100, 200]) } catch { /* unsupported */ }
      // short beep (audio context is unlocked on the first pointer gesture)
      try {
        const ctx = audioRef.current
        if (ctx && ctx.state === 'running') {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.0001, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
          osc.connect(gain).connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + 0.36)
        }
      } catch { /* audio blocked */ }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        let shown = false
        if ('serviceWorker' in navigator) {
          try {
            const reg = await navigator.serviceWorker.getRegistration()
            if (reg) {
              await reg.showNotification(title, {
                body, tag: data?.resource || data?.id,
                data: { url: '/alerts' },
              })
              shown = true
            }
          } catch { /* fall back */ }
        }
        if (!shown) {
          try {
            const n = new Notification(title, { body, tag: data?.resource || data?.id })
            n.onclick = openAlerts
          } catch { /* mobile browsers reject the constructor */ }
        }
      }
      toast(title, { description: body, action: { label: 'Open', onClick: openAlerts } })
    }

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const connect = () => {
      if (!alive) return
      try {
        ws = new WebSocket(`${scheme}://${location.host}/ws/events?token=${token}`)
      } catch { scheduleRetry(); return }
      ws.onopen = () => { retry = 0; refresh() }
      ws.onmessage = (m) => {
        if (!alive) return
        try {
          const e = JSON.parse(m.data)
          if (e.event === 'ALERT_CREATED') { refresh(); notifyAlert(e.data) }
          else if (e.event === 'ALERT_ACKNOWLEDGED') refresh()
        } catch { /* ignore */ }
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
      ws.onclose = () => { scheduleRetry() }
    }
    const scheduleRetry = () => {
      if (!alive) return
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      retry = Math.min(retry + 1, 5)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { if (alive) connect() }, Math.min(1000 * 2 ** retry, 10000))
    }

    refresh()
    connect()
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ action: 'PING' })) } catch {}
      }
    }, 25000)
    const poll = setInterval(() => { if (!document.hidden) refresh() }, 30000)

    return () => {
      alive = false
      clearInterval(poll)
      if (pingTimer) clearInterval(pingTimer)
      if (retryTimer) clearTimeout(retryTimer)
      try { ws?.close() } catch {}
    }
  }, [token, user, navigate])

  // Subscribe this browser for real Web Push so alerts arrive even when the
  // site is closed (requires HTTPS + notification permission).
  const subscribePush = React.useCallback(async () => {
    if (!token) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const reg = await navigator.serviceWorker.ready
      const { key } = await api('/api/push/public-key')
      if (!key) return
      const padded = (key + '='.repeat((4 - (key.length % 4)) % 4))
        .replace(/-/g, '+').replace(/_/g, '/')
      const raw = atob(padded)
      const appKey = Uint8Array.from(raw, (c) => c.charCodeAt(0))
      let sub = await reg.pushManager.getSubscription()
      // Drop a subscription made with an older VAPID key (e.g. new server key).
      const current = sub?.options?.applicationServerKey
      if (sub && current) {
        const bytes = new Uint8Array(current)
        const same = bytes.length === appKey.length && bytes.every((v, i) => v === appKey[i])
        if (!same) {
          try { await sub.unsubscribe() } catch {}
          sub = null
        }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
      }
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
    } catch { /* unsupported or insecure context */ }
  }, [token])

  React.useEffect(() => { subscribePush() }, [subscribePush])

  // Service worker + first-gesture setup: register the worker (needed for
  // mobile system notifications), unlock audio for the alert beep, and ask for
  // notification permission (browsers require a user gesture).
  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* insecure context (plain http on LAN) */ })
    }
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        if (Ctx && !audioRef.current) audioRef.current = new Ctx()
        audioRef.current?.resume()
      } catch { /* audio unsupported */ }
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          Notification.requestPermission().then((p) => { if (p === 'granted') subscribePush() })
        } catch { /* ignore */ }
      }
    }
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [subscribePush])

  // Show the unacknowledged count in the tab title too (useful on mobile).
  React.useEffect(() => {
    document.title = unacked.count > 0 ? `(${unacked.count}) Campus Nexus` : 'Campus Nexus'
  }, [unacked.count])

  // Apply theme class to <html> whenever state changes
  React.useEffect(() => {
    const html = document.documentElement
    if (light) {
      html.classList.add('light')
      html.classList.remove('dark')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
    localStorage.setItem('nexus_theme', light ? 'light' : 'dark')
  }, [light])

  const doLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] antialiased">
      {token && (
        <nav className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)] backdrop-blur-lg">
          <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-14 overflow-x-auto">
            <span className="font-extrabold tracking-tight mr-3 whitespace-nowrap">
              Campus Nexus
            </span>
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[rgba(139,92,246,0.2)] text-[var(--accent)] font-medium'
                      : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)]'
                  }`
                }
              >
                <l.icon size={15} />
                {l.label}
                {l.to === '/alerts' && unacked.count > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                    style={{ background: BADGE_COLOR[unacked.priority || ''] || 'var(--muted)' }}
                    title={`${unacked.count} unacknowledged alert${unacked.count === 1 ? '' : 's'}`}
                  >
                    {unacked.count > 99 ? '99+' : unacked.count}
                  </span>
                )}
              </NavLink>
            ))}
            <span className="ml-auto text-xs text-[var(--muted)] whitespace-nowrap hidden sm:block">
              {user}
            </span>
            {/* Global dark/light toggle */}
            <button
              onClick={() => setLight(v => !v)}
              className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)] transition-colors"
              aria-label="Toggle theme"
              title={light ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {light ? <Moon size={15} /> : <Sun size={15} className="text-[var(--accent)]" />}
            </button>
            <button
              onClick={doLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)] transition-colors whitespace-nowrap"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </nav>
      )}
      {children}
    </div>
  )
}
