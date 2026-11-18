import { create } from 'zustand'

type State = {
  token: string
  user: string
  role: string
  setAuth: (t: string, u: string) => void
  setRole: (r: string) => void
  logout: () => void
}

const read = (k: string) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const write = (k: string, v: string | null) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* storage blocked */ }
}

/** Reject tokens whose JWT `exp` is already in the past. */
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch { return true }
}

const initialToken = (() => { const t = read('nexus_token'); return t && !isExpired(t) ? t : '' })()

export const useAuth = create<State>((set) => ({
  token: initialToken,
  user: initialToken ? read('nexus_user') : '',
  role: '',
  setAuth: (token, user) => {
    write('nexus_token', token)
    write('nexus_user', user)
    set({ token, user, role: '' })
  },
  setRole: (role) => set({ role }),
  logout: () => {
    write('nexus_token', null)
    write('nexus_user', null)
    set({ token: '', user: '', role: '' })
  },
}))

export const isAdmin = () => useAuth.getState().role === 'admin'

/** Session ended (expired/invalid token): clear it and go to the login page. */
export function sessionExpired() {
  if (!useAuth.getState().token) return
  useAuth.getState().logout()
  if (!location.pathname.startsWith('/login')) location.assign('/login?expired=1')
}

/** FastAPI errors: `detail` is a string, or a list of validation errors. */
function errorMessage(text: string, status: number): string {
  try {
    const d = JSON.parse(text)?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((e: any) => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ')
  } catch { /* not JSON */ }
  return text || `Request failed (${status})`
}

export class ApiError extends Error {
  status: number
  constructor(msg: string, status: number) { super(msg); this.status = status }
}

// Generic JSON API helper
export const api = async (path: string, opts: RequestInit = {}) => {
  const token = useAuth.getState().token
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  }
  if (!headers['Content-Type'] && typeof opts.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, { ...opts, headers })
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 401 && token) sessionExpired()
    throw new ApiError(errorMessage(text, res.status), res.status)
  }
  try { return JSON.parse(text) } catch { return text }
}

/** Raw fetch with auth + 401 handling (for multipart uploads and blobs). */
export const authFetch = async (path: string, opts: RequestInit = {}) => {
  const token = useAuth.getState().token
  const res = await fetch(path, { ...opts, headers: { ...(opts.headers as any || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 401 && token) sessionExpired()
    throw new ApiError(errorMessage(text, res.status), res.status)
  }
  return res
}

// Login with OAuth2 form format
export const loginApi = async (username: string, password: string) => {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new ApiError(errorMessage(text, res.status) || 'Login failed', res.status)
  return JSON.parse(text)
}
