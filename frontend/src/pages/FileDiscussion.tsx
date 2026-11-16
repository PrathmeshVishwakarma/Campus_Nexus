import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type Comment = { id: number; sender: string; content: string; created_at: string }

/** Standalone per-file discussion — detached from /chat channels. */
export default function FileDiscussion() {
  const { token, user } = useAuth()
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [denied, setDenied] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const auth = { headers: { Authorization: `Bearer ${token}` } }
  const pathRef = useRef(path)
  pathRef.current = path

  // Always show the latest comment
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [comments, path])

  const load = async (silent = false) => {
    if (!path) return
    try {
      const res = await api(`/api/files/discussion?path=${encodeURIComponent(path)}`, auth)
      setComments(res.comments || [])
      setDenied(false)
    } catch (e: any) {
      if (String(e.message).includes('403') || String(e.message).includes('No access')) setDenied(true)
      else if (!silent) toast.error(e.message)
    }
  }

  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => { load() }, [path])

  useEffect(() => {
    let alive = true
    let ws: WebSocket | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const connect = () => {
      if (!alive || !path) return
      try {
        ws = new WebSocket(`${scheme}://${location.host}/ws/events?token=${token}`)
      } catch { schedule(); return }
      ws.onopen = () => { retry = 0 }
      ws.onmessage = (m) => {
        if (!alive) return
        try {
          const e = JSON.parse(m.data)
          if (e.event !== 'FILE_COMMENT') return
          if ((e.data?.resource || '') === pathRef.current) loadRef.current(true)
        } catch {}
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
      ws.onclose = () => schedule()
    }
    const schedule = () => {
      if (!alive) return
      retry = Math.min(retry + 1, 5)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { if (alive) connect() }, Math.min(1000 * 2 ** retry, 10000))
    }
    connect()
    const ping = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ action: 'PING' })) } catch {} }
    }, 25000)
    const poll = setInterval(() => { if (alive && !document.hidden) loadRef.current(true) }, 4000)
    return () => { alive = false; clearInterval(ping); clearInterval(poll); if (retryTimer) clearTimeout(retryTimer); try { ws?.close() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path])

  const send = async () => {
    if (!text.trim() || !path) return
    const t = text; setText('')
    try {
      await api('/api/files/discussion', { ...auth, method: 'POST', body: JSON.stringify({ file_path: path, content: t }) })
      load(true)
    } catch (e: any) { toast.error(e.message); setText(t) }
  }

  if (!path) return <div className="max-w-3xl mx-auto p-6 text-sm text-[var(--muted)]">No file selected. <Link to="/files" className="underline">Back to files</Link></div>
  if (denied) return <div className="max-w-3xl mx-auto p-6 text-sm text-center text-[var(--muted)]">No access to this file's folder. <Link to="/files" className="underline">Back to files</Link></div>

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6">
      <Link to="/files" className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)] mb-3">
        <ArrowLeft size={14} /> Back to files
      </Link>
      <Card>
        <h1 className="font-bold truncate">Discussion</h1>
        <p className="text-xs text-[var(--muted)] truncate mb-3">{path} · separate from Chat</p>
        <div className="space-y-2 max-h-[50vh] overflow-auto mb-3">
          {comments.map(c => (
            <div key={c.id} className={`rounded-xl p-3 text-sm max-w-[85%] ${c.sender === user ? 'ml-auto bg-[rgba(139,92,246,0.15)]' : 'bg-[var(--card)]'}`}>
              <span className="font-medium text-xs">{c.sender}</span>
              <div className="mt-0.5">{c.content}</div>
              <div className="text-[11px] text-[var(--muted)] mt-1">{new Date(c.created_at).toLocaleString()}</div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-xs text-[var(--muted)] text-center py-8">No comments yet — start the discussion.</p>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2">
          <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={`Discuss ${path.split('/').pop()}…`} aria-label="File discussion input" />
          <Button onClick={send}><span className="flex items-center gap-1.5"><Send size={14} /> Send</span></Button>
        </div>
      </Card>
    </div>
  )
}
