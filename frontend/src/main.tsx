import React, { Suspense, lazy, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuth } from './store/useAuth'
// route-level code splitting keeps the initial bundle small
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Files = lazy(() => import('./pages/Files'))
const FileDiscussion = lazy(() => import('./pages/FileDiscussion'))
const Chat = lazy(() => import('./pages/Chat'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Network = lazy(() => import('./pages/Network'))
import { Shell } from './components/Shell'
import { Login } from './components/Login'
import { Register } from './components/Register'

const qc = new QueryClient()

function ThemeLoader() {
  useEffect(() => {
    const html = document.documentElement
    const theme = localStorage.getItem('nexus_theme')
    if (theme === 'light') {
      html.classList.add('light')
      html.classList.remove('dark')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
  }, [])
  return null
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function App() {
  return (
    <Shell>
      <ThemeLoader />
      <Suspense fallback={<div className="p-6 text-sm text-[var(--muted)]">Loading…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/files" element={<PrivateRoute><Files /></PrivateRoute>} />
        <Route path="/files/discussion" element={<PrivateRoute><FileDiscussion /></PrivateRoute>} />
        <Route path="/chat" element={<PrivateRoute><Chat /></PrivateRoute>} />
        <Route path="/alerts" element={<PrivateRoute><Alerts /></PrivateRoute>} />
        <Route path="/network" element={<PrivateRoute><Network /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Shell>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <BrowserRouter>
      <Toaster theme="dark" />
      <App />
    </BrowserRouter>
  </QueryClientProvider>
)