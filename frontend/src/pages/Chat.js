import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { MoreVertical, Pencil, Plus, Send, Trash2, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../store/useAuth';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
export default function Chat() {
    const { user, token } = useAuth();
    const [params, setParams] = useSearchParams();
    const fileParam = params.get('file') || '';
    const [channels, setChannels] = useState([]);
    const [cid, setCid] = useState(null);
    const [msgs, setMsgs] = useState([]);
    const [text, setText] = useState('');
    const [unread, setUnread] = useState({});
    // new channel / DM form
    const [users, setUsers] = useState([]);
    const [showNew, setShowNew] = useState(false);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState('group');
    const [picked, setPicked] = useState([]);
    const [fileFilter, setFileFilter] = useState(fileParam);
    // 3-dot manage menu (fixed-position pop-out so the scrolling
    // channel list never clips it) + modals
    const [menu, setMenu] = useState(null);
    // A fixed menu detaches if the page scrolls — just close it.
    useEffect(() => {
        if (!menu)
            return;
        const close = () => setMenu(null);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [menu]);
    const [rename, setRename] = useState(null);
    const [addId, setAddId] = useState(null);
    const [addPick, setAddPick] = useState([]);
    const [removeId, setRemoveId] = useState(null);
    const [del, setDel] = useState(null);
    // Typing indicator: map of username → timeout handle
    const [typingUsers, setTypingUsers] = useState({});
    const typingTimers = useRef({});
    const sendTypingDebounce = useRef(null);
    const msgListRef = useRef(null);
    const msgEndRef = useRef(null);
    // Always show the latest message: scroll to bottom on new messages / channel switch
    useEffect(() => {
        msgEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [msgs, cid]);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const loadUsers = async () => {
        try {
            setUsers(await api('/api/auth/users', auth));
        }
        catch { /* optional */ }
    };
    const loadCh = async (silent = false) => {
        try {
            const res = await api('/api/messages/channels', auth);
            setChannels(res);
            if (!cid && res[0])
                setCid(res[0].id);
            // unread badges
            const counts = {};
            await Promise.all(res.map(async (c) => {
                try {
                    const r = await api(`/api/messages/unread/count?channel_id=${c.id}`, auth);
                    counts[c.id] = r.unread ?? 0;
                }
                catch {
                    counts[c.id] = 0;
                }
            }));
            setUnread(counts);
        }
        catch (e) {
            if (!silent)
                toast.error(e.message);
        }
    };
    const loadMsg = async (silent = false) => {
        if (!cid)
            return;
        try {
            const q = fileFilter ? `&file_link=${encodeURIComponent(fileFilter)}` : '';
            setMsgs(await api(`/api/messages?channel_id=${cid}${q}`, auth));
        }
        catch (e) {
            if (!silent) {
                toast.error(e.message);
                return;
            }
            // silent (live) path: channel may have been deleted elsewhere —
            // drop the selection instead of showing stale messages
            try {
                const rows = await api('/api/messages/channels', auth);
                if (!rows.some(c => c.id === cid)) {
                    setCid(null);
                    setMsgs([]);
                }
            }
            catch { /* stay as-is on failure */ }
        }
    };
    // Refs so one long-lived socket/interval always sees the current selection
    // without reconnecting on every channel switch.
    const cidRef = useRef(cid);
    cidRef.current = cid;
    const fileRef = useRef(fileFilter);
    fileRef.current = fileFilter;
    const userRef = useRef(user);
    userRef.current = user;
    useEffect(() => { loadCh(); loadUsers(); }, []);
    useEffect(() => { loadMsg(); }, [cid, fileFilter]);
    useEffect(() => { setFileFilter(fileParam); }, [fileParam]);
    // Keep latest loaders in refs so the long-lived socket/poll never
    // call a stale closure (the old bug: interval captured cid=null from
    // first render, so live MESSAGE_SENT never refreshed the open channel).
    const loadChRef = useRef(loadCh);
    loadChRef.current = loadCh;
    const loadMsgRef = useRef(loadMsg);
    loadMsgRef.current = loadMsg;
    // Live updates: WebSocket MESSAGE_SENT events for instant refresh,
    // plus a quiet 4s poll as fallback if the socket drops.
    useEffect(() => {
        let alive = true;
        let ws = null;
        let retry = 0;
        let retryTimer = null;
        let pingTimer = null;
        const onEvent = (raw) => {
            try {
                const e = JSON.parse(raw);
                if (e.event === 'TYPING') {
                    const chId = e.data?.payload?.channel_id ?? e.data?.channel_id;
                    const actor = e.data?.actor || '';
                    if (chId === cidRef.current && actor !== userRef.current) {
                        setTypingUsers(prev => ({ ...prev, [actor]: true }));
                        clearTimeout(typingTimers.current[actor]);
                        typingTimers.current[actor] = setTimeout(() => {
                            setTypingUsers(prev => { const n = { ...prev }; delete n[actor]; return n; });
                        }, 3000);
                    }
                    return;
                }
                if (e.event === 'PONG')
                    return;
                if (e.event !== 'MESSAGE_SENT')
                    return;
                const resource = e.data?.resource || '';
                const m = resource.match(/^channel:(\d+)/);
                // channel list can change on any message event (new/renamed/deleted channel)
                loadChRef.current(true);
                if (m && Number(m[1]) === cidRef.current)
                    loadMsgRef.current(true);
            }
            catch { /* ignore malformed frames */ }
        };
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        const connect = () => {
            if (!alive)
                return;
            try {
                ws = new WebSocket(`${scheme}://${location.host}/ws/events?token=${token}`);
            }
            catch {
                scheduleRetry();
                return;
            }
            ws.onopen = () => { retry = 0; };
            ws.onmessage = (msg) => { if (alive)
                onEvent(msg.data); };
            ws.onerror = () => { try {
                ws?.close();
            }
            catch { } };
            ws.onclose = () => { scheduleRetry(); };
        };
        const scheduleRetry = () => {
            if (!alive)
                return;
            if (pingTimer) {
                clearInterval(pingTimer);
                pingTimer = null;
            }
            retry = Math.min(retry + 1, 5);
            const delay = Math.min(1000 * 2 ** retry, 10000);
            if (retryTimer)
                clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { if (alive)
                connect(); }, delay);
        };
        connect();
        // heartbeat keeps Vite's dev proxy + idle connections alive
        pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ action: 'PING' }));
                }
                catch { }
            }
        }, 25000);
        const poll = setInterval(() => {
            if (alive && !document.hidden) {
                loadChRef.current(true);
                loadMsgRef.current(true);
            }
        }, 4000);
        return () => {
            alive = false;
            clearInterval(poll);
            if (pingTimer)
                clearInterval(pingTimer);
            if (retryTimer)
                clearTimeout(retryTimer);
            try {
                ws?.close();
            }
            catch { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);
    useEffect(() => {
        msgs.filter(m => !m.read && m.sender !== user).forEach(m => {
            api(`/api/messages/${m.id}/read`, { ...auth, method: 'PATCH' }).catch(() => { });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [msgs]);
    const sendTyping = () => {
        if (!cid)
            return;
        if (sendTypingDebounce.current)
            clearTimeout(sendTypingDebounce.current);
        sendTypingDebounce.current = setTimeout(() => {
            api(`/api/messages/typing?channel_id=${cid}`, { ...auth, method: 'POST' }).catch(() => { });
        }, 300);
    };
    const send = async () => {
        if (!text.trim() || !cid)
            return;
        const t = text;
        setText('');
        try {
            await api('/api/messages', { ...auth, method: 'POST', body: JSON.stringify({ channel_id: cid, content: t, file_link: fileFilter }) });
            loadMsg();
            loadCh();
        }
        catch (e) {
            toast.error(e.message);
            setText(t);
        }
    };
    const togglePick = (u) => {
        setPicked(p => p.includes(u) ? p.filter(x => x !== u) : [...p, u]);
    };
    const createChannel = async () => {
        if (!newName.trim())
            return toast.error('Give the conversation a name');
        if (newType === 'dm' && picked.length !== 1)
            return toast.error('Pick exactly 1 person for a DM');
        try {
            const res = await api('/api/messages/channels', {
                ...auth, method: 'POST',
                body: JSON.stringify({ name: newName.trim(), type: newType, members: picked }),
            });
            setNewName('');
            setPicked([]);
            setShowNew(false);
            toast.success(newType === 'dm' ? 'DM created' : 'Group created');
            await loadCh();
            setCid(res.id);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const active = useMemo(() => channels.find(c => c.id === cid), [channels, cid]);
    const toggleMenu = (c, e) => {
        if (menu?.id === c.id) {
            setMenu(null);
            return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        const MENU_H = 152; // approx height of the 4-item menu
        const left = Math.min(Math.max(8, r.right - 176), Math.max(8, window.innerWidth - 184));
        if (window.innerHeight - r.bottom < MENU_H + 8) {
            // no room below the button — pop upward, hugging the button
            setMenu({ id: c.id, bottom: Math.max(8, window.innerHeight - r.top + 4), left });
        }
        else {
            setMenu({ id: c.id, top: r.bottom + 4, left });
        }
    };
    const doRename = async () => {
        if (!rename || !rename.name.trim())
            return toast.error('Name cannot be empty');
        try {
            await api(`/api/messages/channels/${rename.id}`, { ...auth, method: 'PATCH', body: JSON.stringify({ name: rename.name.trim() }) });
            toast.success('Channel renamed');
            setRename(null);
            setMenu(null);
            loadCh();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const doAdd = async () => {
        if (addId == null || addPick.length === 0)
            return toast.error('Pick at least one person');
        try {
            await api(`/api/messages/channels/${addId}/members`, { ...auth, method: 'POST', body: JSON.stringify({ add: addPick }) });
            toast.success('Member(s) added');
            setAddId(null);
            setAddPick([]);
            setMenu(null);
            loadCh();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const doRemove = async (member) => {
        if (removeId == null)
            return;
        try {
            await api(`/api/messages/channels/${removeId}/members`, { ...auth, method: 'POST', body: JSON.stringify({ remove: [member] }) });
            toast.success(`${member} removed`);
            if (channels.find(c => c.id === removeId)?.members.length === 2)
                setRemoveId(null);
            loadCh();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const openDelete = async (c) => {
        setMenu(null);
        let count = 0;
        try {
            const rows = await api(`/api/messages?channel_id=${c.id}`, auth);
            count = rows.length;
        }
        catch { /* show modal anyway */ }
        setDel({ id: c.id, name: c.name, count });
    };
    const doDelete = async () => {
        if (!del)
            return;
        try {
            await api(`/api/messages/channels/${del.id}`, { ...auth, method: 'DELETE' });
            toast.success(`Deleted "${del.name}"`);
            if (cid === del.id) {
                setCid(null);
                setMsgs([]);
            }
            setDel(null);
            loadCh();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    return (_jsxs("div", { className: "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid md:grid-cols-3 gap-4 items-start", children: [_jsxs(Card, { children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx("h2", { className: "font-bold text-lg", children: "Chat" }), _jsx(Button, { onClick: () => setShowNew(v => !v), title: "New group or DM", "aria-label": "New conversation", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Plus, { size: 14 }), " New"] }) })] }), showNew && (_jsxs("div", { className: "rounded-xl border border-[var(--border)] p-3 mb-3 space-y-2", children: [_jsx(Input, { value: newName, onChange: e => setNewName(e.target.value), placeholder: "Group name (or DM title)", "aria-label": "Conversation name" }), _jsxs("div", { className: "flex gap-2 text-sm", children: [_jsxs("label", { className: "flex items-center gap-1.5", children: [_jsx("input", { type: "radio", checked: newType === 'group', onChange: () => setNewType('group') }), " Group"] }), _jsxs("label", { className: "flex items-center gap-1.5", children: [_jsx("input", { type: "radio", checked: newType === 'dm', onChange: () => setNewType('dm') }), " 1:1 DM"] })] }), _jsxs("div", { className: "text-xs text-[var(--muted)]", children: ["Members ", newType === 'dm' ? '(pick 1)' : '(pick any)'] }), _jsxs("div", { className: "max-h-36 overflow-auto space-y-1", children: [users.filter(u => u.username !== user).map(u => (_jsxs("label", { className: "flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-[var(--card-hover)] cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: picked.includes(u.username), onChange: () => togglePick(u.username) }), u.username] }, u.username))), users.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No other users yet \u2014 register a second account to DM." })] }), _jsxs(Button, { onClick: createChannel, className: "w-full", children: ["Create ", newType === 'dm' ? 'DM' : 'group'] })] })), _jsxs("div", { className: "space-y-1 max-h-[420px] overflow-auto", onScroll: () => setMenu(null), children: [channels.map(c => (_jsxs("div", { className: `w-full px-3 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors ${cid === c.id ? 'bg-[rgba(139,92,246,0.15)]' : 'hover:bg-[var(--card-hover)]'}`, children: [_jsxs("button", { onClick: () => { setCid(c.id); setParams(fileParam ? { file: fileParam } : {}); setMenu(null); }, className: "flex-1 min-w-0 text-left flex items-center gap-2", "aria-label": `Open ${c.name}`, children: [_jsx("span", { className: "text-[var(--accent)]", children: "#" }), _jsx("span", { className: "font-medium truncate", children: c.name }), _jsx("span", { className: "text-xs text-[var(--muted)]", children: c.type }), (unread[c.id] ?? 0) > 0 && (_jsx("span", { className: "text-[11px] font-bold rounded-full bg-[var(--accent)] text-white px-2 py-0.5", children: unread[c.id] })), cid === c.id && _jsx(UserCheck, { size: 13, className: "text-emerald-400" })] }), _jsx("button", { onClick: (e) => toggleMenu(c, e), className: "p-1 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)] transition-colors shrink-0", "aria-label": `Manage ${c.name}`, title: "Manage channel", children: _jsx(MoreVertical, { size: 15 }) })] }, c.id))), channels.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)]", children: "No conversations yet \u2014 create one above." })] }), menu && (() => {
                        const c = channels.find(x => x.id === menu.id);
                        if (!c)
                            return null;
                        // Portal to body: the glass Card's backdrop-filter would otherwise
                        // become the containing block for `fixed` and offset the menu.
                        return createPortal(_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-40", onClick: () => setMenu(null) }), _jsxs("div", { className: "fixed z-50 w-44 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-1 text-sm", style: { top: menu.top, bottom: menu.bottom, left: menu.left }, children: [_jsxs("button", { onClick: () => { setRename({ id: c.id, name: c.name }); setMenu(null); }, className: "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left", children: [_jsx(Pencil, { size: 13 }), " Rename"] }), _jsxs("button", { onClick: () => { setAddId(c.id); setAddPick([]); setMenu(null); }, className: "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left", children: [_jsx(UserPlus, { size: 13 }), " Add person"] }), _jsxs("button", { onClick: () => { setRemoveId(c.id); setMenu(null); }, className: "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-hover)] text-left", children: [_jsx(UserMinus, { size: 13 }), " Remove person"] }), _jsxs("button", { onClick: () => openDelete(c), className: "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[rgba(239,68,68,0.15)] text-left text-red-400", children: [_jsx(Trash2, { size: 13 }), " Delete\u2026"] })] })] }), document.body);
                    })()] }), _jsx(Card, { className: "md:col-span-2 flex flex-col min-h-[480px]", children: !cid ? (_jsx("p", { className: "text-sm text-[var(--muted)] text-center my-auto", children: "Pick a conversation on the left, or create a group / DM." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap pb-3 border-b border-[var(--border)] mb-3", children: [_jsxs("h2", { className: "font-bold", children: ["#", active?.name] }), _jsxs("span", { className: "text-xs text-[var(--muted)]", children: [active?.type, " \u00B7 ", active?.members.join(', ')] }), fileFilter ? (_jsxs("span", { className: "ml-auto text-xs rounded-full bg-[rgba(139,92,246,0.15)] text-[var(--accent)] px-2 py-1", children: ["File thread: ", fileFilter, _jsx("button", { onClick: () => { setFileFilter(''); setParams({}); }, className: "ml-1 underline", children: "clear" }), _jsx(Link, { to: `/files`, className: "ml-2 underline", children: "open file" })] })) : (_jsx("span", { className: "ml-auto text-xs text-[var(--muted)]", children: "Tip: open a file in Files \u2192 \u201COpen in Chat\u201D to discuss it here." }))] }), _jsxs("div", { ref: msgListRef, className: "flex-1 space-y-2 overflow-auto mb-3 max-h-[380px]", children: [msgs.map(m => (_jsxs("div", { className: "rounded-xl bg-[var(--card)] p-3 text-sm", children: [_jsx("span", { className: "font-medium", children: m.sender }), m.file_link && _jsxs("span", { className: "ml-2 text-xs text-[var(--accent)]", children: ["\uD83D\uDCCE ", m.file_link] }), _jsx("div", { className: "mt-0.5", children: m.content }), _jsxs("div", { className: "text-[11px] text-[var(--muted)] mt-1 flex items-center gap-1.5", children: [new Date(m.created_at).toLocaleString(), m.sender === user && (_jsx("span", { className: "font-bold", style: { color: m.read ? 'var(--accent)' : 'var(--muted)' }, title: m.read ? 'Read' : 'Delivered', children: m.read ? '✓✓' : '✓' }))] })] }, m.id))), msgs.length === 0 && _jsxs("p", { className: "text-xs text-[var(--muted)] text-center py-8", children: ["No messages", fileFilter ? ' in this file thread' : '', " \u2014 say hello."] }), _jsx("div", { ref: msgEndRef })] }), Object.keys(typingUsers).length > 0 && (_jsxs("div", { className: "text-xs text-[var(--muted)] mb-1 flex items-center gap-1.5 animate-pulse", children: [_jsxs("span", { className: "inline-flex gap-0.5", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce", style: { animationDelay: '0ms' } }), _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce", style: { animationDelay: '150ms' } }), _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce", style: { animationDelay: '300ms' } })] }), Object.keys(typingUsers).join(', '), " ", Object.keys(typingUsers).length === 1 ? 'is' : 'are', " typing\u2026"] })), _jsxs("div", { className: "flex gap-2", children: [_jsx(Input, { value: text, onChange: e => { setText(e.target.value); sendTyping(); }, onKeyDown: e => e.key === 'Enter' && send(), placeholder: fileFilter ? `Reply in thread ${fileFilter}…` : 'Message…', "aria-label": "Message input" }), _jsx(Button, { onClick: send, children: _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Send, { size: 14 }), " Send"] }) })] })] })) }), rename && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setRename(null), children: _jsxs("div", { className: "w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "Rename channel" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Names must be unique \u2014 renaming to an existing name is rejected." }), _jsx(Input, { value: rename.name, onChange: e => setRename({ ...rename, name: e.target.value }), onKeyDown: e => e.key === 'Enter' && doRename(), placeholder: "New channel name", "aria-label": "New channel name" }), _jsxs("div", { className: "flex gap-2 mt-3", children: [_jsx(Button, { variant: "secondary", onClick: () => setRename(null), className: "flex-1", children: "Cancel" }), _jsx(Button, { onClick: doRename, className: "flex-1", children: "Rename" })] })] }) })), addId != null && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setAddId(null), children: _jsxs("div", { className: "w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "Add person" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Only registered users can be added." }), _jsx("div", { className: "max-h-48 overflow-auto space-y-1 mb-3", children: users
                                .filter(u => u.username !== user && !(channels.find(c => c.id === addId)?.members.includes(u.username)))
                                .map(u => (_jsxs("label", { className: "flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--card-hover)] cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: addPick.includes(u.username), onChange: () => setAddPick(p => p.includes(u.username) ? p.filter(x => x !== u.username) : [...p, u.username]) }), u.username] }, u.username))) }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: () => setAddId(null), className: "flex-1", children: "Cancel" }), _jsx(Button, { onClick: doAdd, className: "flex-1", children: "Add selected" })] })] }) })), removeId != null && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setRemoveId(null), children: _jsxs("div", { className: "w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsx("h3", { className: "font-bold mb-1", children: "Remove person" }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "You cannot remove yourself \u2014 delete the channel instead." }), _jsxs("div", { className: "space-y-1 mb-3", children: [(channels.find(c => c.id === removeId)?.members || []).filter(m => m !== user).map(m => (_jsxs("div", { className: "flex items-center gap-2 text-sm rounded-lg px-2 py-1.5", children: [_jsx("span", { className: "flex-1", children: m }), _jsx(Button, { variant: "secondary", onClick: () => doRemove(m), children: _jsxs("span", { className: "flex items-center gap-1.5 text-xs", children: [_jsx(X, { size: 13 }), " Remove"] }) })] }, m))), (channels.find(c => c.id === removeId)?.members || []).filter(m => m !== user).length === 0 && (_jsx("p", { className: "text-xs text-[var(--muted)]", children: "No other members to remove." }))] }), _jsx(Button, { variant: "secondary", onClick: () => setRemoveId(null), className: "w-full", children: "Done" })] }) })), del && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", onClick: () => setDel(null), children: _jsxs("div", { className: "w-full max-w-sm rounded-2xl border border-red-500/40 bg-[var(--card)] p-4", onClick: e => e.stopPropagation(), children: [_jsxs("h3", { className: "font-bold mb-1 text-red-400", children: ["Delete \u201C", del.name, "\u201D?"] }), _jsxs("p", { className: "text-sm text-[var(--muted)] mb-3", children: ["\u26A0\uFE0F Warning: this permanently deletes the channel and all ", del.count, " message", del.count === 1 ? '' : 's', " in it. This cannot be undone."] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: () => setDel(null), className: "flex-1", children: "Cancel" }), _jsx(Button, { variant: "destructive", onClick: doDelete, className: "flex-1", children: "Delete" })] })] }) }))] }));
}
