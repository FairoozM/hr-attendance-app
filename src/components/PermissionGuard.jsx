import { Navigate } from 'react-router-dom'
import { useAuth, hasPermission } from '../contexts/AuthContext'

/**
 * Wraps a route and redirects to home if the user lacks the required permission.
 * Admin and warehouse roles always pass through.
 */
export function PermissionGuard({ module, action, children }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (hasPermission(user, module, action)) return children

  return <Navigate to="/account" replace />
}

/** Matches sidebar: portal employees always open Annual Leave; others need leave.view (admin/warehouse already pass). */
export function LeaveSelfServiceGuard({ children }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'employee') return children
  if (hasPermission(user, 'leave', 'view')) return children

  return <Navigate to="/account" replace />
}
