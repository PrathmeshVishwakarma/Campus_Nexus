import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, Bell, Files, MessageSquare, Search } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { api } from '../store/useAuth'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

export function Dashboard() {
  const [events, setEvents] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const { user, token } = useAuth()

  useEffect(() => {
    api('/api/events?limit=200', { headers: { Authorization: `Bearer ${token}` } }).then(setEvents).catch(() => {});
    const ws = new WebSocket(`ws://${location.host}/ws/events?token=${token}`);
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        setEvents(prev => [{ id: d.data.id, type: d.event, actor: d.data.actor, resource: d.data.resource, timestamp: d.data.timestamp, priority: d.data.priority }, ...prev].slice(0, 500));
      } catch {}
    };
    return () => ws.close();
  }, [token]);

  const shown = events.filter(e => !query || `${e.type} ${e.actor} ${e.resource}`.toLowerCase().includes(query.toLowerCase()))

  const tiles = [
    { icon: Files, label: 'Files synced', getVal: () => events.filter(e => e.type.startsWith('SYNC')).length },
    { icon: MessageSquare, label: 'Messages', getVal: () => events.filter(e => e.type.startsWith('MESSAGE')).length },
    { icon: Bell, label: 'Alerts', getVal: () => events.filter(e => e.type.startsWith('ALERT')).length },
    { icon: Activity, label: 'Total events', getVal: () => events.length },
  ]

  // Build hourly bucketed data for the area chart
  const chartData = useMemo(() => {
    const now = Date.now()
    const buckets: Record<string, number> = {}
    // Last 12 hours, 1-hour slots
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now - i * 3600_000)
      const label = `${d.getHours().toString().padStart(2, '0')}:00`
      buckets[label] = 0
    }
    for (const e of events) {
      if (!e.timestamp) continue
      const t = new Date(e.timestamp)
      const age = now - t.getTime()
      if (age > 12 * 3600_000) continue
      const label = `${t.getHours().toString().padStart(2, '0')}:00`
      if (label in buckets) buckets[label]++
    }
    return Object.entries(buckets).map(([hour, count]) => ({ hour, count }))
  }, [events])

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] antialiased">
      <div className="relative overflow-x-hidden">
        <motion.div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            background: 'linear-gradient(135deg, var(--bg-subtle) 0%, rgba(15,15,25,0.3) 100%)',
          }}
        />

        <div className="relative z-10 min-h-screen">
          <header className="border-b border-[var(--border)] backdrop-blur-lg bg-[var(--card)]">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                  Campus Nexus <span className="text-[var(--accent)]">live</span>
                </h1>

                <div className="flex items-center gap-2 bg-[var(--card-hover)] rounded-xl px-3 py-1.5 min-w-0 flex-1 sm:max-w-xs">
                  <Search size={14} className="text-muted-foreground shrink-0" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events, actors, files…" className="bg-transparent outline-none text-sm w-full placeholder-[var(--muted)] focus:outline-none" />
                </div>
              </div>

              <p className="mt-2 text-sm text-[var(--muted)]">
                Welcome back, <span className="font-medium">{user || ''}</span>
              </p>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
            <div className="space-y-4">

              <Card>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {tiles.map((t, i) => (
                    <Card key={`${t.icon}-${i}`} className="p-4 flex flex-col items-center gap-1.5 text-center">
                      <t.icon size={16} className="text-[var(--accent)]" />
                      <div className="text-2xl font-bold leading-none">{t.getVal()}</div>
                      <div className="text-[var(--muted)] text-xs sm:text-sm">{t.label}</div>
                    </Card>
                  ))}
                </div>
              </Card>

              {/* Events/hour area chart */}
              <Card>
                <h2 className="text-[var(--accent)] font-semibold tracking-tight mb-3">Events / Hour (last 12 h)</h2>
                {chartData.some(d => d.count > 0) ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: 'var(--accent)' }}
                        itemStyle={{ color: 'var(--fg)' }}
                      />
                      <Area type="monotone" dataKey="count" stroke="var(--accent)" fill="url(#evtGrad)" strokeWidth={2} dot={false} name="Events" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-[var(--muted)] text-center py-8">No events in the last 12 hours — activity will appear here in real time.</p>
                )}
              </Card>

              <Card>
                <h2 className="text-lg font-bold tracking-tight mb-1">Open a workspace</h2>
                <p className="text-sm text-[var(--muted)] mb-3">Jump straight into files, chat, alerts, or the network view.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Link to="/files" className="rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="flex items-center gap-2 font-medium text-sm"><Files size={15} className="text-[var(--accent)]" /> Files</div>
                    <div className="text-xs text-[var(--muted)] mt-1">Browse the shared folder tree, upload, versions, per-file comments</div>
                  </Link>
                  <Link to="/chat" className="rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="flex items-center gap-2 font-medium text-sm"><MessageSquare size={15} className="text-[var(--accent)]" /> Chat</div>
                    <div className="text-xs text-[var(--muted)] mt-1">Custom groups + 1:1 DMs, unread badges, file threads</div>
                  </Link>
                  <Link to="/alerts" className="rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="flex items-center gap-2 font-medium text-sm"><Bell size={15} className="text-[var(--accent)]" /> Alerts</div>
                    <div className="text-xs text-[var(--muted)] mt-1">Raise a broadcast, track ACKs and delivery receipts</div>
                  </Link>
                  <Link to="/network" className="rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="flex items-center gap-2 font-medium text-sm"><Activity size={15} className="text-[var(--accent)]" /> Network</div>
                    <div className="text-xs text-[var(--muted)] mt-1">Peers, topology, scheduler queue, anomaly state</div>
                  </Link>
                </div>
              </Card>

              <Card>
                <h2 className="text-[var(--accent)] font-semibold tracking-tight mb-3">Event Timeline</h2>
                <p className="text-[var(--muted)] text-sm mb-3">
                  {shown.length} of {events.length} events{query ? <> matching <span className="font-medium text-[var(--accent)]">"{query}"</span></> : ''}
                </p>

                <div className="space-y-2 max-h-[500px] overflow-auto pr-1">
                  {shown.map(e => (
                    <div key={e.id} className="rounded-xl bg-[var(--card)] p-3 flex items-stretch gap-3 transition-colors hover:bg-[var(--card-hover)]">
                      <span className="w-1 rounded-full shrink-0" style={{ background: getPriorityColor(e.priority) }} />
                      <div className="flex-1 min-w-0 py-0.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[11px] font-bold tracking-wider text-[var(--accent)]">{e.type}</span>
                          <span className="text-xs text-[var(--muted)] ml-auto shrink-0">
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="font-medium text-sm truncate">{e.actor} <span className="font-normal text-[var(--muted)]">→ {e.resource || '—'}</span></div>
                      </div>
                    </div>
                  ))}
                  {events.length === 0 && !query && (
                    <div className="p-6 text-[var(--muted)] text-center">
                      No events yet. Start by sharing a folder or sending a message.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

function getPriorityColor(priority: number) {
  if (priority >= 100) return 'var(--error)'
  if (priority >= 80) return 'var(--accent)'
  if (priority >= 60) return 'var(--success)'
  if (priority >= 40) return 'var(--warning)'
  return 'var(--muted)'
}