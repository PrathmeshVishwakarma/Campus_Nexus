import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, api, loginApi } from '../store/useAuth'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function Register() {
  const { setAuth } = useAuth()
  const navigate = useNavigate()
  const [registering, setRegistering] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setRegistering(true)
    setError('')
    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value
    const email = (form.elements.namedItem('email') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    try {
      // Register
      await api('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      })
      // Auto-login after registration
      const loginRes = await loginApi(username, password)
      setAuth(loginRes.access_token, username)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setRegistering(false)
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
            Campus Nexus <span className="text-[var(--accent)]">register</span>
          </h2>
          <p className="text-[var(--muted)]">Create a new account</p>
        </div>

        {error && (
          <div className="rounded-xl bg-[rgba(239,68,68,0.12)] p-3 text-[var(--error)] text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="mt-6 space-y-4">
          <Input type="text" name="username" placeholder="Username" autoComplete="username" required />
          <Input type="email" name="email" placeholder="Email" autoComplete="email" required />
          <Input type="password" name="password" placeholder="Password" autoComplete="new-password" required />
          <Button type="submit" disabled={registering} className="w-full">
            {registering ? 'Creating account…' : 'Create Account'}
          </Button>
        </form>

        <div className="text-center text-[var(--muted)] text-sm flex items-center justify-center gap-2">
          <span>Already have an account?</span>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-[var(--accent)] hover:underline font-medium"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  )
}