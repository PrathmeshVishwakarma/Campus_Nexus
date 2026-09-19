import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { ChevronDown, ChevronRight, Download, FileText, Folder, FolderOpen, Lock, MessageSquare, RefreshCw, Upload, History, ShieldCheck, Settings2, Users, Activity, Plus, } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../store/useAuth';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
const CHUNK = 1024 * 1024;
async function sha256Blob(blob) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function isDir(n) { return n.type === 'dir'; }
export default function Files() {
    const { token, user } = useAuth();
    const [tree, setTree] = useState(null);
    const [folders, setFolders] = useState([]);
    const [rootPath, setRootPath] = useState('');
    const [isAdmin, setIsAdmin] = useState(false);
    const [users, setUsers] = useState([]);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    const [expanded, setExpanded] = useState({ '': true });
    const [versions, setVersions] = useState([]);
    const [activity, setActivity] = useState([]);
    const [tab, setTab] = useState('versions');
    // modals
    const [showUpload, setShowUpload] = useState(false);
    const [showRoot, setShowRoot] = useState(false);
    const [showAccess, setShowAccess] = useState(null);
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newRoot, setNewRoot] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [accessPick, setAccessPick] = useState([]);
    const [uploadDir, setUploadDir] = useState('');
    const [progress, setProgress] = useState(null);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const load = async () => {
        try {
            const [t, f, r] = await Promise.all([
                api('/api/files/tree', auth),
                api('/api/files/folders', auth),
                api('/api/files/root', auth),
            ]);
            setTree(t);
            setFolders(f);
            setRootPath(r.path);
            setExpanded(prev => ({ '': true, ...prev }));
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const loadMe = async () => {
        try {
            const me = await api('/api/auth/me', auth);
            setIsAdmin((me.role || '').toLowerCase() === 'admin');
            const us = await api('/api/auth/users', auth);
            setUsers(us);
        }
        catch { /* optional */ }
    };
    const loadDetail = async (path) => {
        try {
            const [v, a] = await Promise.all([
                api(`/api/files/versions?path=${encodeURIComponent(path)}`, auth),
                api(`/api/files/activity?path=${encodeURIComponent(path)}`, auth),
            ]);
            setVersions(v);
            setActivity(a);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    useEffect(() => { load(); loadMe(); }, []);
    useEffect(() => { if (selected)
        loadDetail(selected); }, [selected]);
    const matches = (n, q) => {
        if (!q)
            return true;
        if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
            return true;
        return isDir(n) && n.children.some(c => matches(c, q));
    };
    const filteredTree = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!tree || !q)
            return tree;
        const filt = (n) => {
            if (!matches(n, q))
                return null;
            if (!isDir(n))
                return n;
            return { ...n, children: n.children.map(filt).filter(Boolean) };
        };
        return filt(tree);
    }, [tree, query]);
    const selectedDir = useMemo(() => {
        if (!selected)
            return '';
        const i = selected.lastIndexOf('/');
        return i < 0 ? '' : selected.slice(0, i);
    }, [selected]);
    // ---- actions ----
    const uploadFile = async (file) => {
        const dir = (uploadDir || selectedDir).replace(/\/+$/, '');
        const rel = (dir ? dir + '/' : '') + file.name;
        setProgress(0);
        try {
            const total = Math.max(1, Math.ceil(file.size / CHUNK));
            let existing = [];
            try {
                const m = await api(`/api/sync/manifest?path=${encodeURIComponent(rel)}`, auth);
                if (m.exists && Array.isArray(m.chunks))
                    existing = m.chunks.map((c) => c.hash);
            }
            catch { /* full upload */ }
            let skipped = 0;
            for (let i = 0; i < total; i++) {
                const piece = file.slice(i * CHUNK, (i + 1) * CHUNK);
                if (existing[i]) {
                    const h = await sha256Blob(piece);
                    if (h === existing[i]) {
                        skipped++;
                        setProgress(Math.round(((i + 1) / total) * 100));
                        continue;
                    }
                }
                const form = new FormData();
                form.append('file', piece, file.name);
                const res = await fetch(`/api/sync/chunk?path=${encodeURIComponent(rel)}&index=${i}&total=${total}`, {
                    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
                });
                if (!res.ok)
                    throw new Error(await res.text());
                setProgress(Math.round(((i + 1) / total) * 100));
            }
            const done = await api(`/api/sync/complete?path=${encodeURIComponent(rel)}`, { ...auth, method: 'POST', body: JSON.stringify({}) });
            toast.success(done?.deduped ? `No changes (deduped), still v${done.version}` : `Uploaded ${rel} → v${done.version}${skipped ? ` (${skipped}/${total} skipped)` : ''}`);
            setShowUpload(false);
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
    const onDrop = useCallback((acc) => { if (acc[0])
        uploadFile(acc[0]); }, [uploadDir, selectedDir, token]);
    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false, disabled: progress !== null });
    const downloadFile = async (path) => {
        try {
            const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } });
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
            loadDetail(path);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const changeRoot = async () => {
        if (!newRoot.trim())
            return toast.error('New root path required');
        try {
            const res = await api('/api/files/root', { ...auth, method: 'POST', body: JSON.stringify({ path: newRoot.trim() }) });
            toast.success(res.moved ? `Root moved (${res.files} files)` : 'Root unchanged');
            setShowRoot(false);
            setNewRoot('');
            load();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const openAccess = (sub) => {
        const f = folders.find(x => x.path === sub);
        setAccessPick(f?.members || []);
        setShowAccess(sub);
    };
    const saveAccess = async () => {
        if (!showAccess)
            return;
        try {
            await api(`/api/files/folders?subfolder=${encodeURIComponent(showAccess)}`, { ...auth, method: 'POST', body: JSON.stringify({ members: accessPick }) });
            toast.success(`Access updated for "${showAccess}"`);
            setShowAccess(null);
            load();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const createFolder = async () => {
        if (!newFolderName.trim() || /[\/]/.test(newFolderName))
            return toast.error('Single folder name required (no /)');
        try {
            await api(`/api/files/folders?subfolder=${encodeURIComponent(newFolderName.trim())}`, { ...auth, method: 'POST', body: JSON.stringify({ members: [] }) });
            toast.success(`Folder "${newFolderName.trim()}" created (public)`);
            setShowNewFolder(false);
            setNewFolderName('');
            load();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const renderNode = (n, depth) => {
        if (!isDir(n)) {
            const active = selected === n.path;
            return (_jsxs("button", { onClick: () => setSelected(n.path), className: `w-full text-left pl-${1} flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${active ? 'bg-[rgba(139,92,246,0.15)]' : 'hover:bg-[var(--card-hover)]'}`, style: { paddingLeft: `${depth * 14 + 8}px` }, children: [_jsx(FileText, { size: 14, className: "shrink-0 text-[var(--muted)]" }), _jsxs("span", { className: "min-w-0", children: [_jsx("span", { className: "block font-medium truncate", children: n.name }), _jsxs("span", { className: "block text-[11px] text-[var(--muted)] truncate", children: ["v", n.version, " \u00B7 ", n.hash || 'new'] })] })] }, n.path));
        }
        const key = n.path;
        const open = expanded[key] ?? (depth < 1);
        const kids = n.children;
        return (_jsxs("div", { children: [depth > 0 && (_jsxs("div", { className: "flex items-center gap-1 group", children: [_jsxs("button", { onClick: () => setExpanded(e => ({ ...e, [key]: !open })), className: "flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--card-hover)] transition-colors", style: { paddingLeft: `${depth * 14 + 8}px` }, children: [open ? _jsx(ChevronDown, { size: 14 }) : _jsx(ChevronRight, { size: 14 }), open ? _jsx(FolderOpen, { size: 14, className: "text-[var(--accent)]" }) : _jsx(Folder, { size: 14, className: "text-[var(--accent)]" }), _jsx("span", { className: "font-medium truncate", children: n.name }), n.locked && _jsx(Lock, { size: 12, className: "text-amber-400 shrink-0" }), _jsx("span", { className: "ml-auto text-[11px] text-[var(--muted)]", children: kids.length })] }), isAdmin && (_jsx("button", { onClick: () => openAccess(n.path), title: `Manage access to ${n.name}`, className: "p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] opacity-0 group-hover:opacity-100 transition-opacity", children: _jsx(Users, { size: 13 }) }))] })), (open || depth === 0) && (_jsx("div", { children: [...kids].sort((a, b) => (isDir(a) === isDir(b) ? a.name.localeCompare(b.name) : isDir(a) ? -1 : 1)).map(c => renderNode(c, depth + 1)) }))] }, key || 'root'));
    };
    return (_jsxs("div", { className: "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap mb-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("h1", { className: "text-xl font-bold tracking-tight", children: ["root ", _jsx("span", { className: "text-[var(--muted)] font-normal text-sm", children: "shared with all" })] }), _jsx("p", { className: "text-xs text-[var(--muted)] truncate", title: rootPath, children: rootPath })] }), _jsxs("div", { className: "ml-auto flex items-center gap-2 flex-wrap", children: [_jsx(Input, { value: query, onChange: e => setQuery(e.target.value), placeholder: "Search files\u2026", "aria-label": "Search files", className: "w-44" }), _jsx(Button, { variant: "secondary", onClick: load, title: "Refresh", children: _jsx(RefreshCw, { size: 15 }) }), _jsx(Button, { variant: "secondary", onClick: () => { setUploadDir(selectedDir); setShowUpload(true); }, children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Upload, { size: 14 }), " Upload"] }) }), isAdmin && (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", onClick: () => setShowNewFolder(true), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Plus, { size: 14 }), " Folder"] }) }), _jsx(Button, { variant: "secondary", onClick: () => { setNewRoot(rootPath); setShowRoot(true); }, title: "Change root location", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Settings2, { size: 14 }), " Root"] }) })] }))] })] }), _jsxs("div", { className: "grid lg:grid-cols-5 gap-4 items-start", children: [_jsxs(Card, { className: "lg:col-span-3 p-3", children: [_jsx("div", { className: "max-h-[64vh] overflow-auto pr-1", children: filteredTree ? renderNode(filteredTree, 0) : _jsx("p", { className: "text-sm text-[var(--muted)] text-center py-8", children: "No files yet \u2014 upload one." }) }), _jsxs("div", { className: "mt-2 flex items-center gap-3 text-[11px] text-[var(--muted)] flex-wrap", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(Lock, { size: 11, className: "text-amber-400" }), " restricted subfolder"] }), _jsxs("span", { children: [folders.filter(f => f.locked).length, " restricted \u00B7 ", folders.length, " subfolders"] })] })] }), _jsx(Card, { className: "lg:col-span-2", children: !selected ? (_jsx("div", { className: "min-h-[300px] flex items-center justify-center text-sm text-[var(--muted)] text-center p-8", children: "Select a file in the tree to see versions, download, discuss, and audit." })) : (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-start gap-2 flex-wrap", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "font-bold truncate", children: selected.split('/').pop() }), _jsx("p", { className: "text-xs text-[var(--muted)] truncate", children: selected })] }), _jsxs("div", { className: "ml-auto flex gap-2", children: [_jsx(Button, { onClick: () => downloadFile(selected), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Download, { size: 14 }), " Download"] }) }), _jsx(Link, { to: `/files/discussion?path=${encodeURIComponent(selected)}`, children: _jsx(Button, { variant: "secondary", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(MessageSquare, { size: 14 }), " Discuss"] }) }) })] })] }), _jsxs("div", { className: "flex gap-1 text-sm border-b border-[var(--border)]", children: [_jsxs("button", { onClick: () => setTab('versions'), className: `px-3 py-1.5 flex items-center gap-1.5 ${tab === 'versions' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`, children: [_jsx(History, { size: 13 }), " Versions"] }), _jsxs("button", { onClick: () => setTab('activity'), className: `px-3 py-1.5 flex items-center gap-1.5 ${tab === 'activity' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] font-medium' : 'text-[var(--muted)]'}`, children: [_jsx(Activity, { size: 13 }), " Audit"] })] }), tab === 'versions' ? (_jsxs("div", { children: [_jsxs("div", { className: "space-y-2 max-h-64 overflow-auto", children: [versions.map(v => (_jsx("div", { className: "rounded-xl border border-[var(--border)] px-3 py-2 text-xs", children: _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("span", { className: "font-bold", children: ["v", v.version] }), _jsx("span", { className: "font-mono text-[var(--muted)]", children: v.hash.slice(0, 12) }), _jsxs("span", { className: "text-[var(--muted)]", children: [v.size, " bytes \u00B7 by ", v.by] }), _jsx("span", { className: "ml-auto text-[var(--muted)]", children: new Date(v.at).toLocaleString() })] }) }, v.version))), versions.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No versions recorded yet." })] }), _jsxs("div", { className: "flex gap-2 mt-2", children: [_jsx(Button, { variant: "secondary", onClick: () => resolve(selected, 'latest'), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(ShieldCheck, { size: 14 }), " Keep latest"] }) }), _jsx(Button, { variant: "secondary", onClick: () => resolve(selected, 'keep-mine'), children: "Keep mine" })] })] })) : (_jsxs("div", { className: "space-y-1.5 max-h-64 overflow-auto", children: [activity.map(a => (_jsxs("div", { className: "rounded-lg bg-[var(--card)] px-3 py-1.5 text-xs flex items-center gap-2", children: [_jsx("span", { className: "font-bold text-[var(--accent)]", children: a.type }), _jsx("span", { children: a.actor }), _jsx("span", { className: "ml-auto text-[var(--muted)]", children: new Date(a.timestamp).toLocaleString() })] }, a.id))), activity.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No audit events for this file yet." })] }))] })) })] }), showUpload && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => progress === null && setShowUpload(false), children: _jsxs("div", { className: "w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "Upload to root" }), _jsxs("p", { className: "text-xs text-[var(--muted)] mb-3", children: ["Destination inside the shared root (e.g. ", _jsx("span", { className: "font-mono", children: "xyz-dept" }), "). Access follows the subfolder."] }), _jsx(Input, { value: uploadDir, onChange: e => setUploadDir(e.target.value), placeholder: "Subfolder (optional)", "aria-label": "Destination subfolder" }), _jsxs("div", { ...getRootProps(), className: `mt-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer text-sm ${isDragActive ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)]'} ${progress !== null ? 'opacity-50 pointer-events-none' : ''}`, children: [_jsx("input", { ...getInputProps() }), progress !== null ? `Uploading… ${progress}%` : 'Drag & drop, or click to choose (1 MB chunks)'] }), progress !== null && _jsx("div", { className: "mt-2 h-2 rounded-full bg-[var(--card-hover)] overflow-hidden", children: _jsx("div", { className: "h-full transition-all", style: { width: `${progress}%`, background: 'var(--accent)' } }) }), _jsx(Button, { variant: "secondary", onClick: () => setShowUpload(false), disabled: progress !== null, className: "w-full mt-3", children: "Close" })] }) })), showRoot && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setShowRoot(false), children: _jsxs("div", { className: "w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "Move shared root" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Same content, shifted: server copies everything to the new location, verifies, then deletes the old folder." }), _jsx(Input, { value: newRoot, onChange: e => setNewRoot(e.target.value), placeholder: "/data/campus-root or shared/new_root", "aria-label": "New root path" }), _jsxs("div", { className: "flex gap-2 mt-3", children: [_jsx(Button, { variant: "secondary", onClick: () => setShowRoot(false), className: "flex-1", children: "Cancel" }), _jsx(Button, { onClick: changeRoot, className: "flex-1", children: "Move root" })] })] }) })), showNewFolder && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setShowNewFolder(false), children: _jsxs("div", { className: "w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "New subfolder" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Created public \u2014 restrict via Manage access afterwards." }), _jsx(Input, { value: newFolderName, onChange: e => setNewFolderName(e.target.value), onKeyDown: e => e.key === 'Enter' && createFolder(), placeholder: "e.g. xyz-dept", "aria-label": "New subfolder name" }), _jsxs("div", { className: "flex gap-2 mt-3", children: [_jsx(Button, { variant: "secondary", onClick: () => setShowNewFolder(false), className: "flex-1", children: "Cancel" }), _jsx(Button, { onClick: createFolder, className: "flex-1", children: "Create" })] })] }) })), showAccess && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setShowAccess(null), children: _jsxs("div", { className: "w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsxs("h3", { className: "font-bold mb-1", children: ["Access: ", showAccess] }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Only picked members (+ admins) see this subfolder. Empty = public." }), _jsxs("div", { className: "max-h-56 overflow-auto space-y-1 mb-3", children: [users.filter(u => u.username !== user).map(u => (_jsxs("label", { className: "flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--card-hover)] cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: accessPick.includes(u.username), onChange: () => setAccessPick(p => p.includes(u.username) ? p.filter(x => x !== u.username) : [...p, u.username]) }), u.username, " ", _jsx("span", { className: "text-xs text-[var(--muted)]", children: u.role })] }, u.username))), users.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No other users yet." })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: () => setShowAccess(null), className: "flex-1", children: "Cancel" }), _jsx(Button, { onClick: saveAccess, className: "flex-1", children: "Save" })] })] }) }))] }));
}
