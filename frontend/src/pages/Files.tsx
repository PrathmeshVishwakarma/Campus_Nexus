import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import {
  ChevronDown, ChevronRight, Download, FileText, Folder, FolderOpen, FolderSearch, FolderUp,
  Lock, MessageSquare, RefreshCw, Trash2, Upload, History, ShieldCheck,
  Settings2, Users, Activity, Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, useAuth } from '../store/useAuth'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type TreeFile = { name: string; path: string; type: 'file'; size: number; version: number; hash: string; modified_by: string }
type TreeDir = { name: string; path: string; type: 'dir'; children: TreeNode[]; locked?: boolean; members?: string[] }
type TreeNode = TreeFile | TreeDir
type Version = { version: number; hash: string; size: number; by: string; at: string; chunks: unknown; clock: Record<string, number> }
type AuditItem = { id: string; type: string; actor: string; resource: string; priority: number; payload: any; timestamp: string }
type FolderInfo = { name: string; path: string; members: string[]; locked: boolean; files: number }
type UserItem = { username: string; email: string; role: string }
type DiffItem = { path: string; status: 'new' | 'unchanged' | 'changed' | 'invalid' | 'forbidden'; server_size: number }

const CHUNK = 1024 * 1024

async function sha256Blob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function isDir(n: TreeNode): n is TreeDir { return n.type === 'dir' }

