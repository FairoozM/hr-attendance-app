import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { DashboardPage } from '../pages/DashboardPage'

export function HomeRoute(props) {
  const { user } = useAuth()
  if (user?.role === 'employee') {
    return <Navigate to="/account" replace />
  }
  return <DashboardPage {...props} />
}
