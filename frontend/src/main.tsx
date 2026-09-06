import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuth } from './store/useAuth'
import { Dashboard } from './pages/Dashboard'
import Files from './pages/Files'
import Chat from './pages/Chat'
import Alerts from './pages/Alerts'
import Network from './pages/Network'
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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/files" element={<PrivateRoute><Files /></PrivateRoute>} />
        <Route path="/chat" element={<PrivateRoute><Chat /></PrivateRoute>} />
        <Route path="/alerts" element={<PrivateRoute><Alerts /></PrivateRoute>} />
        <Route path="/network" element={<PrivateRoute><Network /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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