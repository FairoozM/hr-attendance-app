import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/** Default landing: attendance for staff; profile for portal employees. */
export function HomeRoute() {
  const { user } = useAuth()
  if (user?.role === 'employee') {
    return <Navigate to="/account" replace />
  }
  return <Navigate to="/attendance" replace />
}
