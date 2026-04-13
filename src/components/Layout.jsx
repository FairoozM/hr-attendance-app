import { useState, useEffect, useCallback, useMemo } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission, hasAnyModulePermission } from '../contexts/AuthContext'
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

function NavGroup({ label, children, isActive, defaultOpen = false, hint }) {
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
        <span className="nav-group__trigger-inner">
          <span className="nav-group__dot" aria-hidden />
          <span className="nav-group__text">
            <span className="nav-group__label">{label}</span>
            {hint ? <span className="nav-group__hint">{hint}</span> : null}
          </span>
        </span>
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

  const toggleSidebar = useCallback(() => setIsSidebarOpen(prev => !prev), [])
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
  const isInfluencersActive = location.pathname.startsWith('/influencers')
  const hasAnyInfluencerAccess = hasAnyModulePermission(user, 'influencers')
  const currentSectionLabel = useMemo(() => {
    if (location.pathname.startsWith('/employees')) return 'Employees'
    if (location.pathname.startsWith('/attendance')) return 'Attendance'
    if (location.pathname.startsWith('/annual-leave')) return 'Annual Leave'
    if (location.pathname.startsWith('/roster')) return 'Weekly Off & Duty'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    if (location.pathname.startsWith('/roles-permissions')) return 'Roles & Permissions'
    if (location.pathname.startsWith('/influencers')) return 'Influencers'
    if (location.pathname.startsWith('/account')) return 'My Account'
    return 'Dashboard'
  }, [location.pathname])

  const INFLUENCER_ITEMS = [
    can('influencers', 'view') && { label: 'Influencer List', to: '/influencers/list' },
    can('influencers', 'view') && { label: 'Pipeline', to: '/influencers/pipeline' },
    can('influencers', 'view') && { label: 'Shoot Schedule', to: '/influencers/schedule' },
    can('influencers', 'agreements') && { label: 'Agreements', to: '/influencers/agreements' },
    can('influencers', 'payments') && { label: 'Payments', to: '/influencers/payments' },
    can('influencers', 'view') && { label: 'Reports', to: '/influencers/reports' },
  ].filter(Boolean)

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
      <div className="app__aurora app__aurora--left" aria-hidden />
      <div className="app__aurora app__aurora--right" aria-hidden />
      <div className="app__aurora app__aurora--bottom" aria-hidden />

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.button
            type="button"
            className="app-sidebar-backdrop"
            aria-label="Close menu"
            onClick={closeSidebar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <motion.aside
        id="app-sidebar-panel"
        className={`app-sidebar ${isSidebarOpen ? 'app-sidebar--open' : ''}`}
        aria-hidden={!isSidebarOpen}
        initial={false}
        animate={{ x: isSidebarOpen ? 0 : 0 }}
      >
        <div className="app-sidebar__glow" aria-hidden />
        <div className="app-sidebar__inner">
          <div className="app-sidebar__head">
            <div className="app-sidebar__brand-wrap">
              <span className="app-sidebar__brand-badge">Creator-grade HR</span>
              <NavLink to={homePath} className="app-sidebar__brand" onClick={closeSidebar}>
                {appTitle || 'HR Attendance'}
              </NavLink>
              <span className="app-sidebar__brand-subtitle">Premium operations workspace</span>
            </div>
          </div>

          <nav id="app-sidebar-nav" className="app-sidebar__nav" aria-label="Main">
            <div className="app-sidebar__section-label" role="presentation">
              Workspace
            </div>
            <NavGroup label="HR" hint="Operations" isActive={isHrActive} defaultOpen>
              {hrItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={subLinkClass}
                  onClick={closeSidebar}
                >
                  <span className="nav-group__link-dot" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </NavGroup>

            {hasAnyInfluencerAccess && (
              <NavGroup label="Influencers" hint="Creator ops" isActive={isInfluencersActive}>
                {INFLUENCER_ITEMS.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={subLinkClass}
                    onClick={closeSidebar}
                  >
                    <span className="nav-group__link-dot" aria-hidden />
                    {item.label}
                  </NavLink>
                ))}
              </NavGroup>
            )}

            <NavGroup label="Amazon" hint="Reserved" isActive={false} />

            <div className="app-sidebar__section-label" role="presentation">
              Account
            </div>
            <NavLink to="/account" className={navLinkClass} onClick={closeSidebar}>
              <span className="app-sidebar__link-dot" aria-hidden />
              <span className="app-sidebar__link-text">My Account</span>
            </NavLink>
          </nav>

          <div className="app-sidebar__footer">
            <div className="app-sidebar__profile">
              <div className="app-sidebar__avatar" aria-hidden>
                {(user?.displayName || user?.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="app-sidebar__profile-copy">
                <span className="app-sidebar__user">{user?.displayName || user?.username}</span>
                <span className="app-sidebar__user-role">{user?.role}</span>
              </div>
            </div>
            <button type="button" className="app-sidebar__logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </motion.aside>

      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-topbar__left">
            <button
              type="button"
              className="app-topbar__menu"
              onClick={toggleSidebar}
              aria-expanded={isSidebarOpen}
              aria-controls="app-sidebar-panel"
              aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
            >
              <span className="app-topbar__menu-bar" aria-hidden />
              <span className="app-topbar__menu-bar" aria-hidden />
              <span className="app-topbar__menu-bar" aria-hidden />
            </button>
            <div className="app-topbar__copy">
              <span className="app-topbar__eyebrow">Operations console</span>
              <NavLink to={homePath} className="app-topbar__title" onClick={closeSidebar}>
                {currentSectionLabel}
              </NavLink>
            </div>
          </div>

          <div className="app-topbar__meta">
            <div className="app-topbar__chip">
              <span className="app-topbar__chip-dot" aria-hidden />
              {appTitle || 'HR Attendance'}
            </div>
            <div className="app-topbar__user-pill">
              <span className="app-topbar__user-name">{user?.displayName || user?.username}</span>
              <span className="app-topbar__user-badge">{user?.role}</span>
            </div>
          </div>
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
