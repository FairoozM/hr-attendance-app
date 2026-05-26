import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api, clearLegacyHrAuthStorage } from '../api/client'
import { clearPrefCache } from '../lib/userPreferencesBridge'
import { useIdleLogout } from '../hooks/useIdleLogout'
import { getUserWorkspaceRole } from '../lib/linearPermissions'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState(null)

  useEffect(() => {
    clearLegacyHrAuthStorage()
    let cancelled = false
    setLoading(true)
    setSessionError(null)
    api
      .get('/api/auth/me')
      .then((res) => {
        if (cancelled) return
        if (res?.user) setUser(res.user)
        else setUser(null)
      })
      .catch((err) => {
        if (cancelled) return
        setUser(null)
        if (err?.name === 'AbortError') {
          setSessionError('Could not reach the server (request timed out).')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const u = (username || '').trim()
    const p = password != null ? String(password) : ''
    if (!u || !p) throw new Error('Invalid email or password')

    const res = await api.post('/api/auth/login', { email: u, password: p })
    if (!res?.user) {
      throw new Error('Login failed')
    }
    clearLegacyHrAuthStorage()
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {})
    } catch (_) {
      /* still clear client */
    }
    setUser(null)
    clearPrefCache()
    clearLegacyHrAuthStorage()
  }, [])

  /** Refresh user from /api/auth/me (e.g. after admin updates permissions) */
  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me')
      if (res?.user) {
        setUser(res.user)
        return res.user
      }
    } catch (_) {}
    return null
  }, [])

  useIdleLogout(user, logout)

  const value = { user, loading, sessionError, login, logout, refreshUser }
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
  const p = user.permissions || {}
  const mod = p[module] || {}
  const workspaceRole = getUserWorkspaceRole(user)
  // linear workspace access is governed by the effective workspace role,
  // even for app admins when an explicit workspace role is set.
  if (module === 'planner' && action === 'view' && workspaceRole) return true
  if (module === 'planner' && action === 'manage' && ['manager', 'admin'].includes(workspaceRole || '')) {
    return true
  }
  if (module === 'planner' && action === 'settings' && ['manager', 'admin'].includes(workspaceRole || '')) {
    return true
  }
  if (user.role === 'admin') return true
  if (user.role === 'warehouse') return true
  // manage always implies view for any module
  if (action === 'view' && mod.manage) return true
  // leave: approve implies view
  if (action === 'view' && module === 'leave' && mod.approve) return true
  // influencers: elevated permissions + performance tracker imply read/list API access
  if (
    action === 'view' &&
    module === 'influencers' &&
    (mod.approve || mod.payments || mod.agreements || mod.performance)
  ) {
    return true
  }
  // Performance page: standalone toggle, or anyone with list/view/manage access
  if (action === 'performance' && module === 'influencers') {
    return Boolean(mod.performance || mod.manage || mod.view)
  }
  // sim cards: write permissions imply view access
  if (action === 'view' && module === 'sim_cards' && (mod.add || mod.edit || mod.delete)) return true
  // document expiry: write permissions imply view access
  if (action === 'view' && module === 'document_expiry' && (mod.add || mod.edit || mod.delete)) return true
  // planner: manage implies view
  if (action === 'view' && module === 'planner' && mod.manage) return true
  // company_payments: write permissions imply view
  if (action === 'view' && module === 'company_payments' && (mod.add || mod.edit || mod.delete)) return true
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

/** Persist influencer performance metrics to the API (not the influencer roster). */
export function canMutateInfluencerPerformance(user) {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'warehouse') return true
  const m = user.permissions?.influencers || {}
  return Boolean(m.manage || m.performance)
}

/** Net profit on influencer performance is visible and editable only for admins (not warehouse). */
export function canViewInfluencerPerformanceNetProfit(user) {
  return Boolean(user && user.role === 'admin')
}
