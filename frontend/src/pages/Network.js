import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useRef } from 'react';
import { Wifi, Signal, Clock } from 'lucide-react';
import { toast } from 'sonner';
import * as d3 from 'd3';
import { api, useAuth } from '../store/useAuth';
export default function Network() {
    const { token } = useAuth();
    const [graph, setGraph] = useState(null);
    const [stats, setStats] = useState(null);
    const load = async () => {
        try {
            const [g, s] = await Promise.all([
                api('/api/network/graph', { headers: { Authorization: `Bearer ${token}` } }),
                api('/api/network/stats', { headers: { Authorization: `Bearer ${token}` } })
            ]);
            setGraph(g);
            setStats(s);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    useEffect(() => {
        load();
        const interval = setInterval(load, 8000);
        return () => clearInterval(interval);
    }, []);
    const discover = async () => {
        try {
            await api('/api/peers/discover', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({})
            });
            setTimeout(load, 1500);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    function getPriorityColor(priority) {
        if (priority >= 80)
            return 'var(--error)';
        if (priority >= 60)
            return 'var(--accent)';
        if (priority >= 40)
            return 'var(--success)';
        return 'var(--muted)';
    }
    function formatBytes(bytes) {
        if (bytes >= 1000000000)
            return `${(bytes / 1000000000).toFixed(2)} GB`;
        if (bytes >= 1000000)
            return `${(bytes / 1000000).toFixed(2)} MB`;
        if (bytes >= 1000)
            return `${(bytes / 1000).toFixed(2)} KB`;
        return `${bytes} B`;
    }
    return (_jsxs("div", { className: "mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Wifi, { size: 16, className: "text-[var(--accent)]" }), _jsx("h1", { className: "text-xl font-bold tracking-tight", children: "Network topology" }), _jsx("button", { onClick: discover, className: "ml-auto rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity", children: "Discover" })] }), _jsxs("div", { className: "grid md:grid-cols-2 gap-4", children: [_jsx("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden", children: graph ? _jsx(ForceGraph, { graph: graph }) : (_jsxs("div", { className: "p-8 text-[var(--muted)] text-center text-sm", children: [_jsx(Signal, { className: "w-12 h-12 mx-auto mb-4 opacity-30" }), _jsx("p", { children: "No peers discovered yet" }), _jsx("p", { className: "mt-2 text-xs", children: "Click \"Discover\" to find nodes on the LAN" })] })) }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4", children: [_jsx("h3", { className: "font-semibold mb-3", children: "Network Health" }), _jsxs("div", { className: "mb-4", children: [_jsxs("div", { className: "flex justify-between text-xs text-[var(--muted)] mb-1", children: [_jsx("span", { children: "Bandwidth (5 MB/s limit)" }), _jsx("span", { children: stats?.throttle ? formatBytes(stats.throttle.bps) + '/s' : '0 B/s' })] }), _jsx("div", { className: "w-full h-2 rounded-full bg-[var(--card-hover)] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full transition-all duration-500", style: {
                                                        width: `${Math.min(100, ((stats?.throttle?.bps || 0) / 5000000) * 100)}%`,
                                                        background: stats?.throttle?.congested ? 'var(--error)' : 'var(--accent)'
                                                    } }) })] }), _jsx("div", { className: "mb-4", children: (() => {
                                            const latencies = graph?.nodes.filter(n => n.id !== 'server').map(n => n.latency) || [];
                                            const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
                                            const latColor = avgLatency < 50 ? 'var(--success)' : avgLatency < 200 ? 'var(--warning)' : 'var(--error)';
                                            return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex justify-between text-xs text-[var(--muted)] mb-1", children: [_jsx("span", { children: "Avg Peer Latency" }), _jsx("span", { children: avgLatency ? `${avgLatency.toFixed(1)} ms` : '—' })] }), _jsx("div", { className: "w-full h-2 rounded-full bg-[var(--card-hover)] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full transition-all duration-500", style: {
                                                                width: `${Math.min(100, (avgLatency / 300) * 100)}%`,
                                                                background: latColor
                                                            } }) })] }));
                                        })() }), stats?.net_io && (_jsxs("div", { className: "text-xs text-[var(--muted)] flex justify-between items-center bg-[var(--card-hover)] p-2 rounded-lg", children: [_jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx(Clock, { size: 14 }), " Total TX: ", formatBytes(stats.net_io.bytes_sent)] }), _jsxs("span", { title: "Packet loss (dropped packets)", children: ["Loss: ", stats.net_io.dropout || 0, " out / ", stats.net_io.dropin || 0, " in"] })] }))] }), _jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 max-h-[300px] overflow-auto", children: [_jsxs("div", { className: "flex justify-between items-center mb-3", children: [_jsx("h3", { className: "font-semibold", children: "Scheduler Queue" }), _jsx("span", { className: `text-xs ${stats?.throttle?.paused ? 'text-[var(--error)]' : 'text-[var(--success)]'}`, children: stats?.throttle?.paused ? 'Paused (Anomaly)' : 'Running' })] }), _jsxs("div", { className: "space-y-1.5", children: [stats?.scheduler_queue.map(t => (_jsxs("div", { className: "flex justify-between items-center p-2 rounded bg-[var(--card-hover)] text-xs", children: [_jsx("span", { className: "truncate mr-2 font-medium", children: t.label }), _jsxs("span", { className: "px-1.5 py-0.5 rounded text-white font-bold whitespace-nowrap", style: { background: getPriorityColor(t.priority) }, children: ["P", t.priority] })] }, t.label))), (!stats?.scheduler_queue || stats.scheduler_queue.length === 0) && (_jsx("p", { className: "text-xs text-[var(--muted)] text-center py-4", children: "Queue empty" }))] })] })] })] })] }));
}
function ForceGraph({ graph }) {
    const containerRef = useRef(null);
    useEffect(() => {
        if (!containerRef.current)
            return;
        const container = containerRef.current;
        container.innerHTML = ''; // Clear old
        const width = container.clientWidth;
        const height = 300;
        const svg = d3.select(container)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', [0, 0, width, height]);
        // Convert string references to object references for D3
        const nodes = graph.nodes.map(d => ({ ...d }));
        const links = graph.edges.map(d => ({ source: d.from, target: d.to, latency: d.latency }));
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2));
        const link = svg.append('g')
            .attr('stroke', 'var(--border)')
            .attr('stroke-opacity', 0.6)
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke-width', d => Math.max(1, 4 - (d.latency / 50)));
        const node = svg.append('g')
            .attr('stroke', 'var(--bg)')
            .attr('stroke-width', 2)
            .selectAll('circle')
            .data(nodes)
            .join('circle')
            .attr('r', d => d.id === graph.central ? 14 : graph.isolated.includes(d.id) ? 8 : 10)
            .attr('fill', d => d.id === graph.central ? 'var(--accent)' : graph.isolated.includes(d.id) ? 'var(--error)' : 'var(--success)');
        const label = svg.append('g')
            .selectAll('text')
            .data(nodes)
            .join('text')
            .text(d => d.id.substring(0, 8))
            .attr('font-size', '10px')
            .attr('fill', d => d.id === graph.central ? '#fff' : 'var(--muted)')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.id === graph.central ? 3 : 20)
            .attr('font-weight', d => d.id === graph.central ? 'bold' : 'normal');
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            node
                .attr('cx', d => d.x = Math.max(15, Math.min(width - 15, d.x)))
                .attr('cy', d => d.y = Math.max(15, Math.min(height - 15, d.y)));
            label
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });
        return () => {
            simulation.stop();
        };
    }, [graph]);
    return _jsx("div", { ref: containerRef, className: "w-full h-[300px]" });
}
