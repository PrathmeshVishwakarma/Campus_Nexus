import { useEffect, useRef, useState } from 'react'

export type LiveEvent = { event: string; data: any }

export function useEventsWs(onEvent?: (e: LiveEvent) => void) {
  const [connected, setConnected] = useState(false)
  const cb = useRef(onEvent)
  cb.current = onEvent
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/events`)
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (m) => { try { cb.current?.(JSON.parse(m.data)) } catch {} }
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'PING' })) }, 20000)
    return () => { clearInterval(ping); ws.close() }
  }, [])
  return { connected }
}
