import React, { useEffect, useState } from 'react'
import { Wifi, Signal, MapPin, Clock, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
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
  net_io: { bytes_sent: number }
}

export default function Network() {
  const { user, token } = useAuth()
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
    const refresh = () => {
      load()
      setTimeout(refresh, 8000)
    }
    refresh()
    return () => {}
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

  function getPriorityClass(priority: number) {
    if (priority >= 80) return 'critical'
    if (priority >= 60) return 'urgent'
    if (priority >= 40) return 'normal'
    return 'low'
  }

  function formatBytes(bytes: number) {
    if (bytes >= 1_000_000_000) return `(${(bytes / 1_000_000_000).toFixed(2)} GB)`
    if (bytes >= 1_000_000) return `(${(bytes / 1_000_000).toFixed(2)} MB)`
    if (bytes >= 1_000) return `(${(bytes / 1_000).toFixed(2)} KB)`
    return ''
  }

  function getPriorityColor(priority: number) {
    if (priority >= 80) return 'var(--error)'
    if (priority >= 60) return 'var(--accent)'
    if (priority >= 40) return 'var(--success)'
    return 'var(--muted)'
  }

  function getPriorityBg(priority: number) {
    if (priority >= 80) return 'red'
    if (priority >= 60) return 'amber'
    if (priority >= 40) return 'violet'
    return 'gray'
  }

  function renderGraph(graphData: GraphData) {
    const { nodes, edges, isolated, central, online, total } = graphData

    // Calculate positions using a simple force layout approximation
    const nodeMap = new Map<string, { x: number; y: number }>()
    const serverNode = nodes.find(n => n.id === 'server')

    // Position server in center
    if (serverNode) {
      nodeMap.set('server', { x: 500, y: 300 })
    }

    // Position other nodes around
    nodes.forEach((node, i) => {
      if (node.id !== 'server') {
        const angle = (i * 360) / Math.max(nodes.length, 1)
        const radius = 200
        nodeMap.set(node.id, {
          x: 500 + radius * Math.cos(angle * Math.PI / 180),
          y: 300 + radius * Math.sin(angle * Math.PI / 180),
        })
      }
    })

    // Default positions if server not found
    if (!serverNode) {
      nodes.forEach((node, i) => {
        const angle = (i * 360) / Math.max(nodes.length, 1)
        const radius = 200
        nodeMap.set(node.id, {
          x: 500 + radius * Math.cos(angle * Math.PI / 180),
          y: 300 + radius * Math.sin(angle * Math.PI / 180),
        })
      })
    }

    return (
      <div className="rounded-2xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
        <svg className="w-full h-64" viewBox="0 0 1000 600">
          {/* Edges */}
          {edges.map((e: Edge) => {
            const from = nodeMap.get(e.from)
            const to = nodeMap.get(e.to)
            if (!from || !to) return null
            return (
              <line
                key={`edge-${e.from}-${e.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--border)"
                strokeWidth={2}
                strokeOpacity={0.3}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map((n: Node) => {
            const pos = nodeMap.get(n.id)
            if (!pos) return null

            const isIsolated = isolated.includes(n.id)
            const isCentral = n.id === central
            const cls = `node ${isIsolated ? 'isolated' : ''} ${isCentral ? 'central' : ''} ${getPriorityClass(n.latency)}`

            return (
              <g key={`node-${n.id}`}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isIsolated ? 8 : isCentral ? 14 : 10}
                  fill={isIsolated ? 'var(--error)' : isCentral ? 'var(--accent)' : 'var(--card-hover)'}
                  stroke={isIsolated ? 'var(--bg)' : isCentral ? 'var(--bg)' : 'var(--border)'}
                  strokeWidth={2}
                />
                <text
                  x={pos.x}
                  y={pos.y + 5}
                  textAnchor="middle"
                  fontSize={10}
                  fill={n.id === central ? 'white' : isIsolated ? 'var(--bg)' : 'var(--muted)'}
                  fontWeight={n.id === central ? 'bold' : 'normal'}
                >
                  {n.id.substring(0, 8)}
                </text>
              </g>
            )
          })}

          {/* Labels for non-server nodes */}
          {nodes
            .filter((n) => n.id !== 'server')
            .map((n: Node) => {
              const pos = nodeMap.get(n.id)
              if (!pos) return null
              return (
                <text
                  key={`label-${n.id}`}
                  x={pos.x}
                  y={pos.y - 15}
                  textAnchor="middle"
                  fontSize={9}
                  fill={"var(--muted)"}
                >
                  {n.id.substring(0, 5)}
                </text>
              )
            })}
        </svg>

        <div className="p-4 bg-[var(--card)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Nodes</span>
            <span className="text-[var(--muted)] text-xs">{online}/{total}</span>
          </div>
          <div className="flex gap-2">
            {nodes.map((n: Node) => (
              <div
                key={n.id}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                style={{
                  background: n.status === 'online' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  color: n.status === 'online' ? 'var(--success)' : 'var(--error)',
                }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: n.status === 'online' ? 'var(--success)' : 'var(--error)' }}/>
                {n.id}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderScheduler(stats: Stats) {
    return (
      <div className="rounded-2xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
        <div className="p-3 border-b border-[var(--border)]">
          <h3 className="font-semibold">Scheduler Queue</h3>
          <p className="text-xs text-[var(--muted)]">
            {stats.throttle?.paused ? 'Paused (anomaly)' : 'Running normally'}
          </p>
        </div>
        <div className="p-3">
          {stats.scheduler_queue.map((t: { label: string; priority: number }) => (
            <div
              key={t.label}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
              style={{ background: getPriorityBg(t.priority), color: 'white' }}
            >
              <div className="w-6 h-6 rounded-md" style={{ background: getPriorityColor(t.priority) }}/>
              <span>{t.label}: P{t.priority}</span>
            </div>
          ))}
          {stats.scheduler_queue.length === 0 && (
            <span className="text-[var(--muted)]">Empty</span>
          )}
        </div>
      </div>
    )
  }

  function renderNetStats(stats: Stats) {
    const throttle: { congested: boolean; bps: number; paused: boolean } = stats.throttle || {
      congested: false,
      bps: 0,
      paused: false,
    }
    const netIO = stats.net_io || { bytes_sent: 0 }

    return (
      <div className="rounded-2xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
        <div className="p-3 border-b border-[var(--border)]">
          <h3 className="font-semibold">Network Stats</h3>
        </div>
        <div className="p-3">
          <p className="text-sm">
            <Clock className="mr-2 h-4 w-4" /> Total tx: {formatBytes(netIO.bytes_sent)}
          </p>
{throttle.congested && (
          <div className="flex flex-col gap-1">
            <p className="mt-2 text-[var(--error)] font-medium">
              Throttle: Congested
            </p>
            <p className="text-xs text-[var(--muted)]">Bandwidth: {throttle.bps.toLocaleString()} bps</p>
          </div>
        )}
        {!throttle.congested && (
          <div className="flex flex-col gap-1">
            <p className="mt-2 text-[var(--emerald)]">
              Throttle: Clear
            </p>
            <p className="text-xs text-[var(--muted)]">Bandwidth: {throttle.bps.toLocaleString()} bps</p>
          </div>
        )}
        {throttle.paused && (
          <p className="mt-2 text-[var(--error)] font-medium">
            Paused (anomaly detected)
          </p>
        )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="grid grid-cols-1 gap-6">
        {/* Topology Graph */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Wifi size={16} />
            <h2 className="font-semibold">Topology</h2>
            <button
              onClick={discover}
              className="ml-auto rounded-md px-2.5 py-1.5 text-xs font-medium bg-[var(--accent)] text-white"
              aria-label="Discover peers"
            >
              Discover
            </button>
          </div>

          {graph ? renderGraph(graph) : (
            <div className="p-6 text-[var(--muted)] text-center">
              <Signal className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No peers discovered yet</p>
              <p className="mt-2">Click "Discover" to find nodes on the LAN</p>
            </div>
          )}
        </div>

        {/* Scheduler + Stats */}
        <div>
          {stats && renderScheduler(stats)}
          {stats && renderNetStats(stats)}
        </div>
      </div>
    </div>
  )
}