import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Tooltip({ children, className, ...props }) {
    return (_jsxs("div", { className: className ? `relative inline-block ${className}` : `relative inline-block`, ...props, children: [children, _jsx("span", { className: "absolute right-0 top-full mt-1 bg-[var(--card)] px-2 py-1 text-xs rounded border border-[var(--border)] hidden opacity-0 group-hover:opacity-100 group-hover:visible transition-opacity", children: children })] }));
}
