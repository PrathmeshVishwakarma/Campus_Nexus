import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Activity, Bell, Files, MessageSquare, Search } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { api } from '../store/useAuth';
import { Card } from '../components/ui/card';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
export function Dashboard() {
    const [events, setEvents] = useState([]);
    const [query, setQuery] = useState('');
    const { user, token } = useAuth();
    useEffect(() => {
        api('/api/events?limit=200', { headers: { Authorization: `Bearer ${token}` } }).then(setEvents).catch(() => { });
        let alive = true;
        let ws = null;
        let retry = 0;
        let retryTimer = null;
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
                    const d = JSON.parse(m.data);
                    if (d.event === 'PONG' || d.event === 'TYPING')
                        return;
                    setEvents(prev => [{ id: d.data.id, type: d.event, actor: d.data.actor, resource: d.data.resource, timestamp: d.data.timestamp, priority: d.data.priority }, ...prev].slice(0, 500));
                }
                catch { }
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
            retry = Math.min(retry + 1, 5);
            const delay = Math.min(1000 * 2 ** retry, 10000);
            if (retryTimer)
                clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { if (alive)
                connect(); }, delay);
        };
        connect();
        const ping = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ action: 'PING' }));
                }
                catch { }
            }
        }, 25000);
        return () => { alive = false; clearInterval(ping); if (retryTimer)
            clearTimeout(retryTimer); try {
            ws?.close();
        }
        catch { } };
    }, [token]);
    const shown = events.filter(e => !query || `${e.type} ${e.actor} ${e.resource}`.toLowerCase().includes(query.toLowerCase()));
    const tiles = [
        { icon: Files, label: 'Files synced', getVal: () => events.filter(e => e.type.startsWith('SYNC')).length },
        { icon: MessageSquare, label: 'Messages', getVal: () => events.filter(e => e.type.startsWith('MESSAGE')).length },
        { icon: Bell, label: 'Alerts', getVal: () => events.filter(e => e.type.startsWith('ALERT')).length },
        { icon: Activity, label: 'Total events', getVal: () => events.length },
    ];
    // Build hourly bucketed data for the area chart
    const chartData = useMemo(() => {
        const now = Date.now();
        const buckets = {};
        // Last 12 hours, 1-hour slots
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now - i * 3600000);
            const label = `${d.getHours().toString().padStart(2, '0')}:00`;
            buckets[label] = 0;
        }
        for (const e of events) {
            if (!e.timestamp)
                continue;
            const t = new Date(e.timestamp);
            const age = now - t.getTime();
            if (age > 12 * 3600000)
                continue;
            const label = `${t.getHours().toString().padStart(2, '0')}:00`;
            if (label in buckets)
                buckets[label]++;
        }
        return Object.entries(buckets).map(([hour, count]) => ({ hour, count }));
    }, [events]);
    return (_jsx("div", { className: "min-h-screen bg-[var(--bg)] text-[var(--fg)] antialiased", children: _jsxs("div", { className: "relative overflow-x-hidden", children: [_jsx(motion.div, { style: {
                        position: 'fixed',
                        inset: 0,
                        pointerEvents: 'none',
                        background: 'linear-gradient(135deg, var(--bg-subtle) 0%, rgba(15,15,25,0.3) 100%)',
                    } }), _jsxs("div", { className: "relative z-10 min-h-screen", children: [_jsx("header", { className: "border-b border-[var(--border)] backdrop-blur-lg bg-[var(--card)]", children: _jsxs("div", { className: "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8", children: [_jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsxs("h1", { className: "text-3xl sm:text-4xl font-extrabold tracking-tight", children: ["Campus Nexus ", _jsx("span", { className: "text-[var(--accent)]", children: "live" })] }), _jsxs("div", { className: "flex items-center gap-2 bg-[var(--card-hover)] rounded-xl px-3 py-1.5 min-w-0 flex-1 sm:max-w-xs", children: [_jsx(Search, { size: 14, className: "text-muted-foreground shrink-0" }), _jsx("input", { value: query, onChange: e => setQuery(e.target.value), placeholder: "Search events, actors, files\u2026", className: "bg-transparent outline-none text-sm w-full placeholder-[var(--muted)] focus:outline-none" })] })] }), _jsxs("p", { className: "mt-2 text-sm text-[var(--muted)]", children: ["Welcome back, ", _jsx("span", { className: "font-medium", children: user || '' })] })] }) }), _jsx("main", { className: "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6", children: _jsxs("div", { className: "space-y-4", children: [_jsx(Card, { children: _jsx("div", { className: "grid grid-cols-2 lg:grid-cols-4 gap-3", children: tiles.map((t, i) => (_jsxs(Card, { className: "p-4 flex flex-col items-center gap-1.5 text-center", children: [_jsx(t.icon, { size: 16, className: "text-[var(--accent)]" }), _jsx("div", { className: "text-2xl font-bold leading-none", children: t.getVal() }), _jsx("div", { className: "text-[var(--muted)] text-xs sm:text-sm", children: t.label })] }, `${t.icon}-${i}`))) }) }), _jsxs(Card, { children: [_jsx("h2", { className: "text-[var(--accent)] font-semibold tracking-tight mb-3", children: "Events / Hour (last 12 h)" }), chartData.some(d => d.count > 0) ? (_jsx(ResponsiveContainer, { width: "100%", height: 180, children: _jsxs(AreaChart, { data: chartData, margin: { top: 4, right: 8, left: -20, bottom: 0 }, children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "evtGrad", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: "var(--accent)", stopOpacity: 0.3 }), _jsx("stop", { offset: "95%", stopColor: "var(--accent)", stopOpacity: 0 })] }) }), _jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "var(--border)" }), _jsx(XAxis, { dataKey: "hour", tick: { fontSize: 10, fill: 'var(--muted)' } }), _jsx(YAxis, { allowDecimals: false, tick: { fontSize: 10, fill: 'var(--muted)' } }), _jsx(Tooltip, { contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--accent)' }, itemStyle: { color: 'var(--fg)' } }), _jsx(Area, { type: "monotone", dataKey: "count", stroke: "var(--accent)", fill: "url(#evtGrad)", strokeWidth: 2, dot: false, name: "Events" })] }) })) : (_jsx("p", { className: "text-sm text-[var(--muted)] text-center py-8", children: "No events in the last 12 hours \u2014 activity will appear here in real time." }))] }), _jsxs(Card, { children: [_jsx("h2", { className: "text-lg font-bold tracking-tight mb-1", children: "Open a workspace" }), _jsx("p", { className: "text-sm text-[var(--muted)] mb-3", children: "Jump straight into files, chat, alerts, or the network view." }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3", children: [_jsxs(Link, { to: "/files", className: "rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors", children: [_jsxs("div", { className: "flex items-center gap-2 font-medium text-sm", children: [_jsx(Files, { size: 15, className: "text-[var(--accent)]" }), " Files"] }), _jsx("div", { className: "text-xs text-[var(--muted)] mt-1", children: "Browse the shared folder tree, upload, versions, per-file comments" })] }), _jsxs(Link, { to: "/chat", className: "rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors", children: [_jsxs("div", { className: "flex items-center gap-2 font-medium text-sm", children: [_jsx(MessageSquare, { size: 15, className: "text-[var(--accent)]" }), " Chat"] }), _jsx("div", { className: "text-xs text-[var(--muted)] mt-1", children: "Custom groups + 1:1 DMs, unread badges, file threads" })] }), _jsxs(Link, { to: "/alerts", className: "rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors", children: [_jsxs("div", { className: "flex items-center gap-2 font-medium text-sm", children: [_jsx(Bell, { size: 15, className: "text-[var(--accent)]" }), " Alerts"] }), _jsx("div", { className: "text-xs text-[var(--muted)] mt-1", children: "Raise a broadcast, track ACKs and delivery receipts" })] }), _jsxs(Link, { to: "/network", className: "rounded-xl border border-[var(--border)] bg-[var(--card-hover)] p-3 hover:bg-[var(--card-hover)] transition-colors", children: [_jsxs("div", { className: "flex items-center gap-2 font-medium text-sm", children: [_jsx(Activity, { size: 15, className: "text-[var(--accent)]" }), " Network"] }), _jsx("div", { className: "text-xs text-[var(--muted)] mt-1", children: "Peers, topology, scheduler queue, anomaly state" })] })] })] }), _jsxs(Card, { children: [_jsx("h2", { className: "text-[var(--accent)] font-semibold tracking-tight mb-3", children: "Event Timeline" }), _jsxs("p", { className: "text-[var(--muted)] text-sm mb-3", children: [shown.length, " of ", events.length, " events", query ? _jsxs(_Fragment, { children: [" matching ", _jsxs("span", { className: "font-medium text-[var(--accent)]", children: ["\"", query, "\""] })] }) : ''] }), _jsxs("div", { className: "space-y-2 max-h-[500px] overflow-auto pr-1", children: [shown.map(e => (_jsxs("div", { className: "rounded-xl bg-[var(--card)] p-3 flex items-stretch gap-3 transition-colors hover:bg-[var(--card-hover)]", children: [_jsx("span", { className: "w-1 rounded-full shrink-0", style: { background: getPriorityColor(e.priority) } }), _jsxs("div", { className: "flex-1 min-w-0 py-0.5", children: [_jsxs("div", { className: "flex items-baseline gap-2 flex-wrap", children: [_jsx("span", { className: "text-[11px] font-bold tracking-wider text-[var(--accent)]", children: e.type }), _jsx("span", { className: "text-xs text-[var(--muted)] ml-auto shrink-0", children: new Date(e.timestamp).toLocaleTimeString() })] }), _jsxs("div", { className: "font-medium text-sm truncate", children: [e.actor, " ", _jsxs("span", { className: "font-normal text-[var(--muted)]", children: ["\u2192 ", e.resource || '—'] })] })] })] }, e.id))), events.length === 0 && !query && (_jsx("div", { className: "p-6 text-[var(--muted)] text-center", children: "No events yet. Start by sharing a folder or sending a message." }))] })] })] }) })] })] }) }));
}
function getPriorityColor(priority) {
    if (priority >= 100)
        return 'var(--error)';
    if (priority >= 80)
        return 'var(--accent)';
    if (priority >= 60)
        return 'var(--success)';
    if (priority >= 40)
        return 'var(--warning)';
    return 'var(--muted)';
}
