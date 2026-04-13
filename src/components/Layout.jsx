import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission } from '../contexts/AuthContext'
import { RoleGuard } from './RoleGuard'
import './Layout.css'

function ChevronIcon({ open }) {
  return (
    <svg
      className={`nav-group__chevron ${open ? 'nav-group__chevron--open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NavGroup({ label, children, isActive, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen || isActive)

  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive])

  return (
    <div className={`nav-group ${isActive ? 'nav-group--has-active' : ''}`}>
      <button
        type="button"
        className={`nav-group__trigger ${open ? 'nav-group__trigger--open' : ''} ${isActive ? 'nav-group__trigger--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="nav-group__label">{label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="nav-group__items">
          {children}
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'
  const can = (module, action) => hasPermission(user, module, action)

  const openSidebar = useCallback(() => setIsSidebarOpen(true), [])
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), [])

  const navLinkClass = ({ isActive }) =>
    `app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`

  const subLinkClass = ({ isActive }) =>
    `nav-group__link ${isActive ? 'nav-group__link--active' : ''}`

  const handleLogout = () => {
    closeSidebar()
    logout()
    navigate('/login', { replace: true })
  }

  const homePath =
    isEmployee ? '/account' : can('attendance', 'view') ? '/attendance' : '/account'

  const HR_ROUTES = ['/employees', '/attendance', '/annual-leave', '/roster', '/settings', '/roles-permissions']
  const isHrActive = HR_ROUTES.some(r => location.pathname.startsWith(r))

  const hrItems = [
    can('employees', 'view') && { label: 'Employees', to: '/employees' },
    can('attendance', 'view') && { label: 'Attendance', to: '/attendance', end: true },
    (isEmployee || can('leave', 'view')) && { label: 'Annual Leave', to: '/annual-leave' },
    can('roster', 'view') && { label: 'Weekly Off & Duty', to: '/roster' },
    isAdmin && { label: 'Settings', to: '/settings' },
    isAdmin && { label: 'Roles & Permissions', to: '/roles-permissions' },
  ].filter(Boolean)

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
            {/* HR Section */}
            <NavGroup label="HR" isActive={isHrActive} defaultOpen>
              {hrItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={subLinkClass}
                  onClick={closeSidebar}
                >
                  {item.label}
                </NavLink>
              ))}
            </NavGroup>

            {/* Influencers Section — empty, ready for future items */}
            <NavGroup label="Influencers" isActive={false} />

            {/* Amazon Section — empty, ready for future items */}
            <NavGroup label="Amazon" isActive={false} />

            {/* My Account — outside main sections */}
            <div className="app-sidebar__section-label" role="presentation">
              Account
            </div>
            <NavLink to="/account" className={navLinkClass} onClick={closeSidebar}>
              My Account
            </NavLink>
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
