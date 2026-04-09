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
    if (!u || !p) throw new Error('Invalid username or password')

    const res = await api.post('/api/auth/login', { username: u, password: p })
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

  const value = { user, loading, login, logout }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
