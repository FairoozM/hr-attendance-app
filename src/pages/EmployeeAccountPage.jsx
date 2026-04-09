import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Page.css'
import './EmployeeAccountPage.css'

export function EmployeeAccountPage() {
  const { user } = useAuth()

  if (user?.role !== 'employee') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="page employee-account-page">
      <header className="page-header">
        <h1 className="page-title">My account</h1>
        <p className="employee-account-page__intro">
          Signed in as <strong>{user.displayName || user.username}</strong>. This area will hold your profile
          and HR self-service tools in the next phase.
        </p>
      </header>

      <section className="page-section employee-account-page__grid">
        <div className="employee-account-card">
          <h2 className="employee-account-card__title">My profile</h2>
          <p className="employee-account-card__text">
            Profile details and completion will be available here in Phase 2.
          </p>
        </div>
        <div className="employee-account-card">
          <h2 className="employee-account-card__title">My account</h2>
          <p className="employee-account-card__text">
            Account settings and password changes can be added here later.
          </p>
        </div>
      </section>
    </div>
  )
}
