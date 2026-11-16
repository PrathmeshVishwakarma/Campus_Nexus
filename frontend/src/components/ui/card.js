import { jsx as _jsx } from "react/jsx-runtime";
export function Card({ className, children, ...props }) {
    return (_jsx("div", { className: `rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_2px_12px_rgba(0,0,0,0.2)] backdrop-blur-xl p-5 ${className ?? ''}`, ...props, children: children }));
}
