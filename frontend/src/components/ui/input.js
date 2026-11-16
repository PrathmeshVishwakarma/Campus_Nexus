import { jsx as _jsx } from "react/jsx-runtime";
export function Input({ type = 'text', className, ...props }) {
    return (_jsx("input", { type: type, className: className ? `block w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)] ${className}` : `block w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)]`, ...props }));
}
