import React, { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type AlertItem = {
  id: string; title: string; body: string; priority: string; sender: string;
  created_at: string; acked: number; total: number; acked_by_me: boolean; score?: number;
}
type Receipt = { user: string; delivered_at: string; acked_at: string | null; latency_ms: number }
type UserItem = { username: string; email: string; role: string }

const PRIORITIES = ['ALL', 'CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'] as const
type PriorityFilter = typeof PRIORITIES[number]

const dot: Record<string, string> = {
  CRITICAL: 'var(--error)', URGENT: 'var(--warning)', IMPORTANT: 'var(--accent)',
  NORMAL: 'var(--muted)', INFO: 'var(--muted)',
}

const tabColor: Record<string, string> = {
  CRITICAL: 'rgba(239,68,68,0.15)', URGENT: 'rgba(245,158,11,0.15)',
  IMPORTANT: 'rgba(139,92,246,0.15)', NORMAL: 'rgba(136,146,176,0.1)', INFO: 'rgba(136,146,176,0.1)',
}

export default function Alerts() {
  const { token, user } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [form, setForm] = useState({ title: '', body: '', priority: 'URGENT' })
  const [filter, setFilter] = useState<PriorityFilter>('ALL')
  const [ranked, setRanked] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, Receipt[]>>({})
  const [openReceipts, setOpenReceipts] = useState<Record<string, boolean>>({})
  const [users, setUsers] = useState<UserItem[]>([])
  const [targets, setTargets] = useState<string[]>([])

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const load = async (silent = false) => {
    try {
      const res = filter !== 'ALL'
        ? await api(`/api/alerts?priority=${filter}`, auth)
        : await api('/api/alerts', auth)
      setAlerts(res)
      setRanked(false)
    } catch (e: any) { if (!silent) toast.error(e.message) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { load() }, [filter])
  useEffect(() => {
    api('/api/auth/users', auth).then(setUsers).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Live refresh: alert broadcasts/acks reload the list + open receipts.
  const loadRef = useRef(load)
  loadRef.current = load
  const receiptsRef = useRef(receipts)
  receiptsRef.current = receipts
  const openRef = useRef(openReceipts)
  openRef.current = openReceipts

  useEffect(() => {
    if (!token) return
    let alive = true
    let ws: WebSocket | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let reloadTimer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(async () => {
        loadRef.current(true)
        for (const id of Object.keys(openRef.current)) {
          if (!openRef.current[id]) continue
          try {
            const rows = await api(`/api/alerts/${id}/receipts`, auth)
            setReceipts(r => ({ ...r, [id]: rows }))
          } catch { /* keep old */ }
        }
      }, 250)
    }

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const connect = () => {
      if (!alive) return
      try {
        ws = new WebSocket(`${scheme}://${location.host}/ws/events?token=${token}`)
      } catch { scheduleRetry(); return }
      ws.onopen = () => { retry = 0 }
      ws.onmessage = (m) => {
        if (!alive) return
        try {
          const e = JSON.parse(m.data)
          if (e.event === 'ALERT_CREATED' || e.event === 'ALERT_ACKNOWLEDGED') refresh()
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
    connect()
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ action: 'PING' })) } catch {}
      }
    }, 25000)
    const poll = setInterval(() => { if (alive && !document.hidden) refresh() }, 10000)
    return () => {
      alive = false
      clearInterval(poll)
      if (pingTimer) clearInterval(pingTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (reloadTimer) clearTimeout(reloadTimer)
      try { ws?.close() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const create = async () => {
    if (!form.title.trim()) return toast.error('Title required')
    try {
      await api('/api/alerts', {
        ...auth, method: 'POST',
        body: JSON.stringify({ ...form, target_scope: targets.length ? 'selected' : 'all', target_users: targets }),
      })
      setForm({ title: '', body: '', priority: 'URGENT' })
      setTargets([])
      toast.success(targets.length
        ? `Alert sent to ${targets.length} user${targets.length === 1 ? '' : 's'}`
        : 'Alert broadcast to everyone')
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const loadRanked = async () => {
    try {
      setAlerts(await api('/api/alerts/ranked', auth))
      setRanked(true)
    } catch (e: any) { toast.error(e.message) }
  }

  const ack = async (id: string) => {
    try {
      const res = await api(`/api/alerts/${id}/ack`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(`Acknowledged (${res.latency_ms} ms)`)
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const showReceipts = async (id: string) => {
    const willOpen = !openReceipts[id]
    setOpenReceipts(o => ({ ...o, [id]: willOpen }))
    if (!willOpen) return
    try {
      const rows = await api(`/api/alerts/${id}/receipts`, auth)
      setReceipts(r => ({ ...r, [id]: rows }))
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 grid md:grid-cols-2 gap-4 items-start">
      <Card>
        <h2 className="text-lg font-bold flex items-center gap-2 mb-1"><Bell size={17} className="text-[var(--accent)]" /> Raise an alert</h2>
        <p className="text-xs text-[var(--muted)] mb-3">Broadcasts to every node. Delivery receipts are created per user; ask them to ACK.</p>
        <div className="space-y-2">
          <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. Fire drill, Building B)" aria-label="Alert title" />
          <textarea
            value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
            placeholder="Body… (e.g. Evacuate via stairwell C)" rows={3}
            className="w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-sm text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)] resize-none"
            aria-label="Alert body"
          />
          {/* Priority selector buttons (reused in form) */}
          <div className="flex flex-wrap gap-1.5">
            {(['CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'] as const).map(p => (
              <button
                key={p}
                onClick={() => setForm({ ...form, priority: p })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${form.priority === p ? 'border-[var(--accent)] bg-[rgba(139,92,246,0.2)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
              >
                {p}
              </button>
            ))}
          </div>
          {/* Target picker: no selection = everyone */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--muted)]">Send to</span>
              <span className="text-[11px] text-[var(--muted)]">
                {targets.length ? `${targets.length} selected` : 'everyone'}
              </span>
            </div>
            <div className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] p-1.5 space-y-0.5">
              {users.filter(u => u.username !== user).map(u => (
                <label key={u.username} className="flex items-center gap-2 text-sm rounded-md px-2 py-1 hover:bg-[var(--card-hover)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targets.includes(u.username)}
                    onChange={() => setTargets(t => t.includes(u.username) ? t.filter(x => x !== u.username) : [...t, u.username])}
                  />
                  {u.username}
                  <span className="text-[11px] text-[var(--muted)]">{u.role}</span>
                </label>
              ))}
              {users.length === 0 && <p className="text-xs text-[var(--muted)] px-2 py-1">No other users yet — alert goes to everyone.</p>}
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">Leave empty to alert all users.</p>
          </div>
          <Button onClick={create} className="w-full">
            {targets.length ? `Send ${form.priority} alert to ${targets.length}` : `Broadcast ${form.priority} alert`}
          </Button>
        </div>
      </Card>

      <Card>
        {/* Priority tab bar */}
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all border ${
                filter === p
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[rgba(139,92,246,0.15)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
              style={filter === p && p !== 'ALL' ? { background: tabColor[p] } : {}}
            >
              {p}
            </button>
          ))}
          <Button variant="secondary" onClick={loadRanked} className="ml-auto text-xs">Smart rank</Button>
          <Button variant="secondary" onClick={() => load()} className="text-xs">↺</Button>
        </div>
        {ranked && <p className="text-xs text-[var(--muted)] mb-2">Sorted by smart rank (priority × sender affinity × recency).</p>}

        <div className="space-y-2 max-h-[560px] overflow-auto">
          {alerts.map(a => (
            <div key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex items-start gap-2">
                {/* Priority dot — CRITICAL pulses */}
                <span
                  className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${a.priority === 'CRITICAL' ? 'animate-pulse' : ''}`}
                  style={{ background: dot[a.priority] ?? 'var(--muted)',
                    boxShadow: a.priority === 'CRITICAL' ? '0 0 6px var(--error)' : undefined }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{a.title}</div>
                  <div className="text-xs text-[var(--muted)]">{a.body}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-1">
                    <span
                      className="font-semibold mr-1 px-1.5 py-0.5 rounded"
                      style={{ background: tabColor[a.priority] ?? 'transparent', color: dot[a.priority] }}
                    >{a.priority}</span>
                    by {a.sender} · {new Date(a.created_at).toLocaleString()} · {a.acked}/{a.total} acked
                    {typeof a.score === 'number' && <span> · score {a.score}</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {a.sender === user
                  ? <span className="text-xs text-emerald-400 self-center">✓ You raised this</span>
                  : a.acked_by_me
                    ? <span className="text-xs text-emerald-400 self-center">✓ You acknowledged</span>
                    : <Button onClick={() => ack(a.id)}><span className="flex items-center gap-1.5 text-xs"><CheckCheck size={13} /> Acknowledge</span></Button>}
                <Button variant="secondary" onClick={() => showReceipts(a.id)}>
                  <span className="flex items-center gap-1.5 text-xs">
                    <ChevronDown size={13} className={`transition-transform ${openReceipts[a.id] ? 'rotate-180' : ''}`} />
                    Who got it?
                  </span>
                </Button>
              </div>
              {openReceipts[a.id] && receipts[a.id] && (
                <div className="mt-2 rounded-lg bg-[var(--card-hover)] p-2 text-[11px] space-y-1">
                  {receipts[a.id].map(r => (
                    <div key={r.user} className="flex gap-2 flex-wrap">
                      <span className="font-medium">{r.user}</span>
                      <span className="text-[var(--muted)]">delivered {new Date(r.delivered_at).toLocaleTimeString()}</span>
                      {r.acked_at
                        ? <span className="text-emerald-400">acked ({r.latency_ms} ms)</span>
                        : <span className="text-amber-400">pending</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {alerts.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-8">No alerts yet. Raise one on the left — it appears here with live ACK counts.</p>
          )}
        </div>
      </Card>
    </div>
  )
}
