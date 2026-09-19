import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuth } from './store/useAuth';
import { Dashboard } from './pages/Dashboard';
import Files from './pages/Files';
import Chat from './pages/Chat';
import Alerts from './pages/Alerts';
import Network from './pages/Network';
import { Shell } from './components/Shell';
import { Login } from './components/Login';
import { Register } from './components/Register';
const qc = new QueryClient();
function ThemeLoader() {
    useEffect(() => {
        const html = document.documentElement;
        const theme = localStorage.getItem('nexus_theme');
        if (theme === 'light') {
            html.classList.add('light');
            html.classList.remove('dark');
        }
        else {
            html.classList.add('dark');
            html.classList.remove('light');
        }
    }, []);
    return null;
}
function PrivateRoute({ children }) {
    const { token } = useAuth();
    return token ? _jsx(_Fragment, { children: children }) : _jsx(Navigate, { to: "/login", replace: true });
}
function App() {
    return (_jsxs(Shell, { children: [_jsx(ThemeLoader, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { path: "/register", element: _jsx(Register, {}) }), _jsx(Route, { path: "/", element: _jsx(PrivateRoute, { children: _jsx(Dashboard, {}) }) }), _jsx(Route, { path: "/files", element: _jsx(PrivateRoute, { children: _jsx(Files, {}) }) }), _jsx(Route, { path: "/chat", element: _jsx(PrivateRoute, { children: _jsx(Chat, {}) }) }), _jsx(Route, { path: "/alerts", element: _jsx(PrivateRoute, { children: _jsx(Alerts, {}) }) }), _jsx(Route, { path: "/network", element: _jsx(PrivateRoute, { children: _jsx(Network, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] })] }));
}
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(QueryClientProvider, { client: qc, children: _jsxs(BrowserRouter, { children: [_jsx(Toaster, { theme: "dark" }), _jsx(App, {})] }) }));
