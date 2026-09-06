import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, loginApi } from '../store/useAuth'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function Login() {
  const { setAuth } = useAuth()
  const navigate = useNavigate()
  const [loggingIn, setLoggingIn] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoggingIn(true)
    setError('')
    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    try {
      const res = await loginApi(username, password)
      setAuth(res.access_token, username)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div
        className="w-full max-w-md space-y-4 p-8 bg-[var(--card)] border border-[var(--border)] rounded-2xl"
        style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight mb-2">
            Campus Nexus <span className="text-[var(--accent)]">login</span>
          </h2>
          <p className="text-[var(--muted)]">Sign in to continue</p>
        </div>

        {error && (
          <div className="rounded-xl bg-[rgba(239,68,68,0.12)] p-3 text-[var(--error)] text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <Input type="text" name="username" placeholder="Username" autoComplete="username" required />
          <Input type="password" name="password" placeholder="Password" autoComplete="current-password" required />
          <Button type="submit" disabled={loggingIn} className="w-full">
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        <div className="text-center text-[var(--muted)] text-sm flex items-center justify-center gap-2">
          <span>Don't have an account?</span>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="text-[var(--accent)] hover:underline font-medium"
          >
            Register
          </button>
        </div>
      </div>
    </div>
  )
}