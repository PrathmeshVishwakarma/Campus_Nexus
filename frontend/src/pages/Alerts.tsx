import React, { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents } from '../hooks/useNexusEvents'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type AlertItem = {
  id: string; title: string; body: string; priority: string; sender: string;
  created_at: string; acked: number; total: number; acked_by_me: boolean; score?: number; target_scope?: string; method?: string; below_threshold?: boolean;
}
type Receipt = { user: string; delivered_at: string; acked_at: string | null; latency_ms: number | null }

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
  const { token, role, user } = useAuth()
  // CRITICAL / URGENT are reserved for staff, faculty and admins (enforced server-side)
  const canHigh = ['admin', 'faculty', 'staff'].includes(role)
  const allowed = (['CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'] as const)
    .filter(p => canHigh || (p !== 'CRITICAL' && p !== 'URGENT'))
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [form, setForm] = useState({ title: '', body: '', priority: 'IMPORTANT' })
  const [scopeKind, setScopeKind] = useState<'all' | 'role' | 'users'>('all')
  const [scopeRoles, setScopeRoles] = useState<string[]>([])
  const [scopeUsers, setScopeUsers] = useState<string[]>([])
  const [users, setUsers] = useState<{ username: string }[]>([])
  useEffect(() => { api('/api/auth/users').then(setUsers).catch(() => {}) }, [])
  const [filter, setFilter] = useState<PriorityFilter>('ALL')
  const [ranked, setRanked] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, Receipt[]>>({})
  const [openReceipts, setOpenReceipts] = useState<Record<string, boolean>>({})

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  // reloads keep the current view (filtered list or smart rank)
  const load = async (silent = false, rankedView = ranked) => {
    try {
      const res = rankedView
        ? await api('/api/alerts/ranked', auth)
        : filter !== 'ALL' ? await api(`/api/alerts?priority=${filter}`, auth) : await api('/api/alerts', auth)
      setAlerts(res)
    } catch (e: any) { if (!silent) toast.error(e.message) }
  }

  useEffect(() => { setRanked(false); load(false, false) }, [filter])

  // Live: new alerts and ACKs (from anyone) update the list and open receipts.
  const loadRef = useRef(load); loadRef.current = load
  const openRef = useRef(openReceipts); openRef.current = openReceipts
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { connected } = useNexusEvents((e) => {
    if (e.event !== 'ALERT_CREATED' && e.event !== 'ALERT_ACKNOWLEDGED') return
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      loadRef.current(true)
      Object.keys(openRef.current).filter(id => openRef.current[id]).forEach(id => fetchReceipts(id))
    }, 250)
  }, token)
  useEffect(() => { if (connected) loadRef.current(true) }, [connected])   // catch up after reconnect

  const create = async () => {
    if (!form.title.trim()) return toast.error('Title required')
    let target_scope = 'all'
    if (scopeKind === 'role') {
      if (!scopeRoles.length) return toast.error('Pick at least one role')
      target_scope = `role:${scopeRoles.join(',')}`
    } else if (scopeKind === 'users') {
      if (!scopeUsers.length) return toast.error('Pick at least one person')
      target_scope = `users:${scopeUsers.join(',')}`
    }
    try {
      await api('/api/alerts', { ...auth, method: 'POST', body: JSON.stringify({ ...form, target_scope }) })
      setForm({ title: '', body: '', priority: 'IMPORTANT' })
      toast.success(target_scope === 'all' ? 'Alert broadcast to everyone' : `Alert sent to ${target_scope}`)
      setScopeUsers([]); setScopeRoles([]); setScopeKind('all')
    } catch (e: any) { toast.error(e.message) }
  }

  const loadRanked = async () => {
    try {
      setRanked(true)
      setAlerts(await api('/api/alerts/ranked', auth))
    } catch (e: any) { toast.error(e.message) }
  }

  const ack = async (id: string) => {
    try {
      const res = await api(`/api/alerts/${id}/ack`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(`Acknowledged (${res.latency_ms} ms)`)
      setAlerts(list => list.map(a => a.id === id ? { ...a, acked_by_me: true, acked: a.acked + 1 } : a))
    } catch (e: any) { toast.error(e.message) }
  }

  const fetchReceipts = async (id: string) => {
    try {
      const rows = await api(`/api/alerts/${id}/receipts`, auth)
      setReceipts(r => ({ ...r, [id]: rows }))
    } catch (e: any) { toast.error(e.message) }
  }
  const showReceipts = (id: string) => {
    const willOpen = !openReceipts[id]
    setOpenReceipts(o => ({ ...o, [id]: willOpen }))
    if (willOpen) fetchReceipts(id)
  }

  // Initials avatar for a username
  function Avatar({ name, acked }: { name: string; acked: boolean }) {
    const initials = name.slice(0, 2).toUpperCase()
    return (
      <span
        title={`${name}${acked ? ' ✓ acked' : ' — pending'}`}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border-2"
        style={{
          background: acked ? 'rgba(16,185,129,0.2)' : 'rgba(136,146,176,0.15)',
          borderColor: acked ? 'var(--success)' : 'var(--border)',
          color: acked ? 'var(--success)' : 'var(--muted)',
        }}
      >
        {initials}
      </span>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 grid md:grid-cols-2 gap-4 items-start">
      <Card>
        <h2 className="text-lg font-bold flex items-center gap-2 mb-1"><Bell size={17} className="text-[var(--accent)]" /> Raise an alert</h2>
        <p className="text-xs text-[var(--muted)] mb-3">Send to everyone, some roles or named people. Each recipient gets a delivery receipt to ACK.</p>
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
            {allowed.map(p => (
              <button
                key={p}
                onClick={() => setForm({ ...form, priority: p })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${form.priority === p ? 'border-[var(--accent)] bg-[rgba(139,92,246,0.2)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs items-center">
            <span className="text-[var(--muted)]">Send to</span>
            {(['all', 'role', 'users'] as const).map(k => (
              <button key={k} onClick={() => setScopeKind(k)}
                className={`rounded-lg px-2.5 py-1 border ${scopeKind === k ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
                {k === 'all' ? 'Everyone' : k === 'role' ? 'Roles' : 'People'}
              </button>
            ))}
          </div>
          {scopeKind === 'role' && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {['student', 'faculty', 'staff', 'admin'].map(r => (
                <label key={r} className="flex items-center gap-1">
                  <input type="checkbox" checked={scopeRoles.includes(r)}
                    onChange={() => setScopeRoles(v => v.includes(r) ? v.filter(x => x !== r) : [...v, r])} /> {r}
                </label>
              ))}
            </div>
          )}
          {scopeKind === 'users' && (
            <div className="flex flex-wrap gap-1.5 text-xs max-h-24 overflow-auto">
              {users.map(u => (
                <label key={u.username} className="flex items-center gap-1">
                  <input type="checkbox" checked={scopeUsers.includes(u.username)}
                    onChange={() => setScopeUsers(v => v.includes(u.username) ? v.filter(x => x !== u.username) : [...v, u.username])} /> {u.username}
                </label>
              ))}
            </div>
          )}
          <Button onClick={create} className="w-full">Send {form.priority} alert</Button>
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
          <Button variant="secondary" onClick={() => ranked ? (setRanked(false), load(false, false)) : loadRanked()} className="ml-auto text-xs">
            {ranked ? 'Newest first' : 'Smart rank'}
          </Button>
        </div>
        {ranked && <p className="text-xs text-[var(--muted)] mb-2">Sorted by smart rank (learned from what you acknowledge, plus recency). Alerts below your minimum priority are dimmed at the bottom.</p>}

        <div className="space-y-2 max-h-[560px] overflow-auto">
          {alerts.map(a => (
            <div key={a.id} className={`rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 ${a.below_threshold ? 'opacity-50' : ''}`}>
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

                  {/* ACK avatar strip */}
                  {openReceipts[a.id] && receipts[a.id] && receipts[a.id].length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {receipts[a.id].map(r => (
                        <Avatar key={r.user} name={r.user} acked={!!r.acked_at} />
                      ))}
                    </div>
                  )}
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
                    <ChevronDown size={13} className={`transition-transform ${openReceipts[a.id] ? 'rotate-180' : ''}`} /> Who got it?
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
