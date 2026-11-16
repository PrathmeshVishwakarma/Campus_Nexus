import { jsx as _jsx } from "react/jsx-runtime";
export function Avatar({ className, children, ...props }) {
    return (_jsx("div", { className: className ? `w-8 h-8 rounded-full flex items-center justify-center ${className}` : `w-8 h-8 rounded-full flex items-center justify-center`, ...props, children: children }));
}
