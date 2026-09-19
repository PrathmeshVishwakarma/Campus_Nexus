import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { ChevronDown, ChevronRight, Download, Folder, FolderOpen, MessageSquare, RefreshCw, Upload, History, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../store/useAuth';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
const CHUNK = 1024 * 1024;
function dirOf(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
}
/** Compute SHA-256 of a Blob using the Web Crypto API. */
async function sha256Blob(blob) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export default function Files() {
    const { token } = useAuth();
    const [files, setFiles] = useState([]);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    const [versions, setVersions] = useState([]);
    const [collapsed, setCollapsed] = useState({});
    const [share, setShare] = useState({ name: '', path: '' });
    const [progress, setProgress] = useState(null); // null=idle, 0-100=uploading
    const [uploadDir, setUploadDir] = useState('');
    const [folders, setFolders] = useState([]);
    // per-file comments
    const [channels, setChannels] = useState([]);
    const [threadChannel, setThreadChannel] = useState(null);
    const [thread, setThread] = useState([]);
    const [comment, setComment] = useState('');
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const load = async () => {
        try {
            const res = await api('/api/files', auth);
            setFiles(res);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const loadFolders = async () => {
        try {
            const res = await api('/api/files/folders', auth);
            setFolders(res);
        }
        catch { /* optional */ }
    };
    const loadChannels = async () => {
        try {
            const res = await api('/api/messages/channels', auth);
            setChannels(res);
            if (!threadChannel && res[0])
                setThreadChannel(res[0].id);
        }
        catch { /* chat optional */ }
    };
    const loadVersions = async (path) => {
        try {
            const res = await api(`/api/files/versions?path=${encodeURIComponent(path)}`, auth);
            setVersions(res);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const loadThread = async (path, channelId) => {
        if (!channelId)
            return;
        try {
            const res = await api(`/api/messages?channel_id=${channelId}&file_link=${encodeURIComponent(path)}`, auth);
            setThread(res);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    useEffect(() => { load(); loadChannels(); loadFolders(); }, []);
    useEffect(() => {
        if (selected) {
            loadVersions(selected);
            loadThread(selected, threadChannel);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);
    useEffect(() => {
        if (selected)
            loadThread(selected, threadChannel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [threadChannel]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return files;
        return files.filter(f => `${f.name} ${f.path} ${f.modified_by}`.toLowerCase().includes(q));
    }, [files, query]);
    const tree = useMemo(() => {
        const groups = {};
        for (const f of filtered) {
            const d = dirOf(f.path) || '(root)';
            if (!groups[d])
                groups[d] = [];
            groups[d].push(f);
        }
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [filtered]);
    const shareFolder = async () => {
        if (!share.name.trim() || !share.path.trim())
            return toast.error('Folder name and path required');
        try {
            await api('/api/files/share', { ...auth, method: 'POST', body: JSON.stringify(share) });
            toast.success(`Shared folder "${share.name}"`);
            setShare({ name: '', path: '' });
            load();
            loadFolders();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const toggleFolderSync = async (folder) => {
        try {
            const res = await api(`/api/files/folders/${folder.id}/sync-toggle`, { ...auth, method: 'PATCH' });
            toast.success(`Sync ${res.sync_enabled ? 'enabled' : 'disabled'} for "${folder.name}"`);
            loadFolders();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const uploadFile = async (file) => {
        const rel = (uploadDir ? uploadDir.replace(/\/+$/, '') + '/' : '') + file.name;
        setProgress(0);
        try {
            const total = Math.max(1, Math.ceil(file.size / CHUNK));
            // Delta sync: fetch manifest to discover which chunks already exist on server
            let existingChunkHashes = [];
            try {
                const manifest = await api(`/api/sync/manifest?path=${encodeURIComponent(rel)}`, auth);
                if (manifest.exists && Array.isArray(manifest.chunks)) {
                    existingChunkHashes = manifest.chunks.map((c) => c.hash);
                }
            }
            catch { /* manifest optional — fall back to full upload */ }
            let skipped = 0;
            for (let i = 0; i < total; i++) {
                const piece = file.slice(i * CHUNK, (i + 1) * CHUNK);
                // Compare local chunk hash with server manifest to skip unchanged chunks
                if (existingChunkHashes[i]) {
                    const localHash = await sha256Blob(piece);
                    if (localHash === existingChunkHashes[i]) {
                        skipped++;
                        setProgress(Math.round(((i + 1) / total) * 100));
                        continue;
                    }
                }
                const form = new FormData();
                form.append('file', piece, file.name);
                const res = await fetch(`/api/sync/chunk?path=${encodeURIComponent(rel)}&index=${i}&total=${total}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: form,
                });
                if (!res.ok)
                    throw new Error(await res.text());
                setProgress(Math.round(((i + 1) / total) * 100));
            }
            const done = await api(`/api/sync/complete?path=${encodeURIComponent(rel)}`, { ...auth, method: 'POST', body: JSON.stringify({}) });
            const skipMsg = skipped > 0 ? ` (${skipped}/${total} chunks skipped — delta sync)` : '';
            toast.success(done?.deduped ? `No changes (deduped), still v${done.version}` : `Uploaded ${rel} → v${done.version}${skipMsg}`);
            load();
            setSelected(rel);
        }
        catch (e) {
            toast.error(e.message);
        }
        finally {
            setProgress(null);
        }
    };
    // react-dropzone integration
    const onDrop = useCallback((accepted) => {
        if (accepted[0])
            uploadFile(accepted[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadDir, token]);
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        multiple: false,
        disabled: progress !== null,
    });
    const downloadFile = async (path) => {
        try {
            const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok)
                throw new Error(await res.text());
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path.split('/').pop() || 'file';
            a.click();
            URL.revokeObjectURL(url);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const resolve = async (path, strategy) => {
        try {
            const res = await api(`/api/files/resolve?path=${encodeURIComponent(path)}&strategy=${strategy}`, { ...auth, method: 'POST', body: JSON.stringify({}) });
            toast.success(`Conflict resolved → v${res.winner_version} by ${res.by}`);
            loadVersions(path);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const sendComment = async () => {
        if (!comment.trim() || !selected || !threadChannel)
            return;
        const t = comment;
        setComment('');
        try {
            await api('/api/messages', {
                ...auth, method: 'POST',
                body: JSON.stringify({ channel_id: threadChannel, content: t, file_link: selected }),
            });
            loadThread(selected, threadChannel);
        }
        catch (e) {
            toast.error(e.message);
            setComment(t);
        }
    };
    return (_jsxs("div", { className: "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid lg:grid-cols-3 gap-4 items-start", children: [_jsxs(Card, { className: "lg:col-span-1", children: [_jsx("h1", { className: "text-xl font-bold tracking-tight mb-1", children: "Shared folders" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Folder tree of everything synced on this node." }), _jsxs("div", { className: "flex gap-2 mb-3", children: [_jsx(Input, { value: query, onChange: e => setQuery(e.target.value), placeholder: "Search files\u2026", "aria-label": "Search files" }), _jsx(Button, { onClick: load, title: "Refresh", "aria-label": "Refresh files", children: _jsx(RefreshCw, { size: 15 }) })] }), _jsxs("div", { className: "rounded-xl border border-[var(--border)] p-3 mb-3", children: [_jsx("div", { className: "text-sm font-medium mb-2", children: "Share a folder" }), _jsxs("div", { className: "grid gap-2", children: [_jsx(Input, { value: share.name, onChange: e => setShare({ ...share, name: e.target.value }), placeholder: "Folder name (e.g. Thesis)", "aria-label": "Folder name" }), _jsx(Input, { value: share.path, onChange: e => setShare({ ...share, path: e.target.value }), placeholder: "Path (e.g. thesis/)", "aria-label": "Folder path" }), _jsx(Button, { onClick: shareFolder, children: "Share folder" })] })] }), folders.length > 0 && (_jsxs("div", { className: "rounded-xl border border-[var(--border)] p-3 mb-3", children: [_jsx("div", { className: "text-sm font-medium mb-2", children: "Selective sync" }), _jsx("div", { className: "space-y-1.5", children: folders.map(f => (_jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "truncate text-[var(--fg)]", children: f.name }), _jsxs("button", { onClick: () => toggleFolderSync(f), className: "flex items-center gap-1 ml-2 shrink-0", title: f.sync_enabled ? 'Sync ON — click to disable' : 'Sync OFF — click to enable', "aria-label": `Toggle sync for ${f.name}`, children: [f.sync_enabled
                                                    ? _jsx(ToggleRight, { size: 18, className: "text-[var(--success)]" })
                                                    : _jsx(ToggleLeft, { size: 18, className: "text-[var(--muted)]" }), _jsx("span", { style: { color: f.sync_enabled ? 'var(--success)' : 'var(--muted)' }, children: f.sync_enabled ? 'ON' : 'OFF' })] })] }, f.id))) })] })), _jsxs("div", { className: "rounded-xl border border-[var(--border)] p-3 mb-3", children: [_jsxs("div", { className: "text-sm font-medium mb-2 flex items-center gap-1.5", children: [_jsx(Upload, { size: 14 }), " Upload a file"] }), _jsx(Input, { value: uploadDir, onChange: e => setUploadDir(e.target.value), placeholder: "Destination folder (optional, e.g. thesis/)", "aria-label": "Destination folder" }), _jsxs("div", { ...getRootProps(), className: `mt-2 rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors text-sm
              ${isDragActive
                                    ? 'border-[var(--accent)] bg-[rgba(139,92,246,0.08)] text-[var(--accent)]'
                                    : 'border-[var(--border)] hover:border-[var(--accent)] text-[var(--muted)]'}
              ${progress !== null ? 'opacity-50 pointer-events-none' : ''}`, children: [_jsx("input", { ...getInputProps() }), isDragActive
                                        ? '📂 Drop to upload…'
                                        : progress !== null
                                            ? `Uploading… ${progress}%`
                                            : 'Drag & drop a file here, or click to choose (1 MB chunks)'] }), progress !== null && (_jsxs("div", { className: "mt-2", children: [_jsxs("div", { className: "flex justify-between text-xs text-[var(--muted)] mb-1", children: [_jsx("span", { children: "Uploading\u2026" }), _jsxs("span", { children: [progress, "%"] })] }), _jsx("div", { className: "w-full h-2 rounded-full bg-[var(--card-hover)] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full transition-all duration-200", style: { width: `${progress}%`, background: 'var(--accent)' } }) })] }))] }), _jsxs("div", { className: "space-y-2 max-h-[420px] overflow-auto pr-1", children: [tree.map(([dir, items]) => {
                                const isCollapsed = !!collapsed[dir];
                                return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] overflow-hidden", children: [_jsxs("button", { onClick: () => setCollapsed(c => ({ ...c, [dir]: !c[dir] })), className: "w-full flex items-center gap-2 px-3 py-2 text-sm bg-[var(--card-hover)] hover:bg-[var(--card-hover)] transition-colors", children: [isCollapsed ? _jsx(ChevronRight, { size: 14 }) : _jsx(ChevronDown, { size: 14 }), isCollapsed ? _jsx(Folder, { size: 14, className: "text-[var(--accent)]" }) : _jsx(FolderOpen, { size: 14, className: "text-[var(--accent)]" }), _jsx("span", { className: "font-medium truncate", children: dir }), _jsx("span", { className: "ml-auto text-xs text-[var(--muted)]", children: items.length })] }), !isCollapsed && (_jsx("div", { className: "divide-y divide-[var(--border)]", children: items.map(f => (_jsxs("button", { onClick: () => setSelected(f.path), className: `w-full text-left px-3 py-2 text-sm hover:bg-[rgba(139,92,246,0.15)] transition-colors ${selected === f.path ? 'bg-[rgba(139,92,246,0.15)]' : ''}`, children: [_jsx("div", { className: "font-medium truncate", children: f.name }), _jsxs("div", { className: "text-xs text-[var(--muted)] truncate", children: [f.path, " \u00B7 v", f.version, " \u00B7 ", f.hash || 'no hash yet'] })] }, f.path))) }))] }, dir));
                            }), tree.length === 0 && (_jsx("p", { className: "text-sm text-[var(--muted)] text-center py-8", children: "No files match. Share a folder or upload a file." }))] })] }), _jsx(Card, { className: "lg:col-span-2", children: !selected ? (_jsx("div", { className: "h-full min-h-[300px] flex items-center justify-center text-sm text-[var(--muted)] text-center p-8", children: "Select a file on the left to see versions, download, resolve conflicts, and its comment thread." })) : (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start gap-2 flex-wrap", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "font-bold truncate", children: selected.split('/').pop() }), _jsx("p", { className: "text-xs text-[var(--muted)] truncate", children: selected })] }), _jsxs("div", { className: "ml-auto flex gap-2", children: [_jsx(Button, { onClick: () => downloadFile(selected), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Download, { size: 14 }), " Download"] }) }), _jsx(Link, { to: `/chat?file=${encodeURIComponent(selected)}`, children: _jsx(Button, { variant: "secondary", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(MessageSquare, { size: 14 }), " Open in Chat"] }) }) })] })] }), _jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-medium mb-2 flex items-center gap-1.5", children: [_jsx(History, { size: 14 }), " Version history"] }), _jsxs("div", { className: "space-y-2 max-h-56 overflow-auto", children: [versions.map(v => (_jsx("div", { className: "rounded-xl border border-[var(--border)] px-3 py-2 text-xs", children: _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("span", { className: "font-bold", children: ["v", v.version] }), _jsx("span", { className: "font-mono text-[var(--muted)]", children: v.hash.slice(0, 12) }), _jsxs("span", { className: "text-[var(--muted)]", children: [v.size, " bytes \u00B7 by ", v.by] }), _jsx("span", { className: "ml-auto text-[var(--muted)]", children: new Date(v.at).toLocaleString() })] }) }, v.version))), versions.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No versions recorded yet." })] }), _jsxs("div", { className: "flex gap-2 mt-2", children: [_jsx(Button, { variant: "secondary", onClick: () => resolve(selected, 'latest'), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(ShieldCheck, { size: 14 }), " Keep latest"] }) }), _jsx(Button, { variant: "secondary", onClick: () => resolve(selected, 'keep-mine'), children: "Keep mine" })] })] }), _jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-medium mb-2 flex items-center gap-1.5", children: [_jsx(MessageSquare, { size: 14 }), " Comments on this file"] }), _jsxs("div", { className: "flex gap-2 mb-2", children: [_jsx("select", { value: threadChannel ?? '', onChange: e => setThreadChannel(e.target.value ? Number(e.target.value) : null), className: "rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm", "aria-label": "Comment channel", children: channels.map(c => _jsxs("option", { value: c.id, children: ["#", c.name] }, c.id)) }), _jsxs("span", { className: "text-xs text-[var(--muted)] self-center", children: ["Thread: ", selected] })] }), _jsxs("div", { className: "space-y-2 max-h-56 overflow-auto mb-2", children: [thread.map(m => (_jsxs("div", { className: "rounded-xl bg-[var(--card)] p-2.5 text-sm", children: [_jsxs("span", { className: "font-medium", children: [m.sender, ":"] }), " ", m.content, _jsx("span", { className: "ml-2 text-xs text-[var(--muted)]", children: new Date(m.created_at).toLocaleString() })] }, m.id))), thread.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No comments yet \u2014 start the discussion." })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Input, { value: comment, onChange: e => setComment(e.target.value), onKeyDown: e => e.key === 'Enter' && sendComment(), placeholder: `Comment on ${selected.split('/').pop()}…`, "aria-label": "File comment" }), _jsx(Button, { onClick: sendComment, children: "Send" })] })] })] })) })] }));
}
