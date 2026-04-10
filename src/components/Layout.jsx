import { useState, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission } from '../contexts/AuthContext'
import { RoleGuard } from './RoleGuard'
import './Layout.css'

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'

  const can = (module, action) => hasPermission(user, module, action)

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
                  My Profile
                </NavLink>
                <NavLink to="/annual-leave" className={navLinkClass} onClick={closeSidebar}>
                  Annual Leave
                </NavLink>
                {can('attendance', 'view') && (
                  <NavLink to="/attendance" className={navLinkClass} onClick={closeSidebar}>
                    Attendance
                  </NavLink>
                )}
                {can('employees', 'view') && (
                  <NavLink to="/employees" className={navLinkClass} onClick={closeSidebar}>
                    Employees
                  </NavLink>
                )}
                {can('roster', 'view') && (
                  <NavLink to="/roster" className={navLinkClass} onClick={closeSidebar}>
                    Weekly Off &amp; Duty
                  </NavLink>
                )}
              </>
            ) : (
              <>
                <NavLink to="/" end className={navLinkClass} onClick={closeSidebar}>
                  Dashboard
                </NavLink>
                {can('attendance', 'view') && (
                  <NavLink to="/attendance" className={navLinkClass} onClick={closeSidebar}>
                    Attendance
                  </NavLink>
                )}
                {can('leave', 'view') && (
                  <NavLink to="/annual-leave" className={navLinkClass} onClick={closeSidebar}>
                    Annual Leave
                  </NavLink>
                )}
                {can('roster', 'view') && (
                  <NavLink to="/roster" className={navLinkClass} onClick={closeSidebar}>
                    Weekly Off &amp; Duty
                  </NavLink>
                )}
                {can('employees', 'view') && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Management
                    </div>
                    <NavLink to="/employees" className={navLinkClass} onClick={closeSidebar}>
                      Employees
                    </NavLink>
                  </>
                )}
                {isAdmin && (
                  <>
                    <NavLink to="/annual-leave-salary" className={navLinkClass} onClick={closeSidebar}>
                      Annual Leave Salary
                    </NavLink>
                    <NavLink to="/settings" className={navLinkClass} onClick={closeSidebar}>
                      Settings
                    </NavLink>
                    <NavLink to="/roles-permissions" className={navLinkClass} onClick={closeSidebar}>
                      Roles &amp; Permissions
                    </NavLink>
                  </>
                )}
                <div className="app-sidebar__section-label" role="presentation">
                  Account
                </div>
                <NavLink to="/account" className={navLinkClass} onClick={closeSidebar}>
                  My Account
                </NavLink>
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
