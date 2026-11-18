import { useEffect, useRef, useState } from 'react'
import { sessionExpired, useAuth } from '../store/useAuth'

/**
 * useNexusEvents — ONE shared WebSocket for the whole app.
 *
 * The socket lives at module scope, so every page/component that calls this
 * hook subscribes to the *same* connection instead of opening its own. It
 * auto-reconnects with exponential backoff and exposes the live connection
 * status so the UI can show an offline/reconnecting banner.
 *
 *   const { connected, status } = useNexusEvents(e => { ... }, token)
 */

/** notify/sound/toast are computed server-side from the user's notification preferences. */
export type LiveEvent = { event: string; data: any; notify?: boolean; sound?: boolean; toast?: boolean }
export type ConnStatus = 'connecting' | 'open' | 'closed'

let socket: WebSocket | null = null
let currentToken = ''
let backoff = 500
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let manualClose = false
let status: ConnStatus = 'closed'

const eventListeners = new Set<(e: LiveEvent) => void>()
const statusListeners = new Set<(s: ConnStatus) => void>()

function setStatus(s: ConnStatus) {
  status = s
  statusListeners.forEach((fn) => { try { fn(s) } catch { /* noop */ } })
}

function wsUrl(token: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const q = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${proto}://${location.host}/ws/events${q}`
}

function scheduleReconnect() {
  if (reconnectTimer || manualClose) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    backoff = Math.min(backoff * 2, 15000) // exponential backoff, capped at 15s
    connect(currentToken)
  }, backoff)
}

function connect(token: string) {
  currentToken = token
  manualClose = false
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  setStatus('connecting')
  try {
    socket = new WebSocket(wsUrl(token))
  } catch {
    socket = null
    scheduleReconnect()
    return
  }
  socket.onopen = () => {
    backoff = 500 // reset backoff on a healthy connection
    setStatus('open')
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ action: 'PING' })) } catch { /* noop */ }
      }
    }, 20000)
  }
  socket.onmessage = (m) => {
    let parsed: LiveEvent | null = null
    try { parsed = JSON.parse(m.data) } catch { return }
    if (!parsed || parsed.event === 'PONG') return
    eventListeners.forEach((fn) => { try { fn(parsed as LiveEvent) } catch { /* noop */ } })
  }
  socket.onclose = (ev) => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    setStatus('closed')
    if (ev.code === 4401) {        // server rejected the token: session is over
      manualClose = true
      sessionExpired()
      return
    }
    if (!manualClose) scheduleReconnect()
  }
  socket.onerror = () => { try { socket?.close() } catch { /* noop */ } }
}

function ensureConnected(token: string) {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    connect(token)
  } else if (token !== currentToken) {
    // token changed (e.g. login as a different user) -> reconnect with it
    manualClose = true
    try { socket.close() } catch { /* noop */ }
    socket = null
    connect(token)
  }
}

/** Close the shared socket (logout). */
export function disconnect() {
  manualClose = true
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  try { socket?.close() } catch { /* noop */ }
  socket = null
  currentToken = ''
  setStatus('closed')
}

useAuth.subscribe((s, prev) => { if (prev.token && !s.token) disconnect() })

/** Read the current status without subscribing (handy outside React). */
export function getConnectionStatus(): ConnStatus {
  return status
}

export function useNexusEvents(onEvent?: (e: LiveEvent) => void, token?: string) {
  const [statusState, setStatusState] = useState<ConnStatus>(status)
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    const tok = token ?? useAuth.getState().token
    if (!tok) return // not authenticated -> no socket
    ensureConnected(tok)

    const evtSub = (e: LiveEvent) => cb.current?.(e)
    const statSub = (s: ConnStatus) => setStatusState(s)
    eventListeners.add(evtSub)
    statusListeners.add(statSub)
    setStatusState(status) // sync immediately on mount

    return () => {
      eventListeners.delete(evtSub)
      statusListeners.delete(statSub)
      // The singleton socket stays open across navigations by design.
    }
  }, [token])

  return { connected: statusState === 'open', status: statusState }
}
