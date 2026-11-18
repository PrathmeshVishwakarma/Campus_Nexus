import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents } from '../hooks/useNexusEvents'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Comment = { id: number; sender: string; content: string; created_at: string; pending?: boolean }

/** Per-file discussion, embedded in the Files detail panel (separate from Chat). Live. */
export function FileDiscussionPanel({ path }: { path: string }) {
  const { token, user } = useAuth()
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [denied, setDenied] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [comments])

  const load = async (silent = false) => {
    try {
      const res = await api(`/api/files/discussion?path=${encodeURIComponent(pathRef.current)}`)
      setComments(res.comments || [])
      setDenied(false)
    } catch (e: any) {
      if (e?.status === 403) setDenied(true)
      else if (!silent) toast.error(e.message)
    }
  }
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => { setComments([]); load() }, [path])

  const { connected } = useNexusEvents((e) => {
    if (e.event === 'FILE_COMMENT' && (e.data?.resource || '') === pathRef.current) loadRef.current(true)
  }, token)
  useEffect(() => {
    if (connected) { loadRef.current(true); return }       // catch up after reconnect
    const poll = setInterval(() => { if (!document.hidden) loadRef.current(true) }, 5000)
    return () => clearInterval(poll)
  }, [connected])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    const tempId = -Date.now()
    // optimistic: show it immediately, reconcile with the server's copy
    setComments(c => [...c, { id: tempId, sender: user, content: t, created_at: new Date().toISOString(), pending: true }])
    try {
      const res = await api('/api/files/discussion', { method: 'POST', body: JSON.stringify({ file_path: path, content: t }) })
      setComments(c => c.map(x => x.id === tempId ? res.comment : x))
    } catch (e: any) {
      setComments(c => c.filter(x => x.id !== tempId))
      setText(t)
      toast.error(e.message)
    }
  }

  if (denied) return <p className="text-xs text-[var(--muted)] py-4">No access to this file's folder.</p>

  return (
    <div>
      <div className="space-y-2 max-h-64 overflow-auto mb-2">
        {comments.map(c => (
          <div key={c.id} className={`rounded-xl p-2.5 text-sm max-w-[90%] ${c.sender === user ? 'ml-auto bg-[rgba(139,92,246,0.15)]' : 'bg-[var(--card-hover)]'} ${c.pending ? 'opacity-60' : ''}`}>
            <span className="font-medium text-xs">{c.sender}</span>
            <div className="mt-0.5 break-words">{c.content}</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">{c.pending ? 'sending…' : new Date(c.created_at).toLocaleString()}</div>
          </div>
        ))}
        {comments.length === 0 && <p className="text-xs text-[var(--muted)] text-center py-6">No comments yet — start the discussion.</p>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`Discuss ${path.split('/').pop()}…`} aria-label="File discussion input" />
        <Button onClick={send} aria-label="Send comment"><Send size={14} /></Button>
      </div>
    </div>
  )
}
