import { jsx as _jsx } from "react/jsx-runtime";
export function Badge({ className, ...props }) {
    return (_jsx("button", { className: className ? `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}` : `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`, ...props }));
}
