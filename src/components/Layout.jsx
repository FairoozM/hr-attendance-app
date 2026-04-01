import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { RoleGuard } from './RoleGuard'
import './Layout.css'

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const navLinkClass = ({ isActive }) =>
    `nav-link ${isActive ? 'nav-link--active' : ''}`

  const handleLogout = () => {
    setMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="app-header__brand" onClick={() => setMenuOpen(false)}>
          {appTitle || 'HR Attendance'}
        </NavLink>
        <nav className={`nav nav--desktop ${menuOpen ? 'nav--open' : ''}`}>
          <NavLink to="/" className={navLinkClass} onClick={() => setMenuOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/attendance" className={navLinkClass} onClick={() => setMenuOpen(false)}>
            Attendance
          </NavLink>
          <NavLink to="/annual-leave" className={navLinkClass} onClick={() => setMenuOpen(false)}>
            Annual Leave
          </NavLink>
          {isAdmin && (
            <NavLink to="/employees" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Employees
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/settings" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Settings
            </NavLink>
          )}
          <span className="nav-user">
            {user?.username}
            <span className="nav-user-role">({user?.role})</span>
          </span>
          <button
            type="button"
            className="nav-link nav-link--logout"
            onClick={handleLogout}
          >
            Log out
          </button>
        </nav>
        <button
          type="button"
          className="nav-toggle"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-label="Toggle menu"
        >
          <span className="nav-toggle__bar" />
          <span className="nav-toggle__bar" />
          <span className="nav-toggle__bar" />
        </button>
      </header>
      <main className="app-main">
        <RoleGuard>
          <Outlet />
        </RoleGuard>
      </main>
    </div>
  )
}