export default function Files() {
  const { token, user } = useAuth()
  const [tree, setTree] = useState<TreeDir | null>(null)
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [rootPath, setRootPath] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState<UserItem[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })
  const [versions, setVersions] = useState<Version[]>([])
  const [activity, setActivity] = useState<AuditItem[]>([])
  const [tab, setTab] = useState<'versions' | 'activity'>('versions')
  // modals
  const [showUpload, setShowUpload] = useState(false)
  const [showRoot, setShowRoot] = useState(false)
  const [showAccess, setShowAccess] = useState<string | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newRoot, setNewRoot] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [accessPick, setAccessPick] = useState<string[]>([])
  const [uploadDir, setUploadDir] = useState('')
  const [uploadMode, setUploadMode] = useState<'choose' | 'new'>('choose')
  const [uploadNew, setUploadNew] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; isDir: boolean } | null>(null)
  // folder-upload flow: picked files -> conflict diff -> upload -> share prompt
  const [folderPick, setFolderPick] = useState<{ base: string; files: { file: File; rel: string }[]; diff: DiffItem[]; overwrite: Record<string, boolean> } | null>(null)
  const [shareAfter, setShareAfter] = useState<string | null>(null)
  const [shareGlobal, setShareGlobal] = useState(true)
  const [sharePick, setSharePick] = useState<string[]>([])
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const auth = { headers: { Authorization: `Bearer ${token}` } }

  const load = async () => {
    try {
      const [t, f, r] = await Promise.all([
        api('/api/files/tree', auth),
        api('/api/files/folders', auth),
        api('/api/files/root', auth),
      ])
      setTree(t); setFolders(f); setRootPath(r.path)
      setExpanded(prev => ({ '': true, ...prev }))
    } catch (e: any) { toast.error(e.message) }
  }

  const loadMe = async () => {
    try {
      const me = await api('/api/auth/me', auth)
      setIsAdmin((me.role || '').toLowerCase() === 'admin')
      const us = await api('/api/auth/users', auth)
      setUsers(us)
    } catch { /* optional */ }
  }

  const loadDetail = async (path: string) => {
    try {
      const [v, a] = await Promise.all([
        api(`/api/files/versions?path=${encodeURIComponent(path)}`, auth),
        api(`/api/files/activity?path=${encodeURIComponent(path)}`, auth),
      ])
      setVersions(v); setActivity(a)
    } catch (e: any) { toast.error(e.message) }
  }

  useEffect(() => { load(); loadMe() }, [])
  useEffect(() => { if (selected) loadDetail(selected) }, [selected])

  const matches = (n: TreeNode, q: string): boolean => {
    if (!q) return true
    if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) return true
    return isDir(n) && n.children.some(c => matches(c, q))
  }

  const filteredTree = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!tree || !q) return tree
    const filt = (n: TreeNode): TreeNode | null => {
      if (!matches(n, q)) return null
      if (!isDir(n)) return n
      return { ...n, children: n.children.map(filt).filter(Boolean) as TreeNode[] }
    }
    return filt(tree) as TreeDir | null
  }, [tree, query])

  const selectedDir = useMemo(() => {
    if (!selected) return ''
    const i = selected.lastIndexOf('/')
    return i < 0 ? '' : selected.slice(0, i)
  }, [selected])

  // ---- actions ----
  const uploadOne = async (file: File, rel: string, onChunk?: (pct: number) => void) => {
    const total = Math.max(1, Math.ceil(file.size / CHUNK))
    let existing: string[] = []
    try {
      const m = await api(`/api/sync/manifest?path=${encodeURIComponent(rel)}`, auth)
      if (m.exists && Array.isArray(m.chunks)) existing = m.chunks.map((c: any) => c.hash as string)
    } catch { /* full upload */ }
    let skipped = 0
    for (let i = 0; i < total; i++) {
      const piece = file.slice(i * CHUNK, (i + 1) * CHUNK)
      if (existing[i]) {
        const h = await sha256Blob(piece)
        if (h === existing[i]) { skipped++; onChunk?.(Math.round(((i + 1) / total) * 100)); continue }
      }
      const form = new FormData()
      form.append('file', piece, file.name)
      const res = await fetch(`/api/sync/chunk?path=${encodeURIComponent(rel)}&index=${i}&total=${total}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      onChunk?.(Math.round(((i + 1) / total) * 100))
    }
    const done = await api(`/api/sync/complete?path=${encodeURIComponent(rel)}`, { ...auth, method: 'POST', body: JSON.stringify({}) })
    return { rel, version: done?.version, deduped: done?.deduped, skipped, total }
  }

  const uploadFiles = async (files: File[], baseDir = '') => {
    if (files.length === 0) return
    const dest = (baseDir || (uploadMode === 'new' ? uploadNew.trim() : uploadDir) || selectedDir).replace(/\/+$/, '')
    if (uploadMode === 'new' && (!dest || dest.includes('/'))) { toast.error('New subfolder must be a single folder name (no /)'); return }
    const dir = dest
    setProgress(0); setProgressLabel(files.length > 1 ? `1/${files.length} files` : files[0].name)
    try {
      let last = ''
      for (let i = 0; i < files.length; i++) {
        const rel = (dir ? dir + '/' : '') + files[i].name
        setProgressLabel(files.length > 1 ? `${i + 1}/${files.length} · ${files[i].name}` : files[i].name)
        const r = await uploadOne(files[i], rel, pct => setProgress(files.length > 1
          ? Math.round(((i + pct / 100) / files.length) * 100) : pct))
        last = r.rel
      }
      toast.success(files.length > 1 ? `Uploaded ${files.length} files` : `Uploaded ${last}`)
      setShowUpload(false)
      load(); setSelected(last)
    } catch (e: any) { toast.error(e.message) }
    finally { setProgress(null); setProgressLabel('') }
  }

  const onDrop = useCallback((acc: File[]) => { if (acc.length) uploadFiles(acc) }, [uploadDir, uploadMode, uploadNew, selectedDir, token])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true, disabled: progress !== null })

  const reveal = async (path?: string) => {
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : ''
      const res = await api(`/api/files/reveal${q}`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(`Opened in file browser: ${res.path}`)
    } catch (e: any) { toast.error(e.message, { duration: 6000 }) }
  }

  const downloadFile = async (path: string) => {    try {
      const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = path.split('/').pop() || 'file'; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { toast.error(e.message) }
  }

  const resolve = async (path: string, strategy: string) => {
    try {
      const res = await api(`/api/files/resolve?path=${encodeURIComponent(path)}&strategy=${strategy}`, { ...auth, method: 'POST', body: JSON.stringify({}) })
      toast.success(`Conflict resolved → v${res.winner_version} by ${res.by}`)
      loadDetail(path)
    } catch (e: any) { toast.error(e.message) }
  }

  const changeRoot = async () => {
    if (!newRoot.trim()) return toast.error('New root path required')
    try {
      const res = await api('/api/files/root', { ...auth, method: 'POST', body: JSON.stringify({ path: newRoot.trim() }) })
      toast.success(res.moved ? `Root moved (${res.files} files)` : 'Root unchanged')
      setShowRoot(false); setNewRoot(''); load()
    } catch (e: any) { toast.error(e.message) }
  }

  const openAccess = (sub: string) => {
    const f = folders.find(x => x.path === sub)
    setAccessPick(f?.members || [])
    setShowAccess(sub)
  }

  const saveAccess = async () => {
    if (!showAccess) return
    try {
      await api(`/api/files/folders?subfolder=${encodeURIComponent(showAccess)}`, { ...auth, method: 'POST', body: JSON.stringify({ members: accessPick }) })
      toast.success(`Access updated for "${showAccess}"`)
      setExpanded(e => ({ ...e, [showAccess]: true }))
      setShowAccess(null); load()
    } catch (e: any) { toast.error(e.message) }
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || /[\/]/.test(newFolderName)) return toast.error('Single folder name required (no /)')
    try {
      await api(`/api/files/folders?subfolder=${encodeURIComponent(newFolderName.trim())}`, { ...auth, method: 'POST', body: JSON.stringify({ members: [] }) })
      toast.success(`Folder "${newFolderName.trim()}" created (public)`)
      setShowNewFolder(false); setNewFolderName('')
      setExpanded(e => ({ ...e, [newFolderName.trim()]: true }))
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    try {
      const res = await api(`/api/files/item?path=${encodeURIComponent(confirmDelete.path)}`, { ...auth, method: 'DELETE' })
      toast.success(res.was_dir ? `Deleted folder "${res.path}" (${res.files} files)` : `Deleted "${res.path}"`)
      if (selected && (selected === res.path || selected.startsWith(res.path + '/'))) setSelected(null)
      setConfirmDelete(null); load()
    } catch (e: any) { toast.error(e.message) }
  }

  // ---- folder upload: pick -> diff -> conflicts -> upload -> share ----
  const onFolderPicked = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const all = Array.from(list)
    const top = (all[0] as any).webkitRelativePath?.split('/')[0] || 'upload'
    const rels = all.map(f => {
      const wr = (f as any).webkitRelativePath as string || f.name
      const parts = wr.split('/')
      parts[0] = top // normalize to the picked top folder name
      return { file: f, rel: parts.join('/') }
    })
    try {
      toast('Checking for existing files…')
      const hashed = await Promise.all(rels.map(async r => ({ path: r.rel, sha256: await sha256Blob(r.file), size: r.file.size })))
      const d = await api('/api/files/folder-diff', { ...auth, method: 'POST', body: JSON.stringify({ base: top, files: hashed }) })
      const diff: DiffItem[] = d.files
      const overwrite: Record<string, boolean> = {}
      diff.forEach(x => { if (x.status === 'changed') overwrite[x.path] = true })
      setShowUpload(false)
      setFolderPick({ base: top, files: rels, diff, overwrite })
    } catch (e: any) { toast.error(e.message) }
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const doFolderUpload = async () => {
    if (!folderPick) return
    const wanted = new Set<string>()
    folderPick.diff.forEach(d => {
      if (d.status === 'new') wanted.add(d.path)
      else if (d.status === 'changed' && folderPick.overwrite[d.path]) wanted.add(d.path)
    })
    const queue = folderPick.files.filter(f => wanted.has(f.rel))
    if (queue.length === 0) {
      toast('Nothing to upload — all files kept as-is')
      setFolderPick(null); return
    }
    setProgress(0); setProgressLabel(`Folder ${folderPick.base}: 1/${queue.length}`)
    try {
      for (let i = 0; i < queue.length; i++) {
        setProgressLabel(`Folder ${folderPick.base}: ${i + 1}/${queue.length} · ${queue[i].file.name}`)
        await uploadOne(queue[i].file, queue[i].rel, pct =>
          setProgress(Math.round(((i + pct / 100) / queue.length) * 100)))
      }
      toast.success(`Uploaded ${queue.length} files to "${folderPick.base}"`)
      setExpanded(e => ({ ...e, [folderPick.base]: true }))
      setFolderPick(null); load(); setSelected(null)
      // prompt sharing for the uploaded folder
      const f = folders.find(x => x.path === folderPick.base)
      setSharePick(f?.members || [])
      setShareGlobal(!(f && f.locked))
      setShareAfter(folderPick.base)
    } catch (e: any) { toast.error(e.message) }
    finally { setProgress(null); setProgressLabel('') }
  }

  const saveShareAfter = async () => {
    if (!shareAfter) return
    try {
      await api(`/api/files/folders?subfolder=${encodeURIComponent(shareAfter)}`, {
        ...auth, method: 'POST', body: JSON.stringify({ members: shareGlobal ? [] : sharePick }),
      })
      toast.success(shareGlobal ? `"${shareAfter}" shared globally` : `"${shareAfter}" shared with ${sharePick.length} user(s)`)
      setExpanded(e => ({ ...e, [shareAfter]: true }))
      setShareAfter(null); load()
    } catch (e: any) { toast.error(e.message) }
  }

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    if (!isDir(n)) {
      const active = selected === n.path
      return (
        <button key={n.path} onClick={() => setSelected(n.path)}
          className={`w-full text-left pl-${1} flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${active ? 'bg-[rgba(139,92,246,0.15)]' : 'hover:bg-[var(--card-hover)]'}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}>
          <FileText size={14} className="shrink-0 text-[var(--muted)]" />
          <span className="min-w-0"><span className="block font-medium truncate">{n.name}</span>
            <span className="block text-[11px] text-[var(--muted)] truncate">v{n.version} · {n.hash || 'new'}</span></span>
        </button>
      )
    }
    const key = n.path
    const open = expanded[key] ?? (depth < 1)
    const kids = n.children
    return (
      <div key={key || 'root'}>
        {depth > 0 && (
          <div className="flex items-center gap-1 group">
            <button onClick={() => setExpanded(e => ({ ...e, [key]: !open }))}
              className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--card-hover)] transition-colors"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {open ? <FolderOpen size={14} className="text-[var(--accent)]" /> : <Folder size={14} className="text-[var(--accent)]" />}
              <span className="font-medium truncate">{n.name}</span>
              {n.locked && <Lock size={12} className="text-amber-400 shrink-0" />}
              <span className="ml-auto text-[11px] text-[var(--muted)]">{kids.length}</span>
            </button>
            {isAdmin && (
              <button onClick={() => openAccess(n.path)} title={`Manage access to ${n.name}`}
                className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] opacity-0 group-hover:opacity-100 transition-opacity">
                <Users size={13} />
              </button>
            )}
            {depth === 1 && (
              <button onClick={() => setConfirmDelete({ path: n.path, isDir: true })} title={`Delete folder ${n.name}`}
                className="p-1.5 rounded-md text-[var(--muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
        {(open || depth === 0) && (
          <div>{[...kids].sort((a, b) => (isDir(a) === isDir(b) ? a.name.localeCompare(b.name) : isDir(a) ? -1 : 1)).map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
      {/* toolbar — uploads/settings live here so the tree owns the page */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">root <span className="text-[var(--muted)] font-normal text-sm">shared with all</span></h1>
          <p className="text-xs text-[var(--muted)] truncate" title={rootPath}>{rootPath}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search files…" aria-label="Search files" className="w-44" />
          <Button variant="secondary" onClick={load} title="Refresh"><RefreshCw size={15} /></Button>
          <Button variant="secondary" onClick={() => reveal()} title="Open shared root in Finder / File Explorer (server machine)">
            <span className="flex items-center gap-1.5"><FolderSearch size={14} /> Finder</span>
          </Button>
          <Button variant="secondary" onClick={() => { setUploadDir(selectedDir); setUploadMode('choose'); setUploadNew(''); setShowUpload(true) }}>
            <span className="flex items-center gap-1.5"><Upload size={14} /> Upload</span>
          </Button>
          <Button variant="secondary" onClick={() => folderInputRef.current?.click()} title="Upload an entire folder with conflict check + sharing">
            <span className="flex items-center gap-1.5"><FolderUp size={14} /> Folder</span>
          </Button>
          <input ref={folderInputRef} type="file" className="hidden"
            // @ts-expect-error webkitdirectory is non-standard but supported for folder pick
            webkitdirectory="" onChange={e => onFolderPicked(e.target.files)} />
          {isAdmin && (
            <>
              <Button variant="secondary" onClick={() => setShowNewFolder(true)}>
                <span className="flex items-center gap-1.5"><Plus size={14} /> Folder</span>
              </Button>
              <Button variant="secondary" onClick={() => { setNewRoot(rootPath); setShowRoot(true) }} title="Change root location">
                <span className="flex items-center gap-1.5"><Settings2 size={14} /> Root</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        {/* tree — majority of the page */}
        <Card className="lg:col-span-3 p-3">
          <div className="max-h-[64vh] overflow-auto pr-1">
            {filteredTree ? renderNode(filteredTree, 0) : <p className="text-sm text-[var(--muted)] text-center py-8">No files yet — upload one.</p>}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--muted)] flex-wrap">
            <span className="flex items-center gap-1"><Lock size={11} className="text-amber-400" /> restricted subfolder</span>
            <span>{folders.filter(f => f.locked).length} restricted · {folders.length} subfolders</span>
          </div>
        </Card>

        {/* detail */}
        <Card className="lg:col-span-2">
          {!selected ? (
            <div className="min-h-[300px] flex items-center justify-center text-sm text-[var(--muted)] text-center p-8">
              Select a file in the tree to see versions, download, discuss, and audit.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 flex-wrap">
                <div className="min-w-0">
                  <h2 className="font-bold truncate">{selected.split('/').pop()}</h2>
                  <p className="text-xs text-[var(--muted)] truncate">{selected}</p>
                </div>
                <div className="ml-auto flex gap-2 flex-wrap">
                  <Button variant="secondary" onClick={() => reveal(selected)} title="Reveal in Finder / File Explorer (server machine)"><span className="flex items-center gap-1.5"><FolderSearch size={14} /> Reveal</span></Button>
                  <Button onClick={() => downloadFile(selected)}><span className="flex items-center gap-1.5"><Download size={14} /> Download</span></Button>
                  <Link to={`/files/discussion?path=${encodeURIComponent(selected)}`}>
                    <Button variant="secondary"><span className="flex items-center gap-1.5"><MessageSquare size={14} /> Discuss</span></Button>
                  </Link>
                  <Button variant="destructive" onClick={() => setConfirmDelete({ path: selected, isDir: false })} title="Delete this file"><span className="flex items-center gap-1.5"><Trash2 size={14} /> Delete</span></Button>
                </div>
              </div>
              <div className="flex gap-1 text-sm border-b border-[var(--border)]">
                <button onClick={() => setTab('versions')} className={`px-3 py-1.5 flex items-center gap-1.5 ${tab === 'versions' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`}><History size={13} /> Versions</button>
                <button onClick={() => setTab('activity')} className={`px-3 py-1.5 flex items-center gap-1.5 ${tab === 'activity' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`}><Activity size={13} /> Audit</button>
              </div>
              {tab === 'versions' ? (
                <div>
                  <div className="space-y-2 max-h-64 overflow-auto">
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
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-auto">
                  {activity.map(a => (
                    <div key={a.id} className="rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs flex items-center gap-2">
                      <span className="font-bold text-[var(--accent)]">{a.type}</span>
                      <span>{a.actor}</span>
                      <span className="ml-auto text-[var(--muted)]">{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                  {activity.length === 0 && <p className="text-xs text-[var(--muted)]">No audit events for this file yet.</p>}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => progress === null && setShowUpload(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Upload to root</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Pick a destination inside the shared root. Access follows the subfolder.</p>
            <div className="flex gap-2">
              <select value={uploadMode === 'new' ? '__new__' : uploadDir}
                onChange={e => { if (e.target.value === '__new__') { setUploadMode('new') } else { setUploadMode('choose'); setUploadDir(e.target.value) } }}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
                aria-label="Destination subfolder">
                <option value="">root (no subfolder)</option>
                {folders.map(f => <option key={f.path} value={f.path}>{f.locked ? `🔒 ${f.name}` : f.name}</option>)}
                <option value="__new__">＋ New subfolder…</option>
              </select>
            </div>
            {uploadMode === 'new' && (
              <Input value={uploadNew} onChange={e => setUploadNew(e.target.value)} placeholder="New subfolder name" aria-label="New subfolder name" className="mt-2" />
            )}
            <div {...getRootProps()} className={`mt-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer text-sm ${isDragActive ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)]'} ${progress !== null ? 'opacity-50 pointer-events-none' : ''}`}>
              <input {...getInputProps()} />
              {progress !== null ? `Uploading… ${progressLabel} ${progress}%` : 'Drag & drop files here, or click to choose (multi-select, 1 MB chunks)'}
            </div>
            {progress !== null && <div className="mt-2"><div className="text-xs text-[var(--muted)] mb-1">{progressLabel}</div><div className="h-2 rounded-full bg-[var(--card-hover)] overflow-hidden"><div className="h-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} /></div></div>}
            <Button variant="secondary" onClick={() => setShowUpload(false)} disabled={progress !== null} className="w-full mt-3">Close</Button>
          </div>
        </div>
      )}

      {/* root move modal */}
      {showRoot && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowRoot(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Move shared root</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Same content, shifted: server copies everything to the new location, verifies, then deletes the old folder.</p>
            <Input value={newRoot} onChange={e => setNewRoot(e.target.value)} placeholder="/data/campus-root or shared/new_root" aria-label="New root path" />
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={() => setShowRoot(false)} className="flex-1">Cancel</Button>
              <Button onClick={changeRoot} className="flex-1">Move root</Button>
            </div>
          </div>
        </div>
      )}

      {/* new folder modal */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowNewFolder(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">New subfolder</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Created public — restrict via Manage access afterwards.</p>
            <Input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} placeholder="e.g. xyz-dept" aria-label="New subfolder name" />
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={() => setShowNewFolder(false)} className="flex-1">Cancel</Button>
              <Button onClick={createFolder} className="flex-1">Create</Button>
            </div>
          </div>
        </div>
      )}

      {/* access modal */}
      {showAccess && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAccess(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Access: {showAccess}</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Only picked members (+ admins) see this subfolder. Empty = public.</p>
            <div className="max-h-56 overflow-auto space-y-1 mb-3">
              {users.filter(u => u.username !== user).map(u => (
                <label key={u.username} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--card-hover)] cursor-pointer">
                  <input type="checkbox" checked={accessPick.includes(u.username)}
                    onChange={() => setAccessPick(p => p.includes(u.username) ? p.filter(x => x !== u.username) : [...p, u.username])} />
                  {u.username} <span className="text-xs text-[var(--muted)]">{u.role}</span>
                </label>
              ))}
              {users.length === 0 && <p className="text-xs text-[var(--muted)]">No other users yet.</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowAccess(null)} className="flex-1">Cancel</Button>
              <Button onClick={saveAccess} className="flex-1">Save</Button>
            </div>
          </div>
        </div>
      )}
      {/* delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/40 bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1 text-red-400">Delete “{confirmDelete.path}”?</h3>
            <p className="text-sm text-[var(--muted)] mb-3">
              ⚠️ This permanently deletes {confirmDelete.isDir ? 'the folder and everything in it' : 'the file'} (versions + discussion included). This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={doDelete} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* folder-upload conflicts (Windows-style) */}
      {folderPick && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => progress === null && setFolderPick(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Upload folder “{folderPick.base}”</h3>
            <p className="text-xs text-[var(--muted)] mb-3">
              {folderPick.diff.filter(d => d.status === 'new').length} new ·{' '}
              {folderPick.diff.filter(d => d.status === 'unchanged').length} unchanged (skipped) ·{' '}
              {folderPick.diff.filter(d => d.status === 'changed').length} changed — choose Keep or Overwrite:
            </p>
            <div className="max-h-64 overflow-auto space-y-1.5 mb-3">
              {folderPick.diff.map(d => (
                <div key={d.path} className="flex items-center gap-2 text-sm rounded-lg bg-[var(--card-hover)] px-2.5 py-1.5">
                  <span className="flex-1 min-w-0 truncate font-mono text-xs">{d.path}</span>
                  {d.status === 'new' && <span className="text-[11px] font-bold text-emerald-400">NEW</span>}
                  {d.status === 'unchanged' && <span className="text-[11px] text-[var(--muted)]">same — skip</span>}
                  {d.status === 'changed' && (
                    <span className="flex gap-1 text-xs shrink-0">
                      <button onClick={() => setFolderPick(fp => fp && ({ ...fp, overwrite: { ...fp.overwrite, [d.path]: false } }))}
                        className={`px-2 py-0.5 rounded-md ${!folderPick.overwrite[d.path] ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)]'}`}>Keep</button>
                      <button onClick={() => setFolderPick(fp => fp && ({ ...fp, overwrite: { ...fp.overwrite, [d.path]: true } }))}
                        className={`px-2 py-0.5 rounded-md ${folderPick.overwrite[d.path] ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)]'}`}>Overwrite</button>
                    </span>
                  )}
                  {(d.status === 'invalid' || d.status === 'forbidden') && <span className="text-[11px] text-red-400">{d.status}</span>}
                </div>
              ))}
            </div>
            {progress !== null && <div className="mb-2"><div className="text-xs text-[var(--muted)] mb-1">{progressLabel}</div><div className="h-2 rounded-full bg-[var(--card-hover)] overflow-hidden"><div className="h-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} /></div></div>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setFolderPick(null)} disabled={progress !== null} className="flex-1">Cancel</Button>
              <Button onClick={doFolderUpload} disabled={progress !== null} className="flex-1">Upload</Button>
            </div>
          </div>
        </div>
      )}

      {/* share prompt after folder upload */}
      {shareAfter && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShareAfter(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">Share “{shareAfter}”</h3>
            <p className="text-xs text-[var(--muted)] mb-3">Who should see this folder?</p>
            <label className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 bg-[var(--card-hover)] cursor-pointer mb-2">
              <input type="checkbox" checked={shareGlobal} onChange={e => setShareGlobal(e.target.checked)} />
              Share globally (everyone)
            </label>
            {!shareGlobal && (
              <div className="max-h-48 overflow-auto space-y-1 mb-3">
                {users.filter(u => u.username !== user).map(u => (
                  <label key={u.username} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--card-hover)] cursor-pointer">
                    <input type="checkbox" checked={sharePick.includes(u.username)}
                      onChange={() => setSharePick(p => p.includes(u.username) ? p.filter(x => x !== u.username) : [...p, u.username])} />
                    {u.username} <span className="text-xs text-[var(--muted)]">{u.role}</span>
                  </label>
                ))}
                {users.length === 0 && <p className="text-xs text-[var(--muted)]">No other users yet.</p>}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShareAfter(null)} className="flex-1">Skip</Button>
              <Button onClick={saveShareAfter} className="flex-1">Share</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
