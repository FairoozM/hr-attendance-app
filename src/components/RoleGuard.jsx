import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, hasPermission } from '../contexts/AuthContext'

/** Paths that require explicit permissions for employee role */
const PERMISSION_GATED = [
  { prefix: '/attendance', module: 'attendance', action: 'view' },
  { prefix: '/employees', module: 'employees', action: 'view' },
  { prefix: '/reports', module: 'weekly_reports', action: 'view' },
]

/** Paths that are strictly admin-only, never accessible by other roles */
const ADMIN_ONLY_PATHS = ['/settings', '/roles-permissions']

/**
 * Redirects if the current path is restricted for the user's role.
 * Respects module-level permissions so employees granted access to a
 * specific module (e.g. attendance) are not blocked here.
 */
export function RoleGuard({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const path = location.pathname

  if (!user) return children
  if (user.role === 'admin') return children

  // Strictly admin-only pages — redirect everyone else
  if (ADMIN_ONLY_PATHS.some((p) => path.startsWith(p))) {
    return <Navigate to="/attendance" replace />
  }

  // Permission-gated pages: allow if the user has the required permission
  for (const gate of PERMISSION_GATED) {
    if (path.startsWith(gate.prefix)) {
      if (hasPermission(user, gate.module, gate.action)) return children
      // No permission → profile is always allowed
      return <Navigate to="/account" replace />
    }
  }

  return children
}
