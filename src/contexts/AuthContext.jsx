import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

const STORAGE_KEY = 'hr-auth'

// Mock users for development only – replace with Cognito/backend in production.
// Do not expose these credentials in the UI.
const MOCK_USERS = [
  { id: '1', username: 'admin', password: 'admin123', role: 'admin' },
  { id: '2', username: 'warehouse', password: 'warehouse123', role: 'warehouse' },
]

export const AuthContext = createContext(null)

function loadStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data?.user?.id && data?.user?.username && data?.user?.role) {
        return data.user
      }
    }
  } catch (_) {}
  return null
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = loadStoredUser()
    setUser(stored)
    setLoading(false)
  }, [])

  const login = useCallback(async (username, password) => {
    const u = MOCK_USERS.find(
      (m) =>
        m.username.toLowerCase() === (username || '').trim().toLowerCase() &&
        m.password === password
    )
    if (u) {
      const userData = { id: u.id, username: u.username, role: u.role }
      setUser(userData)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: userData }))
      return
    }

    const uname = (username || '').trim()
    if (!uname || !password) throw new Error('Invalid username or password')

    try {
      const data = await api.get('/api/employees')
      const rows = Array.isArray(data) ? data : []
      const emp = rows.find(
        (r) =>
          String(r.employee_code || '').trim().toLowerCase() === uname.toLowerCase()
      )
      // Frontend-only fallback credential model for employee access:
      // username = employee code, password = same employee code.
      if (emp && String(emp.employee_code || '') === password) {
        const userData = {
          id: `emp-${emp.id}`,
          username: String(emp.employee_code),
          role: 'employee',
          employeeId: String(emp.id),
          displayName: String(emp.full_name || emp.employee_code || ''),
        }
        setUser(userData)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: userData }))
        return
      }
    } catch (_) {}

    throw new Error('Invalid username or password')
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const value = { user, loading, login, logout }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
