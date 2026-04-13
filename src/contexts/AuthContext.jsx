import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api, AUTH_STORAGE_KEY } from '../api/client'

export const AuthContext = createContext(null)

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data?.user?.id && data?.user?.username && data?.user?.role && data?.token) {
        return { user: data.user, token: data.token }
      }
    }
  } catch (_) {}
  return null
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = loadStoredAuth()
    setUser(stored?.user ?? null)
    setLoading(false)
  }, [])

  const login = useCallback(async (username, password) => {
    const u = (username || '').trim()
    const p = password != null ? String(password) : ''
    if (!u || !p) throw new Error('Invalid email or password')

    const res = await api.post('/api/auth/login', { email: u, password: p })
    if (!res?.user || !res?.token) {
      throw new Error('Login failed')
    }
    const payload = { user: res.user, token: res.token }
    setUser(res.user)
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload))
    return res.user
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }, [])

  /** Refresh user from /api/auth/me (e.g. after admin updates permissions) */
  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me')
      if (res?.user) {
        const stored = loadStoredAuth()
        if (stored) {
          const updated = { user: res.user, token: stored.token }
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated))
        }
        setUser(res.user)
        return res.user
      }
    } catch (_) {}
    return null
  }, [])

  const value = { user, loading, login, logout, refreshUser }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Returns true if the user can access the given module+action.
 * Admin and warehouse always return true (backward compat).
 * employee: checks user.permissions object.
 */
export function hasPermission(user, module, action) {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'warehouse') return true
  const p = user.permissions || {}
  const mod = p[module] || {}
  // manage always implies view for any module
  if (action === 'view' && mod.manage) return true
  // leave: approve implies view
  if (action === 'view' && module === 'leave' && mod.approve) return true
  // influencers: any elevated permission implies view access
  if (action === 'view' && module === 'influencers' && (mod.approve || mod.payments || mod.agreements)) return true
  return Boolean(mod[action])
}

/** Returns true if user has any permission within the given module. */
export function hasAnyModulePermission(user, module) {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'warehouse') return true
  const p = user.permissions || {}
  const mod = p[module] || {}
  return Object.values(mod).some(Boolean)
}
