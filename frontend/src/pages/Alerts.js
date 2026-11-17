import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../store/useAuth';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
const PRIORITIES = ['ALL', 'CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'];
const dot = {
    CRITICAL: 'var(--error)', URGENT: 'var(--warning)', IMPORTANT: 'var(--accent)',
    NORMAL: 'var(--muted)', INFO: 'var(--muted)',
};
const tabColor = {
    CRITICAL: 'rgba(239,68,68,0.15)', URGENT: 'rgba(245,158,11,0.15)',
    IMPORTANT: 'rgba(139,92,246,0.15)', NORMAL: 'rgba(136,146,176,0.1)', INFO: 'rgba(136,146,176,0.1)',
};
export default function Alerts() {
    const { token, user } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const [form, setForm] = useState({ title: '', body: '', priority: 'URGENT' });
    const [filter, setFilter] = useState('ALL');
    const [ranked, setRanked] = useState(false);
    const [receipts, setReceipts] = useState({});
    const [openReceipts, setOpenReceipts] = useState({});
    const [users, setUsers] = useState([]);
    const [targets, setTargets] = useState([]);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const load = async (silent = false) => {
        try {
            const res = filter !== 'ALL'
                ? await api(`/api/alerts?priority=${filter}`, auth)
                : await api('/api/alerts', auth);
            setAlerts(res);
            setRanked(false);
        }
        catch (e) {
            if (!silent)
                toast.error(e.message);
        }
    };
    useEffect(() => { load(); }, []);
    useEffect(() => { load(); }, [filter]);
    useEffect(() => {
        api('/api/auth/users', auth).then(setUsers).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);
    // Live refresh: alert broadcasts/acks reload the list + open receipts.
    const loadRef = useRef(load);
    loadRef.current = load;
    const receiptsRef = useRef(receipts);
    receiptsRef.current = receipts;
    const openRef = useRef(openReceipts);
    openRef.current = openReceipts;
    useEffect(() => {
        if (!token)
            return;
        let alive = true;
        let ws = null;
        let retry = 0;
        let retryTimer = null;
        let pingTimer = null;
        let reloadTimer = null;
        const refresh = () => {
            if (reloadTimer)
                clearTimeout(reloadTimer);
            reloadTimer = setTimeout(async () => {
                loadRef.current(true);
                for (const id of Object.keys(openRef.current)) {
                    if (!openRef.current[id])
                        continue;
                    try {
                        const rows = await api(`/api/alerts/${id}/receipts`, auth);
                        setReceipts(r => ({ ...r, [id]: rows }));
                    }
                    catch { /* keep old */ }
                }
            }, 250);
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
            ws.onmessage = (m) => {
                if (!alive)
                    return;
                try {
                    const e = JSON.parse(m.data);
                    if (e.event === 'ALERT_CREATED' || e.event === 'ALERT_ACKNOWLEDGED')
                        refresh();
                }
                catch { /* ignore */ }
            };
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
            if (retryTimer)
                clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { if (alive)
                connect(); }, Math.min(1000 * 2 ** retry, 10000));
        };
        connect();
        pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ action: 'PING' }));
                }
                catch { }
            }
        }, 25000);
        const poll = setInterval(() => { if (alive && !document.hidden)
            refresh(); }, 10000);
        return () => {
            alive = false;
            clearInterval(poll);
            if (pingTimer)
                clearInterval(pingTimer);
            if (retryTimer)
                clearTimeout(retryTimer);
            if (reloadTimer)
                clearTimeout(reloadTimer);
            try {
                ws?.close();
            }
            catch { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);
    const create = async () => {
        if (!form.title.trim())
            return toast.error('Title required');
        try {
            await api('/api/alerts', {
                ...auth, method: 'POST',
                body: JSON.stringify({ ...form, target_scope: targets.length ? 'selected' : 'all', target_users: targets }),
            });
            setForm({ title: '', body: '', priority: 'URGENT' });
            setTargets([]);
            toast.success(targets.length
                ? `Alert sent to ${targets.length} user${targets.length === 1 ? '' : 's'}`
                : 'Alert broadcast to everyone');
            load();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const loadRanked = async () => {
        try {
            setAlerts(await api('/api/alerts/ranked', auth));
            setRanked(true);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const ack = async (id) => {
        try {
            const res = await api(`/api/alerts/${id}/ack`, { ...auth, method: 'POST', body: JSON.stringify({}) });
            toast.success(`Acknowledged (${res.latency_ms} ms)`);
            load();
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    const showReceipts = async (id) => {
        const willOpen = !openReceipts[id];
        setOpenReceipts(o => ({ ...o, [id]: willOpen }));
        if (!willOpen)
            return;
        try {
            const rows = await api(`/api/alerts/${id}/receipts`, auth);
            setReceipts(r => ({ ...r, [id]: rows }));
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    return (_jsxs("div", { className: "mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 grid md:grid-cols-2 gap-4 items-start", children: [_jsxs(Card, { children: [_jsxs("h2", { className: "text-lg font-bold flex items-center gap-2 mb-1", children: [_jsx(Bell, { size: 17, className: "text-[var(--accent)]" }), " Raise an alert"] }), _jsx("p", { className: "text-xs text-[var(--muted)] mb-3", children: "Broadcasts to every node. Delivery receipts are created per user; ask them to ACK." }), _jsxs("div", { className: "space-y-2", children: [_jsx(Input, { value: form.title, onChange: e => setForm({ ...form, title: e.target.value }), placeholder: "Title (e.g. Fire drill, Building B)", "aria-label": "Alert title" }), _jsx("textarea", { value: form.body, onChange: e => setForm({ ...form, body: e.target.value }), placeholder: "Body\u2026 (e.g. Evacuate via stairwell C)", rows: 3, className: "w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-sm text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)] resize-none", "aria-label": "Alert body" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: ['CRITICAL', 'URGENT', 'IMPORTANT', 'NORMAL', 'INFO'].map(p => (_jsx("button", { onClick: () => setForm({ ...form, priority: p }), className: `rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${form.priority === p ? 'border-[var(--accent)] bg-[rgba(139,92,246,0.2)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`, children: p }, p))) }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsx("span", { className: "text-xs font-medium text-[var(--muted)]", children: "Send to" }), _jsx("span", { className: "text-[11px] text-[var(--muted)]", children: targets.length ? `${targets.length} selected` : 'everyone' })] }), _jsxs("div", { className: "max-h-32 overflow-auto rounded-lg border border-[var(--border)] p-1.5 space-y-0.5", children: [users.filter(u => u.username !== user).map(u => (_jsxs("label", { className: "flex items-center gap-2 text-sm rounded-md px-2 py-1 hover:bg-[var(--card-hover)] cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: targets.includes(u.username), onChange: () => setTargets(t => t.includes(u.username) ? t.filter(x => x !== u.username) : [...t, u.username]) }), u.username, _jsx("span", { className: "text-[11px] text-[var(--muted)]", children: u.role })] }, u.username))), users.length === 0 && _jsx("p", { className: "text-xs text-[var(--muted)] px-2 py-1", children: "No other users yet \u2014 alert goes to everyone." })] }), _jsx("p", { className: "text-[11px] text-[var(--muted)] mt-1", children: "Leave empty to alert all users." })] }), _jsx(Button, { onClick: create, className: "w-full", children: targets.length ? `Send ${form.priority} alert to ${targets.length}` : `Broadcast ${form.priority} alert` })] })] }), _jsxs(Card, { children: [_jsxs("div", { className: "flex items-center gap-1 mb-3 flex-wrap", children: [PRIORITIES.map(p => (_jsx("button", { onClick: () => setFilter(p), className: `rounded-lg px-2.5 py-1 text-xs font-semibold transition-all border ${filter === p
                                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[rgba(139,92,246,0.15)]'
                                    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`, style: filter === p && p !== 'ALL' ? { background: tabColor[p] } : {}, children: p }, p))), _jsx(Button, { variant: "secondary", onClick: loadRanked, className: "ml-auto text-xs", children: "Smart rank" }), _jsx(Button, { variant: "secondary", onClick: () => load(), className: "text-xs", children: "\u21BA" })] }), ranked && _jsx("p", { className: "text-xs text-[var(--muted)] mb-2", children: "Sorted by smart rank (priority \u00D7 sender affinity \u00D7 recency)." }), _jsxs("div", { className: "space-y-2 max-h-[560px] overflow-auto", children: [alerts.map(a => (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--card)] p-3", children: [_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("span", { className: `mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${a.priority === 'CRITICAL' ? 'animate-pulse' : ''}`, style: { background: dot[a.priority] ?? 'var(--muted)',
                                                    boxShadow: a.priority === 'CRITICAL' ? '0 0 6px var(--error)' : undefined } }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "font-medium text-sm truncate", children: a.title }), _jsx("div", { className: "text-xs text-[var(--muted)]", children: a.body }), _jsxs("div", { className: "text-[11px] text-[var(--muted)] mt-1", children: [_jsx("span", { className: "font-semibold mr-1 px-1.5 py-0.5 rounded", style: { background: tabColor[a.priority] ?? 'transparent', color: dot[a.priority] }, children: a.priority }), "by ", a.sender, " \u00B7 ", new Date(a.created_at).toLocaleString(), " \u00B7 ", a.acked, "/", a.total, " acked", typeof a.score === 'number' && _jsxs("span", { children: [" \u00B7 score ", a.score] })] })] })] }), _jsxs("div", { className: "flex gap-2 mt-2 flex-wrap", children: [a.sender === user
                                                ? _jsx("span", { className: "text-xs text-emerald-400 self-center", children: "\u2713 You raised this" })
                                                : a.acked_by_me
                                                    ? _jsx("span", { className: "text-xs text-emerald-400 self-center", children: "\u2713 You acknowledged" })
                                                    : _jsx(Button, { onClick: () => ack(a.id), children: _jsxs("span", { className: "flex items-center gap-1.5 text-xs", children: [_jsx(CheckCheck, { size: 13 }), " Acknowledge"] }) }), _jsx(Button, { variant: "secondary", onClick: () => showReceipts(a.id), children: _jsxs("span", { className: "flex items-center gap-1.5 text-xs", children: [_jsx(ChevronDown, { size: 13, className: `transition-transform ${openReceipts[a.id] ? 'rotate-180' : ''}` }), "Who got it?"] }) })] }), openReceipts[a.id] && receipts[a.id] && (_jsx("div", { className: "mt-2 rounded-lg bg-[var(--card-hover)] p-2 text-[11px] space-y-1", children: receipts[a.id].map(r => (_jsxs("div", { className: "flex gap-2 flex-wrap", children: [_jsx("span", { className: "font-medium", children: r.user }), _jsxs("span", { className: "text-[var(--muted)]", children: ["delivered ", new Date(r.delivered_at).toLocaleTimeString()] }), r.acked_at
                                                    ? _jsxs("span", { className: "text-emerald-400", children: ["acked (", r.latency_ms, " ms)"] })
                                                    : _jsx("span", { className: "text-amber-400", children: "pending" })] }, r.user))) }))] }, a.id))), alerts.length === 0 && (_jsx("p", { className: "text-sm text-[var(--muted)] text-center py-8", children: "No alerts yet. Raise one on the left \u2014 it appears here with live ACK counts." }))] })] })] }));
}
