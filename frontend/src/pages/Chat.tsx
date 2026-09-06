import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Send, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type Ch = { id: number; name: string; type: string; members: string[] }
type M = { id: number; sender: string; content: string; file_link: string; read: boolean; created_at: string }
type User = { username: string; email: string }

export default function Chat() {
  const { user, token } = useAuth()
  const [params, setParams] = useSearchParams()
  const fileParam = params.get('file') || ''

  const [channels, setChannels] = useState<Ch[]>([])
  const [cid, setCid] = useState<number | null>(null)
  const [msgs, setMsgs] = useState<M[]>([])
  const [text, setText] = useState('')
  const [unread, setUnread] = useState<Record<number, number>>({})
  // new channel / DM form
  const [users, setUsers] = useState<User[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('group')
  const [picked, setPicked] = useState<string[]>([])
  const [fileFilter, setFileFilter] = useState(fileParam)

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const loadUsers = async () => {
    try { setUsers(await api('/api/auth/users', auth)) } catch { /* optional */ }
  }

  const loadCh = async () => {
    try {
      const res: Ch[] = await api('/api/messages/channels', auth)
      setChannels(res)
      if (!cid && res[0]) setCid(res[0].id)
      // unread badges
      const counts: Record<number, number> = {}
      await Promise.all(res.map(async c => {
        try {
          const r = await api(`/api/messages/unread/count?channel_id=${c.id}`, auth)
          counts[c.id] = r.unread ?? 0
        } catch { counts[c.id] = 0 }
      }))
      setUnread(counts)
    } catch (e: any) { toast.error(e.message) }
  }

  const loadMsg = async () => {
    if (!cid) return
    try {
      const q = fileFilter ? `&file_link=${encodeURIComponent(fileFilter)}` : ''
      setMsgs(await api(`/api/messages?channel_id=${cid}${q}`, auth))
    } catch (e: any) { toast.error(e.message) }
  }

  useEffect(() => { loadCh(); loadUsers() }, [])
  useEffect(() => { loadMsg() }, [cid, fileFilter])
  useEffect(() => { setFileFilter(fileParam) }, [fileParam])

  useEffect(() => {
    msgs.filter(m => !m.read && m.sender !== user).forEach(m => {
      api(`/api/messages/${m.id}/read`, { ...auth, method: 'PATCH' }).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs])

  const send = async () => {
    if (!text.trim() || !cid) return
    const t = text; setText('')
    try {
      await api('/api/messages', { ...auth, method: 'POST', body: JSON.stringify({ channel_id: cid, content: t, file_link: fileFilter }) })
      loadMsg(); loadCh()
    } catch (e: any) { toast.error(e.message); setText(t) }
  }

  const togglePick = (u: string) => {
    setPicked(p => p.includes(u) ? p.filter(x => x !== u) : [...p, u])
  }

  const createChannel = async () => {
    if (!newName.trim()) return toast.error('Give the conversation a name')
    if (newType === 'dm' && picked.length !== 1) return toast.error('Pick exactly 1 person for a DM')
    try {
      const res = await api('/api/messages/channels', {
        ...auth, method: 'POST',
        body: JSON.stringify({ name: newName.trim(), type: newType, members: picked }),
      })
      setNewName(''); setPicked([]); setShowNew(false)
      toast.success(newType === 'dm' ? 'DM created' : 'Group created')
      await loadCh()
      setCid(res.id)
    } catch (e: any) { toast.error(e.message) }
  }

  const active = useMemo(() => channels.find(c => c.id === cid), [channels, cid])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto grid md:grid-cols-3 gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-bold text-lg">Chat</h2>
          <Button onClick={() => setShowNew(v => !v)} title="New group or DM" aria-label="New conversation">
            <span className="flex items-center gap-1.5"><Plus size={14} /> New</span>
          </Button>
        </div>

        {showNew && (
          <div className="rounded-xl border border-[var(--border)] p-3 mb-3 space-y-2">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name (or DM title)" aria-label="Conversation name" />
            <div className="flex gap-2 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" checked={newType === 'group'} onChange={() => setNewType('group')} /> Group</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={newType === 'dm'} onChange={() => setNewType('dm')} /> 1:1 DM</label>
            </div>
            <div className="text-xs text-[var(--muted)]">Members {newType === 'dm' ? '(pick 1)' : '(pick any)'}</div>
            <div className="max-h-36 overflow-auto space-y-1">
              {users.filter(u => u.username !== user).map(u => (
                <label key={u.username} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-[var(--card-hover)] cursor-pointer">
                  <input type="checkbox" checked={picked.includes(u.username)} onChange={() => togglePick(u.username)} />
                  {u.username}
                </label>
              ))}
              {users.length === 0 && <p className="text-xs text-[var(--muted)]">No other users yet — register a second account to DM.</p>}
            </div>
            <Button onClick={createChannel} className="w-full">Create {newType === 'dm' ? 'DM' : 'group'}</Button>
          </div>
        )}

        <div className="space-y-1 max-h-[420px] overflow-auto">
          {channels.map(c => (
            <button
              key={c.id}
              onClick={() => { setCid(c.id); setParams(fileParam ? { file: fileParam } : {}) }}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors ${cid === c.id ? 'bg-[rgba(139,92,246,0.15)]' : 'hover:bg-[var(--card-hover)]'}`}
            >
              <span className="text-[var(--accent)]">#</span>
              <span className="font-medium truncate">{c.name}</span>
              <span className="text-xs text-[var(--muted)]">{c.type}</span>
              {(unread[c.id] ?? 0) > 0 && (
                <span className="ml-auto text-[11px] font-bold rounded-full bg-[var(--accent)] text-white px-2 py-0.5">{unread[c.id]}</span>
              )}
              {cid === c.id && <UserCheck size={13} className="text-emerald-400" />}
            </button>
          ))}
          {channels.length === 0 && <p className="text-xs text-[var(--muted)]">No conversations yet — create one above.</p>}
        </div>
      </Card>

      <Card className="p-4 md:col-span-2 flex flex-col min-h-[480px]">
        {!cid ? (
          <p className="text-sm text-[var(--muted)] text-center my-auto">Pick a conversation on the left, or create a group / DM.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap pb-3 border-b border-[var(--border)] mb-3">
              <h2 className="font-bold">#{active?.name}</h2>
              <span className="text-xs text-[var(--muted)]">{active?.type} · {active?.members.join(', ')}</span>
              {fileFilter ? (
                <span className="ml-auto text-xs rounded-full bg-[rgba(139,92,246,0.15)] text-[var(--accent)] px-2 py-1">
                  File thread: {fileFilter}
                  <button onClick={() => { setFileFilter(''); setParams({}) }} className="ml-1 underline">clear</button>
                  <Link to={`/files`} className="ml-2 underline">open file</Link>
                </span>
              ) : (
                <span className="ml-auto text-xs text-[var(--muted)]">Tip: open a file in Files → “Open in Chat” to discuss it here.</span>
              )}
            </div>
            <div className="flex-1 space-y-2 overflow-auto mb-3 max-h-[380px]">
              {msgs.map(m => (
                <div key={m.id} className="rounded-xl bg-[var(--card)] p-3 text-sm">
                  <span className="font-medium">{m.sender}</span>
                  {m.file_link && <span className="ml-2 text-xs text-[var(--accent)]">📎 {m.file_link}</span>}
                  <div className="mt-0.5">{m.content}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-1">{new Date(m.created_at).toLocaleString()} {m.read ? '· read' : ''}</div>
                </div>
              ))}
              {msgs.length === 0 && <p className="text-xs text-[var(--muted)] text-center py-8">No messages{fileFilter ? ' in this file thread' : ''} — say hello.</p>}
            </div>
            <div className="flex gap-2">
              <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={fileFilter ? `Reply in thread ${fileFilter}…` : 'Message…'} aria-label="Message input" />
              <Button onClick={send}><span className="flex items-center gap-1.5"><Send size={14} /> Send</span></Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
