import React, { useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
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

const PRIORITIES = ['CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'] as const

const dot: Record<string, string> = {
  CRITICAL: 'var(--error)', URGENT: 'var(--warning)', IMPORTANT: 'var(--accent)',
  NORMAL: 'var(--muted)', INFO: 'var(--muted)',
}

export default function Alerts() {
  const { token } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [form, setForm] = useState({ title: '', body: '', priority: 'URGENT' })
  const [filter, setFilter] = useState('')
  const [ranked, setRanked] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, Receipt[]>>({})

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const load = async () => {
    try {
      const res = filter
        ? await api(`/api/alerts?priority=${filter}`, auth)
        : await api('/api/alerts', auth)
      setAlerts(res)
      setRanked(false)
    } catch (e: any) { toast.error(e.message) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { load() }, [filter])

  const create = async () => {
    if (!form.title.trim()) return toast.error('Title required')
    try {
      await api('/api/alerts', { ...auth, method: 'POST', body: JSON.stringify({ ...form, target_scope: 'all' }) })
      setForm({ title: '', body: '', priority: 'URGENT' })
      toast.success('Alert broadcast — receipts created for every user')
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
          <div className="flex flex-wrap gap-1.5">
            {PRIORITIES.map(p => (
              <button
                key={p}
                onClick={() => setForm({ ...form, priority: p })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${form.priority === p ? 'border-[var(--accent)] bg-[rgba(139,92,246,0.2)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <Button onClick={create} className="w-full">Broadcast {form.priority} alert</Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="text-lg font-bold">Alerts</h2>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm" aria-label="Filter by priority">
            <option value="">All priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <Button variant="secondary" onClick={loadRanked}>Smart rank</Button>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
        {ranked && <p className="text-xs text-[var(--muted)] mb-2">Sorted by smart rank (priority × sender affinity × recency).</p>}

        <div className="space-y-2 max-h-[560px] overflow-auto">
          {alerts.map(a => (
            <div key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: dot[a.priority] ?? 'var(--muted)' }} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{a.title}</div>
                  <div className="text-xs text-[var(--muted)]">{a.body}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-1">
                    {a.priority} · by {a.sender} · {new Date(a.created_at).toLocaleString()} · {a.acked}/{a.total} acked
                    {typeof a.score === 'number' && <span> · score {a.score}</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {!a.acked_by_me
                  ? <Button onClick={() => ack(a.id)}><span className="flex items-center gap-1.5 text-xs"><CheckCheck size={13} /> Acknowledge</span></Button>
                  : <span className="text-xs text-emerald-400 self-center">✓ You acknowledged</span>}
                <Button variant="secondary" onClick={() => showReceipts(a.id)}><span className="text-xs">Who got it?</span></Button>
              </div>
              {receipts[a.id] && (
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
