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
