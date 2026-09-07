import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { MoreVertical, Pencil, Plus, Send, Trash2, UserCheck, UserMinus, UserPlus, X } from 'lucide-react'
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
  // 3-dot manage menu (fixed-position pop-out so the scrolling
  // channel list never clips it) + modals
  const [menu, setMenu] = useState<{ id: number; top?: number; bottom?: number; left: number } | null>(null)

  // A fixed menu detaches if the page scrolls — just close it.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  const [rename, setRename] = useState<{ id: number; name: string } | null>(null)
  const [addId, setAddId] = useState<number | null>(null)
  const [addPick, setAddPick] = useState<string[]>([])
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [del, setDel] = useState<{ id: number; name: string; count: number } | null>(null)

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const loadUsers = async () => {
    try { setUsers(await api('/api/auth/users', auth)) } catch { /* optional */ }
  }

  const loadCh = async (silent = false) => {
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
    } catch (e: any) { if (!silent) toast.error(e.message) }
  }

  const loadMsg = async (silent = false) => {
    if (!cid) return
    try {
      const q = fileFilter ? `&file_link=${encodeURIComponent(fileFilter)}` : ''
      setMsgs(await api(`/api/messages?channel_id=${cid}${q}`, auth))
    } catch (e: any) {
      if (!silent) { toast.error(e.message); return }
      // silent (live) path: channel may have been deleted elsewhere —
      // drop the selection instead of showing stale messages
      try {
        const rows: Ch[] = await api('/api/messages/channels', auth)
        if (!rows.some(c => c.id === cid)) { setCid(null); setMsgs([]) }
      } catch { /* stay as-is on failure */ }
    }
  }

  // Refs so one long-lived socket/interval always sees the current selection
  // without reconnecting on every channel switch.
  const cidRef = useRef(cid)
  cidRef.current = cid
  const fileRef = useRef(fileFilter)
  fileRef.current = fileFilter

  useEffect(() => { loadCh(); loadUsers() }, [])
  useEffect(() => { loadMsg() }, [cid, fileFilter])
  useEffect(() => { setFileFilter(fileParam) }, [fileParam])

  // Live updates: WebSocket MESSAGE_SENT events for instant refresh,
  // plus a quiet 4s poll as fallback if the socket drops.
  useEffect(() => {
    let ws: WebSocket | null = null
    let alive = true
    const onEvent = (raw: string) => {
      try {
        const e = JSON.parse(raw)
        if (e.event !== 'MESSAGE_SENT') return
        const resource: string = e.data?.resource || ''
        const m = resource.match(/^channel:(\d+)/)
        // channel list can change on any message event (new/renamed/deleted channel)
        loadCh(true)
        if (m && Number(m[1]) === cidRef.current) loadMsg(true)
      } catch { /* ignore malformed frames */ }
    };
    try {
      ws = new WebSocket(`ws://${location.host}/ws/events?token=${token}`)
      ws.onmessage = (msg) => { if (alive) onEvent(msg.data) }
    } catch { ws = null }
    const poll = setInterval(() => { if (alive && !document.hidden) { loadCh(true); loadMsg(true) } }, 4000)
    return () => { alive = false; clearInterval(poll); try { ws?.close() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

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

  const toggleMenu = (c: Ch, e: React.MouseEvent<HTMLButtonElement>) => {
    if (menu?.id === c.id) { setMenu(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const MENU_H = 152 // approx height of the 4-item menu
    const left = Math.min(Math.max(8, r.right - 176), Math.max(8, window.innerWidth - 184))
    if (window.innerHeight - r.bottom < MENU_H + 8) {
      // no room below the button — pop upward, hugging the button
      setMenu({ id: c.id, bottom: Math.max(8, window.innerHeight - r.top + 4), left })
    } else {
      setMenu({ id: c.id, top: r.bottom + 4, left })
    }
  }

  const doRename = async () => {
    if (!rename || !rename.name.trim()) return toast.error('Name cannot be empty')
    try {
      await api(`/api/messages/channels/${rename.id}`, { ...auth, method: 'PATCH', body: JSON.stringify({ name: rename.name.trim() }) })
      toast.success('Channel renamed')
      setRename(null); setMenu(null)
      loadCh()
    } catch (e: any) { toast.error(e.message) }
  }

  const doAdd = async () => {
    if (addId == null || addPick.length === 0) return toast.error('Pick at least one person')
    try {
      await api(`/api/messages/channels/${addId}/members`, { ...auth, method: 'POST', body: JSON.stringify({ add: addPick }) })
      toast.success('Member(s) added')
      setAddId(null); setAddPick([]); setMenu(null)
      loadCh()
    } catch (e: any) { toast.error(e.message) }
  }

  const doRemove = async (member: string) => {
    if (removeId == null) return
    try {
      await api(`/api/messages/channels/${removeId}/members`, { ...auth, method: 'POST', body: JSON.stringify({ remove: [member] }) })
      toast.success(`${member} removed`)
      if (channels.find(c => c.id === removeId)?.members.length === 2) setRemoveId(null)
      loadCh()
    } catch (e: any) { toast.error(e.message) }
  }

  const openDelete = async (c: Ch) => {
    setMenu(null)
    let count = 0
    try {
      const rows: M[] = await api(`/api/messages?channel_id=${c.id}`, auth)
      count = rows.length
    } catch { /* show modal anyway */ }
    setDel({ id: c.id, name: c.name, count })
  }

  const doDelete = async () => {
    if (!del) return
    try {
      await api(`/api/messages/channels/${del.id}`, { ...auth, method: 'DELETE' })
      toast.success(`Deleted "${del.name}"`)
      if (cid === del.id) { setCid(null); setMsgs([]) }
      setDel(null)
      loadCh()
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid md:grid-cols-3 gap-4 items-start">
      <Card>
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

        <div className="space-y-1 max-h-[420px] overflow-auto" onScroll={() => setMenu(null)}>
          {channels.map(c => (
            <div
              key={c.id}
              className={`w-full px-3 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors ${cid === c.id ? 'bg-[rgba(139,92,246,0.15)]' : 'hover:bg-[var(--card-hover)]'}`}
            >
              <button
                onClick={() => { setCid(c.id); setParams(fileParam ? { file: fileParam } : {}); setMenu(null) }}
                className="flex-1 min-w-0 text-left flex items-center gap-2"
                aria-label={`Open ${c.name}`}
              >
                <span className="text-[var(--accent)]">#</span>
                <span className="font-medium truncate">{c.name}</span>
                <span className="text-xs text-[var(--muted)]">{c.type}</span>
                {(unread[c.id] ?? 0) > 0 && (
                  <span className="text-[11px] font-bold rounded-full bg-[var(--accent)] text-white px-2 py-0.5">{unread[c.id]}</span>
                )}
                {cid === c.id && <UserCheck size={13} className="text-emerald-400" />}
              </button>
              <button
                onClick={(e) => toggleMenu(c, e)}
                className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)] transition-colors shrink-0"
                aria-label={`Manage ${c.name}`}
                title="Manage channel"
              >
                <MoreVertical size={15} />
              </button>
            </div>
          ))}
          {channels.length === 0 && <p className="text-xs text-[var(--muted)]">No conversations yet — create one above.</p>}
        </div>

        {menu && (() => {
          const c = channels.find(x => x.id === menu.id)
          if (!c) return null
          // Portal to body: the glass Card's backdrop-filter would otherwise
          // become the containing block for `fixed` and offset the menu.
          return createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
              <div
                className="fixed z-50 w-44 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-1 text-sm"
                style={{ top: menu.top, bottom: menu.bottom, left: menu.left }}
              >
                <button onClick={() => { setRename({ id: c.id, name: c.name }); setMenu(null) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left"><Pencil size={13} /> Rename</button>
                <button onClick={() => { setAddId(c.id); setAddPick([]); setMenu(null) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left"><UserPlus size={13} /> Add person</button>
                <button onClick={() => { setRemoveId(c.id); setMenu(null) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left"><UserMinus size={13} /> Remove person</button>
                <button onClick={() => openDelete(c)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[rgba(239,68,68,0.15)] text-left text-red-400"><Trash2 size={13} /> Delete…</button>
              </div>
            </>,
            document.body
          )
        })()}
      </Card>

      <Card className="md:col-span-2 flex flex-col min-h-[480px]">
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

      {rename && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setRename(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Rename channel</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Names must be unique — renaming to an existing name is rejected.</p>
            <Input value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && doRename()} placeholder="New channel name" aria-label="New channel name" />
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={() => setRename(null)} className="flex-1">Cancel</Button>
              <Button onClick={doRename} className="flex-1">Rename</Button>
            </div>
          </div>
        </div>
      )}

      {addId != null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAddId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Add person</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Only registered users can be added.</p>
            <div className="max-h-48 overflow-auto space-y-1 mb-3">
              {users
                .filter(u => u.username !== user && !(channels.find(c => c.id === addId)?.members.includes(u.username)))
                .map(u => (
                  <label key={u.username} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--card-hover)] cursor-pointer">
                    <input type="checkbox" checked={addPick.includes(u.username)} onChange={() => setAddPick(p => p.includes(u.username) ? p.filter(x => x !== u.username) : [...p, u.username])} />
                    {u.username}
                  </label>
                ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAddId(null)} className="flex-1">Cancel</Button>
              <Button onClick={doAdd} className="flex-1">Add selected</Button>
            </div>
          </div>
        </div>
      )}

      {removeId != null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setRemoveId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Remove person</h3>
            <p className="text-xs text-[var(--muted)] mb-3">You cannot remove yourself — delete the channel instead.</p>
            <div className="space-y-1 mb-3">
              {(channels.find(c => c.id === removeId)?.members || []).filter(m => m !== user).map(m => (
                <div key={m} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5">
                  <span className="flex-1">{m}</span>
                  <Button variant="secondary" onClick={() => doRemove(m)}><span className="flex items-center gap-1.5 text-xs"><X size={13} /> Remove</span></Button>
                </div>
              ))}
              {(channels.find(c => c.id === removeId)?.members || []).filter(m => m !== user).length === 0 && (
                <p className="text-xs text-[var(--muted)]">No other members to remove.</p>
              )}
            </div>
            <Button variant="secondary" onClick={() => setRemoveId(null)} className="w-full">Done</Button>
          </div>
        </div>
      )}

      {del && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDel(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/40 bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1 text-red-400">Delete “{del.name}”?</h3>
            <p className="text-sm text-[var(--muted)] mb-3">
              ⚠️ Warning: this permanently deletes the channel and all {del.count} message{del.count === 1 ? '' : 's'} in it. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDel(null)} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={doDelete} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
