import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/** Default landing: attendance for staff; profile for portal employees; Auditor Room for auditors. */
export function HomeRoute() {
  const { user } = useAuth()
  if (user?.role === 'auditor') {
    return <Navigate to="/iso-qms/auditor-room" replace />
  }
  if (user?.role === 'employee') {
    return <Navigate to="/account" replace />
  }
  return <Navigate to="/attendance" replace />
}
