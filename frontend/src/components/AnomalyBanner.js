import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../store/useAuth';
import { useEventsWs } from '../hooks/useEventsWs';
export default function AnomalyBanner() {
    const [paused, setPaused] = useState(false);
    const check = () => api('/api/ml/anomalies').then(d => setPaused(d.scheduler_paused)).catch(() => { });
    useEffect(() => { check(); const t = setInterval(check, 8000); return () => clearInterval(t); }, []);
    useEventsWs((e) => { if (e.event === 'ANOMALY_DETECTED')
        setPaused(true); });
    if (!paused)
        return null;
    const resume = async () => {
        await api('/api/sync/resume-scheduler', { method: 'POST', body: JSON.stringify({}) });
        toast.success('Sync resumed');
        setPaused(false);
    };
    return _jsxs("div", { className: "rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 flex items-center gap-3", children: [_jsx(ShieldAlert, { className: "text-rose-300" }), _jsxs("div", { className: "text-sm", children: [_jsx("b", { className: "text-rose-200", children: "Anomaly detected \u2014 sync paused, versions preserved." }), _jsx("div", { className: "text-rose-300/80 text-xs", children: "Possible mass modify/delete. Review timeline, then resume." })] }), _jsx("button", { onClick: resume, className: "ml-auto px-4 py-2 rounded-xl bg-emerald-600 font-semibold text-sm", children: "Review & Resume" })] });
}
