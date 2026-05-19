import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './RequireAuth.css'

/**
 * Renders children only when user is logged in; otherwise redirects to /login.
 */
export function RequireAuth({ children }) {
  const { user, loading, sessionError } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="page">
        <p className="page-loading">Loading…</p>
      </div>
    )
  }

  if (sessionError && !user) {
    return (
      <div className="page require-auth-error">
        <p className="page-error" role="alert">
          {sessionError}
        </p>
        <p className="require-auth-error__hint">
          The API did not respond in time. Try again in a moment, or check that the backend service is running.
        </p>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return children
}
