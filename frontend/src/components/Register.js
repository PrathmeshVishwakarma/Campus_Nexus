import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, api, loginApi } from '../store/useAuth';
import { Button } from './ui/button';
import { Input } from './ui/input';
export function Register() {
    const { setAuth } = useAuth();
    const navigate = useNavigate();
    const [registering, setRegistering] = React.useState(false);
    const [error, setError] = React.useState('');
    const handleRegister = async (e) => {
        e.preventDefault();
        setRegistering(true);
        setError('');
        const form = e.currentTarget;
        const username = form.elements.namedItem('username').value;
        const email = form.elements.namedItem('email').value;
        const password = form.elements.namedItem('password').value;
        try {
            // Register
            await api('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            });
            // Auto-login after registration
            const loginRes = await loginApi(username, password);
            setAuth(loginRes.access_token, username);
            navigate('/', { replace: true });
        }
        catch (err) {
            setError(err.message || 'Registration failed');
        }
        finally {
            setRegistering(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-8", children: _jsxs("div", { className: "w-full max-w-md space-y-5 p-6 sm:p-8 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.2)]", style: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }, children: [_jsxs("div", { className: "text-center", children: [_jsxs("h2", { className: "text-2xl sm:text-3xl font-extrabold tracking-tight mb-2", children: ["Campus Nexus ", _jsx("span", { className: "text-[var(--accent)]", children: "Register" })] }), _jsx("p", { className: "text-sm text-[var(--muted)]", children: "Create a new account" })] }), error && (_jsx("div", { className: "rounded-xl bg-[rgba(239,68,68,0.12)] p-3 text-[var(--error)] text-sm text-center", children: error })), _jsxs("form", { onSubmit: handleRegister, className: "space-y-4", children: [_jsx(Input, { type: "text", name: "username", placeholder: "Username", autoComplete: "username", required: true }), _jsx(Input, { type: "email", name: "email", placeholder: "Email", autoComplete: "email", required: true }), _jsx(Input, { type: "password", name: "password", placeholder: "Password", autoComplete: "new-password", required: true }), _jsx(Button, { type: "submit", disabled: registering, className: "w-full", children: registering ? 'Creating account…' : 'Create Account' })] }), _jsxs("div", { className: "text-center text-[var(--muted)] text-sm flex items-center justify-center gap-2", children: [_jsx("span", { children: "Already have an account?" }), _jsx("button", { type: "button", onClick: () => navigate('/login'), className: "text-[var(--accent)] hover:underline font-medium", children: "Sign In" })] })] }) }));
}
