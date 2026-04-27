import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission, hasAnyModulePermission } from '../contexts/AuthContext'
import { useNotifications } from '../hooks/useNotifications'
import { useDocumentReminders } from '../hooks/useDocumentReminders'
import { useDocumentExpiry } from '../hooks/useDocumentExpiry'
import { RoleGuard } from './RoleGuard'
import { ThemeToggle } from './ThemeToggle'
import { fmtDMY } from '../utils/dateFormat'
import { useAIPlanner } from '../contexts/AIPlannerContext'
import { TaskSearchModal } from './planner/TaskSearchModal'
import './Layout.css'

/** AI Planner sub-routes (admin sidebar, rail, and global nav search). */
const PLANNER_NAV_ITEMS = [
  { to: '/projects', label: 'Task List' },
  { to: '/projects/today', label: "Today's Plan" },
  { to: '/projects/dashboard', label: 'Dashboard' },
  { to: '/projects/trash', label: 'Deleted' },
]

/**
 * Match nav search: full substring, or every whitespace-separated word must appear
 * somewhere in label + group + optional searchHint (e.g. "weekly report" finds "Weekly Ads Report").
 */
function navSearchMatches(item, queryRaw) {
  const q = queryRaw.trim().toLowerCase()
  if (!q) return false
  const hint = item.searchHint != null ? String(item.searchHint) : ''
  const hay = `${item.label} ${item.group} ${hint}`.toLowerCase()
  if (hay.includes(q)) return true
  const words = q.split(/\s+/).filter(Boolean)
  return words.length > 0 && words.every(w => hay.includes(w))
}

