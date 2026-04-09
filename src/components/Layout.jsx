import { useState, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { RoleGuard } from './RoleGuard'
import './Layout.css'

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'

  const openSidebar = useCallback(() => setIsSidebarOpen(true), [])
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), [])

  const navLinkClass = ({ isActive }) =>
    `app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`

  const handleLogout = () => {
    closeSidebar()
    logout()
    navigate('/login', { replace: true })
  }

  const homePath = isEmployee ? '/account' : '/'

  return (
    <div className="app">
      {isSidebarOpen && (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close menu"
          onClick={closeSidebar}
        />
      )}

      <aside
        id="app-sidebar-panel"
        className={`app-sidebar ${isSidebarOpen ? 'app-sidebar--open' : ''}`}
        aria-hidden={!isSidebarOpen}
      >
        <div className="app-sidebar__inner">
          <div className="app-sidebar__head">
            <NavLink to={homePath} className="app-sidebar__brand" onClick={closeSidebar}>
              {appTitle || 'HR Attendance'}
            </NavLink>
            <button
              type="button"
              className="app-sidebar__close"
              onClick={closeSidebar}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>

          <nav id="app-sidebar-nav" className="app-sidebar__nav" aria-label="Main">
            {isEmployee ? (
              <>
                <NavLink to="/account" className={navLinkClass} onClick={closeSidebar}>
                  My account
                </NavLink>
                <NavLink to="/annual-leave" className={navLinkClass} onClick={closeSidebar}>
                  Annual Leave
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end className={navLinkClass} onClick={closeSidebar}>
                  Dashboard
                </NavLink>
                <NavLink to="/attendance" className={navLinkClass} onClick={closeSidebar}>
                  Attendance
                </NavLink>
                <NavLink to="/annual-leave" className={navLinkClass} onClick={closeSidebar}>
                  Annual Leave
                </NavLink>
                {isAdmin && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Admin
                    </div>
                    <NavLink to="/employees" className={navLinkClass} onClick={closeSidebar}>
                      Employees
                    </NavLink>
                    <NavLink to="/settings" className={navLinkClass} onClick={closeSidebar}>
                      Settings
                    </NavLink>
                  </>
                )}
              </>
            )}
          </nav>

          <div className="app-sidebar__footer">
            <span className="app-sidebar__user">
              {user?.displayName || user?.username}
              <span className="app-sidebar__user-role"> ({user?.role})</span>
            </span>
            <button type="button" className="app-sidebar__logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <div className="app-shell">
        <header className="app-topbar">
          <button
            type="button"
            className="app-topbar__menu"
            onClick={openSidebar}
            aria-expanded={isSidebarOpen}
            aria-controls="app-sidebar-panel"
            aria-label="Open menu"
          >
            <span className="app-topbar__menu-bar" aria-hidden />
            <span className="app-topbar__menu-bar" aria-hidden />
            <span className="app-topbar__menu-bar" aria-hidden />
          </button>
          <NavLink to={homePath} className="app-topbar__title" onClick={closeSidebar}>
            {appTitle || 'HR Attendance'}
          </NavLink>
        </header>

        <main className="app-main">
          <RoleGuard>
            <Outlet />
          </RoleGuard>
        </main>
      </div>
    </div>
  )
}
