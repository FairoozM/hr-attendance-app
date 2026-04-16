import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission, hasAnyModulePermission } from '../contexts/AuthContext'
import { useNotifications } from '../hooks/useNotifications'
import { RoleGuard } from './RoleGuard'
import { ThemeToggle } from './ThemeToggle'
import { fmtDMY } from '../utils/dateFormat'
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

function NotificationsBell() {
  const { items, unread, loading, refresh, markRead, markAllRead } = useNotifications(true)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        aria-expanded={open}
        aria-label="Notifications"
        onClick={() => {
          setOpen((o) => !o)
          if (!open) refresh()
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel__head">
            <span>Notifications</span>
            {items.some((n) => !n.is_read) && (
              <button type="button" className="notif-panel__mark-all" onClick={() => markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-panel__body">
            {loading && <div className="notif-panel__empty">Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="notif-panel__empty">No notifications yet.</div>
            )}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item ${n.is_read ? 'notif-item--read' : ''}`}
                  onClick={() => {
                    if (!n.is_read) markRead(n.id)
                  }}
                >
                  <span className="notif-item__title">{n.title || 'Notice'}</span>
                  <span className="notif-item__msg">{n.message}</span>
                  <span className="notif-item__meta">
                    {n.scheduled_for ? fmtDMY(n.scheduled_for) : ''}
                    {!n.is_read && <span className="notif-item__dot" />}
                  </span>
                </button>
              ))}
          </div>
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

  const HR_ROUTES = ['/employees', '/attendance', '/annual-leave', '/settings', '/roles-permissions']
  const LISTS_ROUTES = ['/lists/sim-cards']
  const isHrActive = HR_ROUTES.some(r => location.pathname.startsWith(r))
  const isListsActive = LISTS_ROUTES.some(r => location.pathname.startsWith(r))
  const isInfluencersActive = location.pathname.startsWith('/influencers')
  const isManagementActive = location.pathname.startsWith('/management')
  const hasAnyInfluencerAccess = hasAnyModulePermission(user, 'influencers')
  const hasAnyListsAccess = hasAnyModulePermission(user, 'sim_cards')
  const hasAnyManagementAccess = hasAnyModulePermission(user, 'document_expiry')
  const currentSectionLabel = useMemo(() => {
    if (location.pathname.startsWith('/employees')) return 'Employees'
    if (location.pathname.startsWith('/attendance')) return 'Attendance'
    if (location.pathname.startsWith('/annual-leave')) return 'Annual Leave'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    if (location.pathname.startsWith('/roles-permissions')) return 'Roles & Permissions'
    if (location.pathname.startsWith('/lists/sim-cards')) return 'Sim Cards List'
    if (location.pathname.startsWith('/influencers')) return 'Influencers'
    if (location.pathname.startsWith('/account')) return 'My Account'
    if (location.pathname.startsWith('/management/document-expiry')) return 'Document Expiry Tracker'
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
    isAdmin && { label: 'Settings', to: '/settings' },
    isAdmin && { label: 'Roles & Permissions', to: '/roles-permissions' },
  ].filter(Boolean)
  const listsItems = [
    can('sim_cards', 'view') && { label: 'Sim Cards List', to: '/lists/sim-cards' },
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

      <aside
        id="app-sidebar-panel"
        className={`app-sidebar ${isSidebarOpen ? 'app-sidebar--open' : ''}`}
        aria-hidden={!isSidebarOpen}
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

            {hasAnyListsAccess && listsItems.length > 0 && (
              <NavGroup label="Lists" hint="Assets" isActive={isListsActive}>
                {listsItems.map(item => (
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

            {hasAnyManagementAccess && (
              <>
                <div className="app-sidebar__section-label" role="presentation">
                  Management
                </div>
                <NavGroup label="Management" hint="Compliance" isActive={isManagementActive}>
                  {can('document_expiry', 'view') && (
                    <NavLink
                      to="/management/document-expiry"
                      className={subLinkClass}
                      onClick={closeSidebar}
                    >
                      <span className="nav-group__link-dot" aria-hidden />
                      Document Expiry Tracker
                    </NavLink>
                  )}
                </NavGroup>
              </>
            )}

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
      </aside>

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
            {isAdmin && <NotificationsBell />}
            <ThemeToggle />
            <button
              type="button"
              className="app-topbar__logout-btn"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="app-topbar__logout-label">Logout</span>
            </button>
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