function SidebarSearch({ allItems, onNavigate, className = '', enableHotkey = true }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const resultsId = useId()
  const navigate = useNavigate()

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return allItems.filter(item => navSearchMatches(item, q))
  }, [query, allItems])

  // Reset cursor when results change
  useEffect(() => { setCursor(0) }, [results.length])

  const commit = useCallback((item) => {
    navigate(item.to)
    setQuery('')
    onNavigate()
  }, [navigate, onNavigate])

  const onKeyDown = (e) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[cursor]) commit(results[cursor])
    } else if (e.key === 'Escape') {
      setQuery('')
    }
  }

  // Keyboard shortcut: "/" focuses the search box
  useEffect(() => {
    if (!enableHotkey) return undefined
    function onGlobalKey(e) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onGlobalKey)
    return () => document.removeEventListener('keydown', onGlobalKey)
  }, [enableHotkey])

  return (
    <div className={`nav-search ${className}`.trim()}>
      <div className="nav-search__shell">
        <svg className="nav-search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="nav-search__input"
          placeholder="Search for Anything"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          aria-label="Search navigation"
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-activedescendant={results.length ? `${resultsId}-${cursor}` : undefined}
        />
        {query && (
          <button
            type="button"
            className="nav-search__clear"
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            aria-label="Clear search"
          >×</button>
        )}
      </div>

      {results.length > 0 && (
        <ul
          id={resultsId}
          ref={listRef}
          className="nav-search__results"
          role="listbox"
        >
          {results.map((item, i) => (
            <li key={`${item.to}::${item.group}::${item.label}`} role="option" aria-selected={i === cursor}>
              <button
                id={`${resultsId}-${i}`}
                type="button"
                className={`nav-search__result ${i === cursor ? 'nav-search__result--active' : ''}`}
                onClick={() => commit(item)}
                onMouseEnter={() => setCursor(i)}
              >
                <span className="nav-search__result-label">{item.label}</span>
                <span className="nav-search__result-group">{item.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && results.length === 0 && (
        <div className="nav-search__empty">No pages match "{query.trim()}"</div>
      )}
    </div>
  )
}

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

function itemIconToken(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '•'
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase()
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase()
}

const DOC_URGENCY_LABEL = { expired: 'Expired', urgent: 'Urgent', 'due-soon': 'Due Soon' }
const DOC_URGENCY_CLS   = { expired: 'notif-doc-badge--expired', urgent: 'notif-doc-badge--urgent', 'due-soon': 'notif-doc-badge--due-soon' }

function NotificationsBell({ docReminders = [] }) {
  const { items, unread, loading, refresh, markRead, markAllRead, dismiss } = useNotifications(true)
  const [open, setOpen] = useState(false)
  const [dismissedDocIds, setDismissedDocIds] = useState(() => new Set())
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const visibleDocReminders = docReminders.filter((n) => !dismissedDocIds.has(n.id))
  const totalUnread = unread + visibleDocReminders.length

  function dismissDoc(id) {
    setDismissedDocIds((prev) => new Set([...prev, id]))
  }

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
        {totalUnread > 0 && (
          <span className="notif-bell-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
        )}
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
            {/* ── Document reminder section ── */}
            {visibleDocReminders.length > 0 && (
              <>
                <div className="notif-section-label">Document Reminders</div>
                {visibleDocReminders.map((n) => (
                  <div key={n.id} className="notif-item notif-item--doc">
                    <div className="notif-item__row">
                      <span className="notif-item__title">
                        {n.title}
                        <span className={`notif-doc-badge ${DOC_URGENCY_CLS[n._urgency] || ''}`}>
                          {DOC_URGENCY_LABEL[n._urgency] || n._urgency}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="notif-item__dismiss"
                        aria-label="Dismiss notification"
                        onClick={() => dismissDoc(n.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    {n._company && (
                      <span className="notif-item__company">{n._company}{n._docType ? ` · ${n._docType}` : ''}</span>
                    )}
                    <span className="notif-item__msg">{n.message}</span>
                    <span className="notif-item__meta">
                      {n.scheduled_for ? fmtDMY(n.scheduled_for) : ''}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* ── HR / system notifications section ── */}
            {visibleDocReminders.length > 0 && (items.length > 0 || loading) && (
              <div className="notif-section-label">System Notifications</div>
            )}

            {loading && <div className="notif-panel__empty">Loading…</div>}
            {!loading && items.length === 0 && visibleDocReminders.length === 0 && (
              <div className="notif-panel__empty">No notifications yet.</div>
            )}
            {!loading &&
              items.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item ${n.is_read ? 'notif-item--read' : ''}`}
                >
                  <div className="notif-item__row">
                    <button
                      type="button"
                      className="notif-item__read-btn"
                      onClick={() => { if (!n.is_read) markRead(n.id) }}
                    >
                      <span className="notif-item__title">{n.title || 'Notice'}</span>
                      <span className="notif-item__msg">{n.message}</span>
                      <span className="notif-item__meta">
                        {n.scheduled_for ? fmtDMY(n.scheduled_for) : ''}
                        {!n.is_read && <span className="notif-item__dot" />}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="notif-item__dismiss"
                      aria-label="Dismiss notification"
                      onClick={() => dismiss(n.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [navMode, setNavMode] = useState('full')
  const [focusedSection, setFocusedSection] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const { appTitle } = useSettings()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { trashedTasks } = useAIPlanner()

  // Cmd+K / Ctrl+K opens global task search
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'
  const can = (module, action) => hasPermission(user, module, action)

  const { items: docExpiryItems } = useDocumentExpiry()
  const docReminders = useDocumentReminders(docExpiryItems)

  const toggleSidebar = useCallback(() => {
    // In rail mode, hamburger returns to the full sidebar navigation.
    if (navMode === 'rail') {
      setNavMode('full')
      setFocusedSection(null)
      setIsSidebarOpen(true)
      return
    }
    setIsSidebarOpen(prev => !prev)
  }, [navMode])
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), [])
  const openFocusedSection = useCallback((sectionKey) => {
    setNavMode('rail')
    setFocusedSection(sectionKey)
    setIsSidebarOpen(true)
  }, [])

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

  const HR_ROUTES = ['/employees', '/attendance', '/annual-leave']
  const ADMIN_NAV_ROUTES = ['/settings', '/roles-permissions', '/admin']
  const LISTS_ROUTES = ['/lists/sim-cards']
  const isHrActive = HR_ROUTES.some(r => location.pathname.startsWith(r))
  const isAdminNavActive = isAdmin && ADMIN_NAV_ROUTES.some(r => location.pathname.startsWith(r))
  const isListsActive = LISTS_ROUTES.some(r => location.pathname.startsWith(r))
  const isInfluencersActive = location.pathname.startsWith('/influencers')
  const isManagementActive = location.pathname.startsWith('/management')
  const isReportsActive = location.pathname.startsWith('/reports')
  const hasAnyInfluencerAccess = hasAnyModulePermission(user, 'influencers')
  const hasAnyListsAccess = hasAnyModulePermission(user, 'sim_cards')
  const hasAnyManagementAccess = hasAnyModulePermission(user, 'document_expiry')
  const hasWeeklyReportsAccess = can('weekly_reports', 'view')
  const currentSectionLabel = useMemo(() => {
    if (location.pathname.startsWith('/employees')) return 'Employees'
    if (location.pathname.startsWith('/attendance')) return 'Attendance'
    if (location.pathname.startsWith('/annual-leave')) return 'Annual Leave'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    if (location.pathname.startsWith('/roles-permissions')) return 'Roles & Permissions'
    if (location.pathname.startsWith('/lists/sim-cards')) return 'Sim Cards List'
    if (location.pathname.startsWith('/influencers')) return 'Influencers'
    if (location.pathname.startsWith('/account')) return 'My Account'
    if (location.pathname.startsWith('/management/payments')) return 'Company payments'
    if (location.pathname.startsWith('/management/document-expiry')) return 'Document Expiry Tracker'
    if (location.pathname.startsWith('/reports/weekly-report/weekly-ads'))   return 'Weekly Ads Report'
    if (location.pathname.startsWith('/reports/weekly-report/sales'))        return 'Weekly Sales Reports'
    if (location.pathname.startsWith('/reports/weekly-report/slow-moving'))  return 'Weekly Slow Moving Sales Report'
    if (location.pathname.startsWith('/reports/weekly-report/other-family')) return 'Weekly Other Family Sales Report'
    if (location.pathname.startsWith('/reports')) return 'Reports'
    if (location.pathname.startsWith('/taxation/ksa-vat')) return 'KSA VAT Tax'
    if (location.pathname.startsWith('/admin/item-report-groups')) return 'Item Report Groups'
    if (location.pathname === '/projects/dashboard') return 'AI Dashboard'
    if (location.pathname.startsWith('/projects/')) return 'Today\'s Plan'
    if (location.pathname === '/projects') return 'AI Task Planner'
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
  ].filter(Boolean)

  const adminNavItems = [
    isAdmin && { label: 'Settings', to: '/settings' },
    isAdmin && { label: 'Roles & Permissions', to: '/roles-permissions' },
    isAdmin && { label: 'Item Report Groups', to: '/admin/item-report-groups' },
  ].filter(Boolean)
  const listsItems = [
    can('sim_cards', 'view') && { label: 'Sim Cards List', to: '/lists/sim-cards' },
  ].filter(Boolean)

  const managementItems = [
    can('document_expiry', 'view') && { label: 'Document Expiry Tracker', to: '/management/document-expiry' },
    can('document_expiry', 'view') && { label: 'Payments', to: '/management/payments' },
  ].filter(Boolean)

  const isTaxationActive = location.pathname.startsWith('/taxation')

  const TAXATION_ITEMS = [
    hasWeeklyReportsAccess && { label: 'KSA VAT Tax', to: '/taxation/ksa-vat' },
  ].filter(Boolean)

  const REPORTS_ITEMS = [
    hasWeeklyReportsAccess && { label: 'Weekly Ads Report',    to: '/reports/weekly-report/weekly-ads' },
    hasWeeklyReportsAccess && { label: 'Weekly Sales Reports', to: '/reports/weekly-report/sales'      },
  ].filter(Boolean)

  const focusedSectionConfig = useMemo(() => {
    const withIcons = (items) => items.map((item) => ({ ...item, icon: item.icon || itemIconToken(item.label) }))
    const sections = {
      hr: { title: 'HR', items: withIcons(hrItems) },
      admin: { title: 'Admin', items: withIcons(adminNavItems) },
      lists: { title: 'Lists', items: withIcons(listsItems) },
      influencers: { title: 'Influencers', items: withIcons(INFLUENCER_ITEMS) },
      planner: {
        title: 'Planner',
        items: withIcons(isAdmin ? PLANNER_NAV_ITEMS : []),
      },
      management: { title: 'Management', items: withIcons(managementItems) },
      reports: { title: 'Reports', items: withIcons(REPORTS_ITEMS) },
    }
    return sections[focusedSection] || null
  }, [
    focusedSection,
    hrItems,
    adminNavItems,
    listsItems,
    INFLUENCER_ITEMS,
    isAdmin,
    managementItems,
    REPORTS_ITEMS,
  ])

  // Flat list of every link shown in the sidebar (sidebar + topbar search). Keep in sync with nav groups above.
  const allNavItems = useMemo(() => [
    ...hrItems.map(i => ({ ...i, group: 'HR' })),
    ...listsItems.map(i => ({ ...i, group: 'Lists' })),
    ...INFLUENCER_ITEMS.map(i => ({ ...i, group: 'Influencers' })),
    ...(isAdmin ? PLANNER_NAV_ITEMS.map(i => ({ ...i, group: 'AI Planner', searchHint: 'planner projects tasks ai' })) : []),
    ...managementItems.map(i => ({
      ...i,
      group: 'Management',
      searchHint:
        i.to === '/management/payments'
          ? 'company payments asad main shop expense salary vat bill subscription supplier'
          : i.to === '/management/document-expiry'
            ? 'document licence trade license vat compliance expiry'
            : '',
    })),
    ...REPORTS_ITEMS.map(i => ({
      ...i,
      group: 'Weekly Report',
      searchHint: 'weekly ads slow moving other family sales inventory performance reports zoho',
    })),
    ...TAXATION_ITEMS.map(i => ({
      ...i,
      group: 'Taxation',
      searchHint: 'ksa vat tax quarterly filing invoices credit notes zoho books',
    })),
    ...adminNavItems.map(i => ({
      ...i,
      group: 'Admin',
      searchHint:
        i.to === '/admin/item-report-groups'
          ? 'item report groups slow moving other family weekly mapping zoho sku'
          : '',
    })),
    { label: 'My Account', to: '/account', group: 'Account' },
  ], [hrItems, adminNavItems, listsItems, INFLUENCER_ITEMS, isAdmin, managementItems, REPORTS_ITEMS, TAXATION_ITEMS])

  const showSidebarBackdrop = isSidebarOpen && navMode === 'full'

  return (
    <div className={`app ${isSidebarOpen && navMode === 'rail' ? 'app--nav-rail' : ''}`.trim()}>
      <div className="app__aurora app__aurora--left" aria-hidden />
      <div className="app__aurora app__aurora--right" aria-hidden />
      <div className="app__aurora app__aurora--bottom" aria-hidden />

      <AnimatePresence>
        {showSidebarBackdrop && (
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
        className={`app-sidebar ${isSidebarOpen ? 'app-sidebar--open' : ''} ${navMode === 'rail' ? 'app-sidebar--rail' : ''}`}
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
            <SidebarSearch allItems={allNavItems} onNavigate={closeSidebar} enableHotkey={false} />

            {navMode === 'rail' && focusedSectionConfig ? (
              <>
                <div className="app-sidebar__section-label" role="presentation">
                  {focusedSectionConfig.title}
                </div>
                <div className="nav-rail">
                  {focusedSectionConfig.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `nav-rail__link ${isActive ? 'nav-rail__link--active' : ''}`}
                    >
                      <span className="nav-rail__icon" aria-hidden>{item.icon}</span>
                      <span className="nav-rail__label">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </>
            ) : (
              <>
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
                      onClick={() => openFocusedSection('hr')}
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
                        onClick={() => openFocusedSection('lists')}
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
                        onClick={() => openFocusedSection('influencers')}
                      >
                        <span className="nav-group__link-dot" aria-hidden />
                        {item.label}
                      </NavLink>
                    ))}
                  </NavGroup>
                )}

                {TAXATION_ITEMS.length > 0 && (
                  <NavGroup label="Taxation" hint="KSA VAT" isActive={isTaxationActive}>
                    {TAXATION_ITEMS.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={subLinkClass}
                      >
                        <span className="nav-group__link-dot" aria-hidden />
                        {item.label}
                      </NavLink>
                    ))}
                  </NavGroup>
                )}

                {isAdmin && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      AI Planner
                    </div>
                    <NavGroup label="Planner" hint="AI-powered" isActive={location.pathname.startsWith('/projects')}>
                      {PLANNER_NAV_ITEMS.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass}
                          onClick={() => openFocusedSection('planner')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                          {item.to === '/projects/trash' && trashedTasks.length > 0 && (
                            <span className="nav-trash-badge">{trashedTasks.length}</span>
                          )}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {hasAnyManagementAccess && managementItems.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Management
                    </div>
                    <NavGroup label="Management" hint="Compliance" isActive={isManagementActive}>
                      {managementItems.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass}
                          onClick={() => openFocusedSection('management')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {REPORTS_ITEMS.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Reports
                    </div>
                    <NavGroup label="Weekly Report" hint="Performance" isActive={isReportsActive}>
                      {REPORTS_ITEMS.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass}
                          onClick={() => openFocusedSection('reports')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {adminNavItems.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Admin
                    </div>
                    <NavGroup label="Admin" hint="System" isActive={isAdminNavActive} defaultOpen={isAdminNavActive}>
                      {adminNavItems.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass}
                          onClick={() => openFocusedSection('admin')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}
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
              aria-label={
                navMode === 'rail'
                  ? 'Open full navigation menu'
                  : isSidebarOpen
                    ? 'Close menu'
                    : 'Open menu'
              }
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

          <div className="app-topbar__search">
            <SidebarSearch allItems={allNavItems} onNavigate={closeSidebar} className="nav-search--topbar" />
          </div>

          {/* Cmd+K task search trigger */}
          <button
            type="button"
            className="app-topbar__search-btn"
            onClick={() => setSearchOpen(true)}
            title="Search tasks (⌘K)"
            aria-label="Open task search"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="app-topbar__search-btn-label">Search tasks</span>
            <span className="app-topbar__search-btn-kbd">⌘K</span>
          </button>

          <div className="app-topbar__meta">
            <div className="app-topbar__chip">
              <span className="app-topbar__chip-dot" aria-hidden />
              <span className="app-topbar__chip-text" title={appTitle || 'HR Attendance'}>
                {appTitle || 'HR Attendance'}
              </span>
            </div>
            <div className="app-topbar__user-pill">
              <span className="app-topbar__user-name">{user?.displayName || user?.username}</span>
              <span className="app-topbar__user-badge">{user?.role}</span>
            </div>
            {isAdmin && <NotificationsBell docReminders={docReminders} />}
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

      {/* Global task search modal */}
      {searchOpen && <TaskSearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
