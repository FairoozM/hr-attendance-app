import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { RoleGuard } from './RoleGuard'
import './Layout.css'

const DESKTOP_MQ = '(min-width: 1024px)'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ)
    const sync = () => {
      const desktop = mq.matches
      setIsDesktop(desktop)
      if (desktop) {
        setSidebarOpen(true)
      } else {
        setSidebarOpen(false)
      }
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const openSidebar = useCallback(() => setSidebarOpen(true), [])
  const closeSidebar = useCallback(() => {
    if (!isDesktop) setSidebarOpen(false)
  }, [isDesktop])

  const navLinkClass = ({ isActive }) =>
    `app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`

  const handleNavClick = useCallback(() => {
    if (!isDesktop) setSidebarOpen(false)
  }, [isDesktop])

  const handleLogout = () => {
    closeSidebar()
    logout()
    navigate('/login', { replace: true })
  }

  const showOverlay = sidebarOpen && !isDesktop
  const sidebarExpanded = isDesktop || sidebarOpen

  return (
    <div className="app">
      {showOverlay && (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close menu"
          onClick={closeSidebar}
        />
      )}

      <aside
        id="app-sidebar-panel"
        className={`app-sidebar ${sidebarExpanded ? 'app-sidebar--open' : ''} ${isDesktop ? 'app-sidebar--pinned' : ''}`}
        aria-hidden={!sidebarExpanded}
      >
        <div className="app-sidebar__inner">
          <div className="app-sidebar__head">
            <NavLink to="/" className="app-sidebar__brand" onClick={handleNavClick}>
              {appTitle || 'HR Attendance'}
            </NavLink>
            {!isDesktop && (
              <button
                type="button"
                className="app-sidebar__close"
                onClick={closeSidebar}
                aria-label="Close menu"
              >
                ×
              </button>
            )}
          </div>

          <nav id="app-sidebar-nav" className="app-sidebar__nav" aria-label="Main">
            <NavLink to="/" end className={navLinkClass} onClick={handleNavClick}>
              Dashboard
            </NavLink>
            {!isEmployee && (
              <NavLink to="/attendance" className={navLinkClass} onClick={handleNavClick}>
                Attendance
              </NavLink>
            )}
            <NavLink to="/annual-leave" className={navLinkClass} onClick={handleNavClick}>
              Annual Leave
            </NavLink>
            {isAdmin && (
              <>
                <div className="app-sidebar__section-label" role="presentation">
                  Admin
                </div>
                <NavLink to="/employees" className={navLinkClass} onClick={handleNavClick}>
                  Employees
                </NavLink>
                <NavLink to="/settings" className={navLinkClass} onClick={handleNavClick}>
                  Settings
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
          {!isDesktop && (
            <button
              type="button"
              className="app-topbar__menu"
              onClick={openSidebar}
              aria-expanded={sidebarExpanded}
              aria-controls="app-sidebar-panel"
              aria-label="Open menu"
            >
              <span className="app-topbar__menu-bar" />
              <span className="app-topbar__menu-bar" />
              <span className="app-topbar__menu-bar" />
            </button>
          )}
          <NavLink to="/" className="app-topbar__title" onClick={handleNavClick}>
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
