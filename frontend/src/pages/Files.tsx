import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, Folder, FolderOpen, MessageSquare, RefreshCw, Upload, History, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type FileItem = { name: string; path: string; size: number; version: number; hash: string; modified_by: string }
type Version = { version: number; hash: string; size: number; by: string; at: string; chunks: unknown; clock: Record<string, number> }
type ThreadMsg = { id: number; sender: string; content: string; file_link: string; read: boolean; created_at: string }
type Channel = { id: number; name: string; type: string; members: string[] }

const CHUNK = 1024 * 1024

function dirOf(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export default function Files() {
  const { token } = useAuth()
  const [files, setFiles] = useState<FileItem[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [share, setShare] = useState({ name: '', path: '' })
  const [uploading, setUploading] = useState(false)
  const [uploadDir, setUploadDir] = useState('')
  // per-file comments
  const [channels, setChannels] = useState<Channel[]>([])
  const [threadChannel, setThreadChannel] = useState<number | null>(null)
  const [thread, setThread] = useState<ThreadMsg[]>([])
  const [comment, setComment] = useState('')

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const load = async () => {
    try {
      const res = await api('/api/files', auth)
      setFiles(res)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const loadChannels = async () => {
    try {
      const res = await api('/api/messages/channels', auth)
      setChannels(res)
      if (!threadChannel && res[0]) setThreadChannel(res[0].id)
    } catch { /* chat optional */ }
  }

  const loadVersions = async (path: string) => {
    try {
      const res = await api(`/api/files/versions?path=${encodeURIComponent(path)}`, auth)
      setVersions(res)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const loadThread = async (path: string, channelId: number | null) => {
    if (!channelId) return
    try {
      const res = await api(`/api/messages?channel_id=${channelId}&file_link=${encodeURIComponent(path)}`, auth)
      setThread(res)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  useEffect(() => { load(); loadChannels() }, [])
  useEffect(() => {
    if (selected) { loadVersions(selected); loadThread(selected, threadChannel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
  useEffect(() => {
    if (selected) loadThread(selected, threadChannel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadChannel])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter(f => `${f.name} ${f.path} ${f.modified_by}`.toLowerCase().includes(q))
  }, [files, query])

  const tree = useMemo(() => {
    const groups: Record<string, FileItem[]> = {}
    for (const f of filtered) {
      const d = dirOf(f.path) || '(root)'
      if (!groups[d]) groups[d] = []
      groups[d].push(f)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const shareFolder = async () => {
    if (!share.name.trim() || !share.path.trim()) return toast.error('Folder name and path required')
    try {
      await api('/api/files/share', { ...auth, method: 'POST', body: JSON.stringify(share) })
      toast.success(`Shared folder "${share.name}"`)
      setShare({ name: '', path: '' })
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const uploadFile = async (file: File) => {
    const rel = (uploadDir ? uploadDir.replace(/\/+$/, '') + '/' : '') + file.name
    setUploading(true)
    try {
      const total = Math.max(1, Math.ceil(file.size / CHUNK))
      for (let i = 0; i < total; i++) {
        const piece = file.slice(i * CHUNK, (i + 1) * CHUNK)
        const form = new FormData()
        form.append('file', piece, file.name)
        const res = await fetch(`/api/sync/chunk?path=${encodeURIComponent(rel)}&index=${i}&total=${total}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        })
        if (!res.ok) throw new Error(await res.text())
      }
      const done = await api(`/api/sync/complete?path=${encodeURIComponent(rel)}`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(done?.deduped ? `No changes (deduped), still v${done.version}` : `Uploaded ${rel} → v${done.version}`)
      load()
      setSelected(rel)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUploading(false)
    }
  }

  const downloadFile = async (path: string) => {
    try {
      const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').pop() || 'file'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { toast.error(e.message) }
  }

  const resolve = async (path: string, strategy: string) => {
    try {
      const res = await api(`/api/files/resolve?path=${encodeURIComponent(path)}&strategy=${strategy}`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(`Conflict resolved → v${res.winner_version} by ${res.by}`)
      loadVersions(path)
    } catch (e: any) { toast.error(e.message) }
  }

  const sendComment = async () => {
    if (!comment.trim() || !selected || !threadChannel) return
    const t = comment; setComment('')
    try {
      await api('/api/messages', {
        ...auth, method: 'POST',
        body: JSON.stringify({ channel_id: threadChannel, content: t, file_link: selected }),
      })
      loadThread(selected, threadChannel)
    } catch (e: any) { toast.error(e.message); setComment(t) }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid lg:grid-cols-3 gap-4 items-start">
      <Card className="lg:col-span-1">
        <h1 className="text-xl font-bold tracking-tight mb-1">Shared folders</h1>
        <p className="text-xs text-[var(--muted)] mb-3">Folder tree of everything synced on this node.</p>
        <div className="flex gap-2 mb-3">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search files…" aria-label="Search files" />
          <Button onClick={load} title="Refresh" aria-label="Refresh files"><RefreshCw size={15} /></Button>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
          <div className="text-sm font-medium mb-2">Share a folder</div>
          <div className="grid gap-2">
            <Input value={share.name} onChange={e => setShare({ ...share, name: e.target.value })} placeholder="Folder name (e.g. Thesis)" aria-label="Folder name" />
            <Input value={share.path} onChange={e => setShare({ ...share, path: e.target.value })} placeholder="Path (e.g. thesis/)" aria-label="Folder path" />
            <Button onClick={shareFolder}>Share folder</Button>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
          <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Upload size={14} /> Upload a file</div>
          <Input value={uploadDir} onChange={e => setUploadDir(e.target.value)} placeholder="Destination folder (optional, e.g. thesis/)" aria-label="Destination folder" />
          <label className="mt-2 block text-sm rounded-xl border border-dashed border-[var(--border)] p-3 text-center cursor-pointer hover:border-[var(--accent)] transition-colors">
            {uploading ? 'Uploading…' : 'Choose file (1 MB chunked upload)'}
            <input type="file" className="hidden" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
          </label>
        </div>

        <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
          {tree.map(([dir, items]) => {
            const isCollapsed = !!collapsed[dir]
            return (
              <div key={dir} className="rounded-xl border border-[var(--border)] overflow-hidden">
                <button
                  onClick={() => setCollapsed(c => ({ ...c, [dir]: !c[dir] }))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-[var(--card-hover)] hover:bg-[var(--card-hover)] transition-colors"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  {isCollapsed ? <Folder size={14} className="text-[var(--accent)]" /> : <FolderOpen size={14} className="text-[var(--accent)]" />}
                  <span className="font-medium truncate">{dir}</span>
                  <span className="ml-auto text-xs text-[var(--muted)]">{items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-[var(--border)]">
                    {items.map(f => (
                      <button
                        key={f.path}
                        onClick={() => setSelected(f.path)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-[rgba(139,92,246,0.15)] transition-colors ${selected === f.path ? 'bg-[rgba(139,92,246,0.15)]' : ''}`}
                      >
                        <div className="font-medium truncate">{f.name}</div>
                        <div className="text-xs text-[var(--muted)] truncate">{f.path} · v{f.version} · {f.hash || 'no hash yet'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {tree.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-8">No files match. Share a folder or upload a file.</p>
          )}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        {!selected ? (
          <div className="h-full min-h-[300px] flex items-center justify-center text-sm text-[var(--muted)] text-center p-8">
            Select a file on the left to see versions, download, resolve conflicts, and its comment thread.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-bold truncate">{selected.split('/').pop()}</h2>
                <p className="text-xs text-[var(--muted)] truncate">{selected}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button onClick={() => downloadFile(selected)}><span className="flex items-center gap-1.5"><Download size={14} /> Download</span></Button>
                <Link to={`/chat?file=${encodeURIComponent(selected)}`}>
                  <Button variant="secondary"><span className="flex items-center gap-1.5"><MessageSquare size={14} /> Open in Chat</span></Button>
                </Link>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5"><History size={14} /> Version history</h3>
              <div className="space-y-2 max-h-56 overflow-auto">
                {versions.map(v => (
                  <div key={v.version} className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">v{v.version}</span>
                      <span className="font-mono text-[var(--muted)]">{v.hash.slice(0, 12)}</span>
                      <span className="text-[var(--muted)]">{v.size} bytes · by {v.by}</span>
                      <span className="ml-auto text-[var(--muted)]">{new Date(v.at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {versions.length === 0 && <p className="text-xs text-[var(--muted)]">No versions recorded yet.</p>}
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="secondary" onClick={() => resolve(selected, 'latest')}><span className="flex items-center gap-1.5"><ShieldCheck size={14} /> Keep latest</span></Button>
                <Button variant="secondary" onClick={() => resolve(selected, 'keep-mine')}>Keep mine</Button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5"><MessageSquare size={14} /> Comments on this file</h3>
              <div className="flex gap-2 mb-2">
                <select
                  value={threadChannel ?? ''}
                  onChange={e => setThreadChannel(e.target.value ? Number(e.target.value) : null)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
                  aria-label="Comment channel"
                >
                  {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
                <span className="text-xs text-[var(--muted)] self-center">Thread: {selected}</span>
              </div>
              <div className="space-y-2 max-h-56 overflow-auto mb-2">
                {thread.map(m => (
                  <div key={m.id} className="rounded-xl bg-[var(--card)] p-2.5 text-sm">
                    <span className="font-medium">{m.sender}:</span> {m.content}
                    <span className="ml-2 text-xs text-[var(--muted)]">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                ))}
                {thread.length === 0 && <p className="text-xs text-[var(--muted)]">No comments yet — start the discussion.</p>}
              </div>
              <div className="flex gap-2">
                <Input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendComment()} placeholder={`Comment on ${selected.split('/').pop()}…`} aria-label="File comment" />
                <Button onClick={sendComment}>Send</Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
