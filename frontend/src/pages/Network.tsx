import React, { useEffect, useState, useRef } from 'react'
import { Wifi, Signal, Clock } from 'lucide-react'
import { toast } from 'sonner'
import * as d3 from 'd3'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents } from '../hooks/useNexusEvents'

type Node = {
  id: string
  label?: string
  role?: string
  connections?: number
  ip: string
  latency: number
  status: string
  last_seen: string
}
type Edge = { from: string; to: string; latency: number }
type GraphData = {
  nodes: Node[]
  edges: Edge[]
  isolated: string[]
  central: string
  online: number
  total: number
}
type Stats = {
  scheduler_queue: { label: string; priority: number }[]
  throttle: {
    congested: boolean
    bps: number
    paused: boolean
    token_bucket?: {
      rate: number
      capacity: number
      tokens: number
      simulated_congestion: boolean
      is_congested: boolean
    }
  } | null
  net_io: { bytes_sent: number; dropin?: number; dropout?: number }
}

export default function Network() {
  const { token } = useAuth()
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [toggling, setToggling] = useState(false)
  const graphJson = useRef('')

  const toggleCongestion = async () => {
    setToggling(true)
    const currentlySimulated = !!stats?.throttle?.token_bucket?.simulated_congestion
    try {
      await api('/api/network/congestion', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ congested: !currentlySimulated })
      })
      toast.success(!currentlySimulated ? 'Simulated Congestion ON: AIMD Backoff activated' : 'Congestion cleared: Full line speed restored')
      await load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToggling(false)
    }
  }

  const load = async () => {
    try {
      const [g, s] = await Promise.all([
        api('/api/network/graph', { headers: { Authorization: `Bearer ${token}` } }),
        api('/api/network/stats', { headers: { Authorization: `Bearer ${token}` } })
      ])
      // Only rebuild the force graph when the topology actually changed.
      const next = JSON.stringify(g)
      if (next !== graphJson.current) {
        graphJson.current = next
        setGraph(g as GraphData)
      }
      setStats(s as Stats)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 8000)
    return () => clearInterval(interval)
  }, [])

  // Presence is pushed over the shared WebSocket the moment someone joins/leaves.
  const { connected } = useNexusEvents((e) => {
    if (e.event === 'PRESENCE') load()
  })

  function getPriorityColor(priority: number) {
    if (priority >= 80) return 'var(--error)'
    if (priority >= 60) return 'var(--accent)'
    if (priority >= 40) return 'var(--success)'
    return 'var(--muted)'
  }

  function formatBytes(bytes: number) {
    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB`
    return `${bytes} B`
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Wifi size={16} className="text-[var(--accent)]" />
        <h1 className="text-xl font-bold tracking-tight">Network topology</h1>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs ${connected ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--success)] animate-pulse' : 'bg-[var(--muted)]'}`} />
          {connected ? 'Live' : 'Reconnecting'}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* D3 Graph */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {graph ? <ForceGraph graph={graph} /> : (
            <div className="p-8 text-[var(--muted)] text-center text-sm">
              <Signal className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>Waiting for presence…</p>
            </div>
          )}
          {graph && (
            <div className="border-t border-[var(--border)] px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Online now</h3>
                <span className="text-xs text-[var(--muted)]">{graph.nodes.filter(n => n.id !== 'server').length} client{graph.nodes.filter(n => n.id !== 'server').length === 1 ? '' : 's'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {graph.nodes.filter(n => n.id !== 'server').map(n => (
                  <span key={n.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--card-hover)] px-2 py-1 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                    <span className="font-medium">{n.label || n.id}</span>
                    {n.role && <span className="text-[var(--muted)] capitalize">{n.role}</span>}
                  </span>
                ))}
                {graph.nodes.filter(n => n.id !== 'server').length === 0 && (
                  <span className="text-xs text-[var(--muted)]">Open the app on another device and it will appear here.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Health Bars & Stats */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="font-semibold mb-3">Network Health</h3>
            
            {/* Bandwidth Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                <span>Bandwidth (5 MB/s limit)</span>
                <span>{stats?.throttle ? formatBytes(stats.throttle.bps) + '/s' : '0 B/s'}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--card-hover)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, ((stats?.throttle?.bps || 0) / 5_000_000) * 100)}%`,
                    background: stats?.throttle?.congested ? 'var(--error)' : 'var(--accent)'
                  }}
                />
              </div>
            </div>

            {/* Latency Bar */}
            <div className="mb-4">
              {(() => {
                const latencies = graph?.nodes.filter(n => n.id !== 'server').map(n => n.latency) || []
                const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
                const latColor = avgLatency < 50 ? 'var(--success)' : avgLatency < 200 ? 'var(--warning)' : 'var(--error)'
                return (
                  <>
                    <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                      <span>Avg Peer Latency</span>
                      <span>{avgLatency ? `${avgLatency.toFixed(1)} ms` : '—'}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[var(--card-hover)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (avgLatency / 300) * 100)}%`,
                          background: latColor
                        }}
                      />
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Packet Loss */}
            {stats?.net_io && (
              <div className="text-xs text-[var(--muted)] flex justify-between items-center bg-[var(--card-hover)] p-2 rounded-lg">
                <span className="flex items-center gap-1.5"><Clock size={14} /> Total TX: {formatBytes(stats.net_io.bytes_sent)}</span>
                <span title="Packet loss (dropped packets)">
                  Loss: {stats.net_io.dropout || 0} out / {stats.net_io.dropin || 0} in
                </span>
              </div>
            )}
          </div>

          {/* Scheduler Queue */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 max-h-[300px] overflow-auto">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">Scheduler Queue</h3>
              <span className={`text-xs ${stats?.throttle?.paused ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
                {stats?.throttle?.paused ? 'Paused (Anomaly)' : 'Running'}
              </span>
            </div>
            <div className="space-y-1.5">
              {stats?.scheduler_queue.map(t => (
                <div
                  key={t.label}
                  className="flex justify-between items-center p-2 rounded bg-[var(--card-hover)] text-xs"
                >
                  <span className="truncate mr-2 font-medium">{t.label}</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-white font-bold whitespace-nowrap"
                    style={{ background: getPriorityColor(t.priority) }}
                  >
                    P{t.priority}
                  </span>
                </div>
              ))}
              {(!stats?.scheduler_queue || stats.scheduler_queue.length === 0) && (
                <p className="text-xs text-[var(--muted)] text-center py-4">Queue empty</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Congestion Control & Traffic Shaper Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base">QoS & Congestion Control</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--muted)]">
              Token Bucket + AIMD
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                stats?.throttle?.congested
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  stats?.throttle?.congested ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
                }`}
              />
              {stats?.throttle?.congested ? 'CONGESTED (AIMD Backoff)' : 'OPTIMAL (Full Speed)'}
            </span>
            <button
              onClick={toggleCongestion}
              disabled={toggling}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                stats?.throttle?.token_bucket?.simulated_congestion
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-[var(--card-hover)] hover:bg-[var(--border)] text-[var(--foreground)] border border-[var(--border)]'
              }`}
            >
              {stats?.throttle?.token_bucket?.simulated_congestion ? 'Clear Simulated Congestion' : 'Simulate Network Congestion'}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-[var(--card-hover)] border border-[var(--border)]">
            <div className="text-[var(--muted)] mb-1">Token Bucket Level</div>
            <div className="text-lg font-bold">
              {stats?.throttle?.token_bucket ? `${stats.throttle.token_bucket.tokens} / ${stats.throttle.token_bucket.capacity}` : '10 / 10'}{' '}
              <span className="text-xs font-normal text-[var(--muted)]">tokens</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[var(--border)] mt-2 overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (((stats?.throttle?.token_bucket?.tokens || 10) / (stats?.throttle?.token_bucket?.capacity || 10)) * 100)
                  )}%`
                }}
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--card-hover)] border border-[var(--border)]">
            <div className="text-[var(--muted)] mb-1">Token Generation Rate</div>
            <div className="text-lg font-bold">
              {stats?.throttle?.token_bucket?.rate || 5.0}{' '}
              <span className="text-xs font-normal text-[var(--muted)]">chunks/sec (~5 MB/s)</span>
            </div>
            <p className="text-[10px] text-[var(--muted)] mt-2">
              Sustained rate limit for bulk file synchronization
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[var(--card-hover)] border border-[var(--border)]">
            <div className="text-[var(--muted)] mb-1">QoS Priority Policies</div>
            <div className="space-y-1 mt-1 text-[11px]">
              <div className="flex justify-between">
                <span>P &ge; 80 (Alerts/Chat):</span>
                <span className="font-semibold text-emerald-500">Bypass (0 ms)</span>
              </div>
              <div className="flex justify-between">
                <span>P &lt; 60 (File Chunks):</span>
                <span className="font-semibold text-amber-500">AIMD Throttled</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ForceGraph({ graph }: { graph: GraphData }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    container.innerHTML = '' // Clear old

    const width = container.clientWidth
    const height = 300

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])

    // Convert string references to object references for D3
    const nodes = graph.nodes.map(d => ({ ...d })) as any[]
    const links = graph.edges.map(d => ({ source: d.from, target: d.to, latency: d.latency })) as any[]

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))

    const link = svg.append('g')
      .attr('stroke', 'var(--border)')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', d => Math.max(1, 4 - (d.latency / 50)))

    const node = svg.append('g')
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 2)
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => d.id === graph.central ? 14 : graph.isolated.includes(d.id) ? 8 : 10)
      .attr('fill', d => d.id === graph.central ? 'var(--accent)' : graph.isolated.includes(d.id) ? 'var(--error)' : 'var(--success)')

    node.append('title').text(d => d.id === graph.central
      ? 'server'
      : `${d.label || d.id}${d.role ? ` — ${d.role}` : ''}${(d.connections || 1) > 1 ? ` · ${d.connections} sessions` : ''}`)

    const label = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.label || d.id)
      .attr('font-size', '10px')
      .attr('fill', d => d.id === graph.central ? '#fff' : 'var(--muted)')
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.id === graph.central ? 3 : 20)
      .attr('font-weight', d => d.id === graph.central ? 'bold' : 'normal')

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)
      
      node
        .attr('cx', d => d.x = Math.max(15, Math.min(width - 15, d.x)))
        .attr('cy', d => d.y = Math.max(15, Math.min(height - 15, d.y)))
        
      label
        .attr('x', d => d.x)
        .attr('y', d => d.y)
    })

    return () => {
      simulation.stop()
    }
  }, [graph])

  return <div ref={containerRef} className="w-full h-[300px]" />
}