import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const ADMIN_ONLY_PATHS = ['/employees', '/settings']

/**
 * Redirects to / if the current path is restricted for the user's role.
 * Admin: all routes. Warehouse: Dashboard + Attendance only.
 */
export function RoleGuard({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const path = location.pathname

  if (!user) return children
  if (user.role === 'admin') return children
  if (user.role === 'warehouse' && ADMIN_ONLY_PATHS.some((p) => path.startsWith(p))) {
    return <Navigate to="/" replace />
  }
  return children
}
