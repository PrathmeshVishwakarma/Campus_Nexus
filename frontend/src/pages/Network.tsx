import React, { useEffect, useState, useRef } from 'react'
import { Wifi, Signal, Clock } from 'lucide-react'
import { toast } from 'sonner'
import * as d3 from 'd3'
import { api, useAuth } from '../store/useAuth'

type Node = { id: string; ip: string; latency: number; status: string; last_seen: string }
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
  throttle: { congested: boolean; bps: number; paused: boolean } | null
  net_io: { bytes_sent: number; dropin?: number; dropout?: number }
}

export default function Network() {
  const { token } = useAuth()
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  const load = async () => {
    try {
      const [g, s] = await Promise.all([
        api('/api/network/graph', { headers: { Authorization: `Bearer ${token}` } }),
        api('/api/network/stats', { headers: { Authorization: `Bearer ${token}` } })
      ])
      setGraph(g as GraphData)
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

  const discover = async () => {
    try {
      await api('/api/peers/discover', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({})
      })
      setTimeout(load, 1500)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

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
        <button
          onClick={discover}
          className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          Discover
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* D3 Graph */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {graph ? <ForceGraph graph={graph} /> : (
            <div className="p-8 text-[var(--muted)] text-center text-sm">
              <Signal className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No peers discovered yet</p>
              <p className="mt-2 text-xs">Click "Discover" to find nodes on the LAN</p>
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

    const label = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.id.substring(0, 8))
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