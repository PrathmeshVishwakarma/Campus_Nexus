import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Activity, Bell, FolderOpen, LogOut, MessageSquare, Network } from 'lucide-react'
import { useAuth } from '../store/useAuth'

const links = [
  { to: '/', label: 'Dashboard', icon: Activity, end: true },
  { to: '/files', label: 'Files', icon: FolderOpen, end: false },
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: false },
  { to: '/alerts', label: 'Alerts', icon: Bell, end: false },
  { to: '/network', label: 'Network', icon: Network, end: false },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()

  const doLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] antialiased">
      {token && (
        <nav className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)] backdrop-blur-lg">
          <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-14 overflow-x-auto">
            <span className="font-extrabold tracking-tight mr-3 whitespace-nowrap">
              Campus Nexus
            </span>
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[rgba(139,92,246,0.2)] text-[var(--accent)] font-medium'
                      : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)]'
                  }`
                }
              >
                <l.icon size={15} />
                {l.label}
              </NavLink>
            ))}
            <span className="ml-auto text-xs text-[var(--muted)] whitespace-nowrap hidden sm:block">
              {user}
            </span>
            <button
              onClick={doLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--card-hover)] transition-colors whitespace-nowrap"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </nav>
      )}
      {children}
    </div>
  )
}
