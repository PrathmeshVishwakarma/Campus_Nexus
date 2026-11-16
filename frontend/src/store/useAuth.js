import { create } from 'zustand';
export const useAuth = create((set) => ({
    token: localStorage.getItem('nexus_token') || '',
    user: localStorage.getItem('nexus_user') || '',
    setAuth: (token, user) => {
        localStorage.setItem('nexus_token', token);
        localStorage.setItem('nexus_user', user);
        set({ token, user });
    },
    logout: () => {
        localStorage.removeItem('nexus_token');
        localStorage.removeItem('nexus_user');
        set({ token: '', user: '' });
    },
}));
// Generic JSON API helper
export const api = async (path, opts = {}) => {
    const token = localStorage.getItem('nexus_token');
    const headers = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
    };
    // Only set JSON content-type if not already set and body is not URLSearchParams
    if (!headers['Content-Type'] && typeof opts.body === 'string' && !opts.body.startsWith('username=')) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...opts, headers });
    const text = await res.text();
    if (!res.ok) {
        let msg = text;
        try {
            msg = JSON.parse(text)?.detail || text;
        }
        catch { }
        throw new Error(msg);
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
};
// Login with OAuth2 form format
export const loginApi = async (username, password) => {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }).toString(),
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(data?.detail || 'Login failed');
    return data;
};
