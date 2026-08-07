import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth, hasPermission, hasAnyModulePermission } from '../contexts/AuthContext'
import { NotificationsBell } from './notifications/NotificationsBell'
import { RoleGuard } from './RoleGuard'
import { ThemeToggle } from './ThemeToggle'
import { useAIPlanner } from '../contexts/AIPlannerContext'
import { TaskSearchModal } from './planner/TaskSearchModal'
import './Layout.css'

/** AI Planner sub-routes (admin sidebar, rail, and global nav search). */
const PLANNER_NAV_ITEMS = [
  { to: '/projects/linear', label: 'Issues'        },  // Linear-style tracker (Phase 2+)
  { to: '/projects',        label: 'AI Task List'  },  // Legacy AI planner (kept, not promoted)
  { to: '/projects/today',  label: "Today's Plan"  },
  { to: '/projects/dashboard', label: 'Dashboard'  },
  { to: '/projects/trash',  label: 'Deleted'       },
]

const AI_NAV_ITEMS = [
  { to: '/ai/usage', label: 'AI Usage' },
  {
    to: '/ai/noon-integration',
    label: 'Noon API Integration',
    adminOnly: true,
    searchHint: 'noon partners api service account whoami product admin integration',
  },
]

const AMAZON_NAV_ITEMS = [
  {
    to: '/ai/amazon-spapi-test',
    label: 'Amazon SP-API Test',
    searchHint: 'selling partner api marketplaces sandbox lwa',
  },
  {
    to: '/ai/amazon-orders',
    label: 'Amazon Orders',
    searchHint: 'amazon.ae amazon.sa orders uae ksa marketplace selling partner',
  },
  {
    to: '/ai/amazon-dashboard',
    label: 'Amazon BI Dashboard',
    searchHint: 'amazon bi cache sales sku dashboard uae ksa',
  },
  {
    to: '/ai/amazon-sync-health',
    label: 'Amazon Sync Health',
    adminOnly: true,
    searchHint: 'amazon sync health rate limit 429 cooldown request id admin',
  },
  {
    to: '/ai/amazon-zoho-stock',
    label: 'Amazon + Zoho Stock',
    adminOnly: true,
    searchHint: 'amazon zoho stock comparison inventory fba life smile warehouse mismatch out of stock',
  },
  {
    to: '/ai/sku-channel-coverage',
    label: 'SKU Channel Coverage',
    adminOnly: true,
    searchHint: 'sku channel coverage zoho amazon uae ksa noon listing active missing',
  },
  {
    to: '/ai/amazon-out-of-stock-clearance',
    label: 'Amazon Out of Stock Clearance',
    adminOnly: true,
    searchHint: 'amazon out of stock clearance zoho vigil life smile replenish uae ksa',
  },
  {
    to: '/amazon/ksa-rto-labeling',
    label: 'Amazon KSA RTO Labeling',
    searchHint: 'amazon ksa rto fnsku label upload pdf sheet agent warehouse lifesmile',
  },
  { to: '/ai/amazon-listing', label: 'Amazon Listing' },
  { to: '/ai/amazon-bulk-listing', label: 'Amazon Bulk Generator' },
  { to: '/ai/listing-batches', label: 'Listing Batches' },
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

function pathMatchesNavItem(pathname, to) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/'
  const target = String(to || '').replace(/\/+$/, '') || '/'
  return path === target || (target !== '/' && path.startsWith(`${target}/`))
}

function longestMatchingNavPath(pathname, items) {
  let best = ''
  for (const item of items || []) {
    const to = item?.to
    if (!to || !pathMatchesNavItem(pathname, to)) continue
    if (String(to).length > best.length) best = String(to)
  }
  return best
}

function navItemIsActive(pathname, item, items) {
  if (!item?.to) return false
  return String(item.to) === longestMatchingNavPath(pathname, items)
}

function navLinkClassName(baseClass, activeClass, isActive) {
  return `${baseClass} ${isActive ? activeClass : ''}`.trim()
}

const BRAND_TITLE = 'Business Intelligence (BI) - Life Smile'

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [navMode, setNavMode] = useState('full')
  const [focusedSection, setFocusedSection] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const { appTitle } = useSettings()
  const displayAppTitle = appTitle || BRAND_TITLE
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
  const aiHubNavItems = useMemo(
    () => AI_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin]
  )
  const amazonNavItems = useMemo(
    () => AMAZON_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin]
  )
  const isEmployee = user?.role === 'employee'
  const can = (module, action) => hasPermission(user, module, action)

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
    navLinkClassName('app-sidebar__link', 'app-sidebar__link--active', isActive)

  const subLinkClass = useCallback((item, items) => () =>
    navLinkClassName(
      'nav-group__link',
      'nav-group__link--active',
      navItemIsActive(location.pathname, item, items)
    ), [location.pathname])

  const railLinkClass = useCallback((item, items) => () =>
    navLinkClassName(
      'nav-rail__link',
      'nav-rail__link--active',
      navItemIsActive(location.pathname, item, items)
    ), [location.pathname])

  const handleLogout = () => {
    closeSidebar()
    logout()
    navigate('/login', { replace: true })
  }

  const homePath =
    isEmployee ? '/account' : can('attendance', 'view') ? '/attendance' : '/account'

  const HR_ROUTES = ['/employees', '/attendance', '/annual-leave']
  const ADMIN_NAV_ROUTES = ['/settings', '/roles-permissions', '/admin/item-report-groups', '/admin/ai-budget']
  const LISTS_ROUTES = ['/lists/sim-cards']
  const isHrActive = HR_ROUTES.some(r => location.pathname.startsWith(r))
  const isAdminNavActive = isAdmin && ADMIN_NAV_ROUTES.some(r => location.pathname.startsWith(r))
  const isListsActive = LISTS_ROUTES.some(r => location.pathname.startsWith(r))
  const isInfluencersActive = location.pathname.startsWith('/influencers')
  const isHealthFitnessActive = location.pathname.startsWith('/health-fitness')
  const isManagementActive = location.pathname.startsWith('/management')
  const isPricesActive = location.pathname.startsWith('/prices')
  const isReportsActive = location.pathname.startsWith('/reports')
  const isZohoActive = location.pathname.startsWith('/admin/zoho')
  const isAmazonActive =
    location.pathname.startsWith('/ai/amazon') ||
    location.pathname.startsWith('/ai/listing-batches')
  const isAiHubActive = location.pathname.startsWith('/ai') && !isAmazonActive
  const hasAnyInfluencerAccess = hasAnyModulePermission(user, 'influencers')
  const hasAnyListsAccess = hasAnyModulePermission(user, 'sim_cards')
  const hasAnyManagementAccess =
    hasAnyModulePermission(user, 'document_expiry') ||
    hasAnyModulePermission(user, 'company_payments') ||
    isAdmin
  const hasWeeklyReportsAccess = can('weekly_reports', 'view')
  const hasPlannerAccess = isAdmin || can('planner', 'view')
  const hasAiHubAccess =
    isAdmin ||
    user?.role === 'warehouse' ||
    hasPlannerAccess ||
    can('prices', 'view')
  const hasAmazonAccess = hasAiHubAccess && amazonNavItems.length > 0
  const currentSectionLabel = useMemo(() => {
    if (location.pathname.startsWith('/employees')) return 'Employees'
    if (location.pathname.startsWith('/attendance')) return 'Attendance'
    if (location.pathname.startsWith('/annual-leave')) return 'Annual Leave'
    if (location.pathname.startsWith('/health-fitness/dashboard')) return 'Nutrition Dashboard'
    if (location.pathname.startsWith('/health-fitness/food-log')) return 'Food Log'
    if (location.pathname.startsWith('/health-fitness/nutrient-gaps')) return 'Nutrient Gap Analysis'
    if (location.pathname.startsWith('/health-fitness/meal-plan')) return 'Meal Plan Builder'
    if (location.pathname.startsWith('/health-fitness/fitness-plan')) return 'Fitness Plan'
    if (location.pathname.startsWith('/health-fitness/progress')) return 'Progress Tracker'
    if (location.pathname.startsWith('/health-fitness/food-library')) return 'Food Library'
    if (location.pathname.startsWith('/health-fitness/calculators')) return 'Health Calculators'
    if (location.pathname.startsWith('/health-fitness/settings')) return 'Nutrition Settings'
    if (location.pathname.startsWith('/health-fitness')) return 'Health & Fitness'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    if (location.pathname.startsWith('/roles-permissions')) return 'Roles & Permissions'
    if (location.pathname.startsWith('/lists/sim-cards')) return 'Sim Cards List'
    if (location.pathname.startsWith('/influencers/dashboard')) return 'Dashboard'
    if (location.pathname.startsWith('/influencers/contracts')) return 'Performance Contracts'
    if (location.pathname.startsWith('/influencers/performance')) return 'Performance'
    if (location.pathname.startsWith('/influencers/payments')) return 'Payments & ROI'
    if (location.pathname.startsWith('/influencers/timeline')) return 'Timeline'
    if (location.pathname.startsWith('/influencers/analytics')) return 'Analytics'
    if (location.pathname.startsWith('/influencers/list')) return 'Influencer Roster'
    if (location.pathname.startsWith('/influencers/agreements')) return 'Agreements'
    if (location.pathname.startsWith('/influencers')) return 'Influencers'
    if (location.pathname.startsWith('/account')) return 'My Account'
    if (location.pathname.startsWith('/management/amazon-uae-payment-clearing')) return 'Amazon UAE Payment Clearing'
    if (location.pathname.startsWith('/management/amazon-payment-clearing')) return 'Amazon KSA Payment Clearing'
    if (location.pathname.startsWith('/management/amazon-return-reconciliation')) return 'Amazon Return Reconciliation'
    if (location.pathname.startsWith('/management/purchase-planning')) return 'Purchase Planning'
    if (location.pathname.startsWith('/management/inventory-health')) return 'Inventory Health'
    if (location.pathname.startsWith('/management/account-balance-watchlist')) return 'Account Balance Watchlist'
    if (location.pathname.startsWith('/management/payments')) return 'Company payments'
    if (location.pathname.startsWith('/prices/all-prices-ksa')) return 'All Prices (KSA)'
    if (location.pathname.startsWith('/prices/all-prices-custom')) return 'All UAE Prices (Custom)'
    if (location.pathname.startsWith('/prices/all-prices')) return 'All Prices (UAE)'
    if (location.pathname.startsWith('/prices/historical-prices')) return 'Historical Prices'
    if (location.pathname.startsWith('/prices/duplicate-cleanup')) return 'Duplicate Price Cleanup'
    if (location.pathname.startsWith('/prices/composite-items/reports')) return 'Composite Items Price Reports'
    if (location.pathname.startsWith('/prices/composite-items-custom')) return 'Composite Items Prices (Custom)'
    if (location.pathname.startsWith('/prices/composite-items')) return 'Composite Items Prices'
    if (location.pathname.startsWith('/prices/saved-composite-items-custom')) return 'Saved Composite Items (Custom)'
    if (location.pathname.startsWith('/prices/saved-composite-items')) return 'Saved Composite Items'
    if (location.pathname.startsWith('/management/document-expiry')) return 'Document Expiry Tracker'
    if (location.pathname.startsWith('/management/subscriptions')) return 'Subscription Management'
    if (location.pathname.startsWith('/reports/weekly-report/weekly-ads'))   return 'Weekly Ads Report'
    if (location.pathname.startsWith('/reports/weekly-report/sales'))        return 'Weekly Sales Reports'
    if (location.pathname.startsWith('/reports/weekly-report/slow-moving'))  return 'Weekly Slow Moving Sales Report'
    if (location.pathname.startsWith('/reports/weekly-report/other-family')) return 'Weekly Other Family Sales Report'
    if (location.pathname.startsWith('/reports/zoho-item-images')) return 'Zoho Item Image Fetcher'
    if (location.pathname.startsWith('/reports/sales-vs-expenses')) return 'Sales vs Expenses'
    if (location.pathname.startsWith('/reports')) return 'Reports'
    if (location.pathname.startsWith('/taxation/ksa-vat')) return 'KSA VAT Tax'
    if (location.pathname.startsWith('/admin/zoho/bulk-quantity-adjustment')) return 'Bulk Quantity Adjustment'
    if (location.pathname.startsWith('/admin/zoho/bulk-invoice')) return 'Bulk Zoho Invoice'
    if (location.pathname.startsWith('/ai/amazon-zoho-stock')) return 'Amazon + Zoho Stock'
    if (location.pathname.startsWith('/ai/amazon-out-of-stock-clearance')) return 'Amazon Out of Stock Clearance'
    if (location.pathname.startsWith('/admin/ai-budget')) return 'AI Budget Settings'
    if (location.pathname.startsWith('/admin/item-report-groups')) return 'Item Report Groups'
    if (location.pathname.startsWith('/ai/noon-integration')) return 'Noon API Integration'
    if (location.pathname.startsWith('/ai/usage')) return 'AI Usage'
    if (location.pathname.startsWith('/ai/amazon-sync-health')) return 'Amazon Sync Health'
    if (location.pathname.startsWith('/ai/amazon-dashboard')) return 'Amazon BI Dashboard'
    if (location.pathname.startsWith('/ai/amazon-orders')) return 'Amazon Orders'
    if (location.pathname.startsWith('/ai/amazon-spapi-test')) return 'Amazon SP-API Test'
    if (location.pathname.startsWith('/ai/amazon-bulk-listing')) return 'Amazon Bulk Generator'
    if (location.pathname.startsWith('/ai/listing-batches')) return 'Listing Batches'
    if (location.pathname.startsWith('/ai/amazon-listing')) return 'Amazon Listing'
    if (location.pathname === '/projects/dashboard') return 'AI Dashboard'
    if (location.pathname === '/projects/team')      return 'Issues'
    if (location.pathname.startsWith('/projects/linear')) return 'Issues'
    if (location.pathname.startsWith('/projects/')) return 'Today\'s Plan'
    if (location.pathname === '/projects') return 'AI Task Planner'
    return 'Dashboard'
  }, [location.pathname])

  const INFLUENCER_ITEMS = [
    can('influencers', 'view') && { label: 'Dashboard', to: '/influencers/dashboard' },
    can('influencers', 'view') && { label: 'Performance Contracts', to: '/influencers/contracts' },
    can('influencers', 'performance') && { label: 'Performance', to: '/influencers/performance' },
    can('influencers', 'payments') && { label: 'Payments & ROI', to: '/influencers/payments' },
    can('influencers', 'view') && { label: 'Timeline', to: '/influencers/timeline' },
    can('influencers', 'view') && { label: 'Analytics', to: '/influencers/analytics' },
    can('influencers', 'view') && { label: 'Influencer Roster', to: '/influencers/list' },
    can('influencers', 'agreements') && { label: 'Agreements', to: '/influencers/agreements' },
  ].filter(Boolean)

  const hrItems = [
    can('employees', 'view') && { label: 'Employees', to: '/employees' },
    can('attendance', 'view') && { label: 'Attendance', to: '/attendance', end: true },
    (isEmployee || can('leave', 'view')) && { label: 'Annual Leave', to: '/annual-leave' },
  ].filter(Boolean)

  const HEALTH_FITNESS_ITEMS = [
    { label: 'Nutrition Dashboard', to: '/health-fitness/dashboard' },
    { label: 'Food Log', to: '/health-fitness/food-log' },
    { label: 'Nutrient Gap Analysis', to: '/health-fitness/nutrient-gaps' },
    { label: 'Meal Plan Builder', to: '/health-fitness/meal-plan' },
    { label: 'Fitness Plan', to: '/health-fitness/fitness-plan' },
    { label: 'Progress Tracker', to: '/health-fitness/progress' },
    { label: 'Food Library', to: '/health-fitness/food-library' },
    { label: 'Health Calculators', to: '/health-fitness/calculators' },
    { label: 'Settings', to: '/health-fitness/settings' },
  ]

  const adminNavItems = [
    isAdmin && { label: 'Settings', to: '/settings' },
    isAdmin && { label: 'Roles & Permissions', to: '/roles-permissions' },
    isAdmin && { label: 'AI Budget', to: '/admin/ai-budget' },
    isAdmin && { label: 'Item Report Groups', to: '/admin/item-report-groups' },
  ].filter(Boolean)
  const zohoItems = [
    isAdmin && { label: 'Bulk Zoho Invoice', to: '/admin/zoho/bulk-invoice' },
    isAdmin && { label: 'Bulk Quantity Adjustment', to: '/admin/zoho/bulk-quantity-adjustment' },
  ].filter(Boolean)
  const listsItems = [
    can('sim_cards', 'view') && { label: 'Sim Cards List', to: '/lists/sim-cards' },
  ].filter(Boolean)

  const pricesItems = [
    can('prices', 'view') && { label: 'All Prices (UAE)', to: '/prices/all-prices' },
    can('prices', 'view') && { label: 'All UAE Prices (Custom)', to: '/prices/all-prices-custom' },
    can('prices', 'view') && { label: 'All Prices (KSA)', to: '/prices/all-prices-ksa' },
    can('prices', 'view') && { label: 'Historical Prices', to: '/prices/historical-prices' },
    can('prices', 'view') && { label: 'Duplicate Price Cleanup', to: '/prices/duplicate-cleanup' },
    can('prices', 'view') && { label: 'Composite Items Prices', to: '/prices/composite-items' },
    can('prices', 'view') && { label: 'Composite Items Prices (Custom)', to: '/prices/composite-items-custom' },
    can('prices', 'view') && { label: 'Saved Composite Items', to: '/prices/saved-composite-items' },
    can('prices', 'view') && { label: 'Saved Composite Items (Custom)', to: '/prices/saved-composite-items-custom' },
    can('prices', 'view') && { label: 'Composite Items Price Reports', to: '/prices/composite-items/reports' },
  ].filter(Boolean)

  const hasAnyPricesAccess = pricesItems.length > 0

  useEffect(() => {
    if (!hasAnyPricesAccess || !location.pathname.startsWith('/prices')) return
    setNavMode('rail')
    setFocusedSection('prices')
    setIsSidebarOpen(true)
  }, [hasAnyPricesAccess, location.pathname])

  useEffect(() => {
    if (!hasWeeklyReportsAccess || !location.pathname.startsWith('/reports')) return
    setNavMode('rail')
    setFocusedSection('reports')
    setIsSidebarOpen(true)
  }, [hasWeeklyReportsAccess, location.pathname])

  useEffect(() => {
    if (!hasAiHubAccess || !location.pathname.startsWith('/ai') || isAmazonActive) return
    setNavMode('rail')
    setFocusedSection('ai')
    setIsSidebarOpen(true)
  }, [hasAiHubAccess, isAmazonActive, location.pathname])

  useEffect(() => {
    if (!hasAmazonAccess || !isAmazonActive) return
    setNavMode('rail')
    setFocusedSection('amazon')
    setIsSidebarOpen(true)
  }, [hasAmazonAccess, isAmazonActive])

  const isAutoRailPath = useMemo(() => {
    const path = location.pathname
    if (hasAnyPricesAccess && path.startsWith('/prices')) return true
    if (hasWeeklyReportsAccess && path.startsWith('/reports')) return true
    if (hasAmazonAccess && (path.startsWith('/ai/amazon') || path.startsWith('/ai/listing-batches'))) return true
    if (hasAiHubAccess && path.startsWith('/ai')) return true
    return false
  }, [location.pathname, hasAnyPricesAccess, hasWeeklyReportsAccess, hasAiHubAccess, hasAmazonAccess])

  // Slim rail + left inset only on Prices / Reports / AI / Amazon. Everywhere else use the normal overlay sidebar.
  useEffect(() => {
    if (isAutoRailPath) return
    setNavMode('full')
    setFocusedSection(null)
    setIsSidebarOpen(false)
  }, [isAutoRailPath, location.pathname])

  const managementItems = [
    can('document_expiry', 'view') && { label: 'Document Expiry Tracker', to: '/management/document-expiry' },
    can('subscriptions', 'view') && { label: 'Subscription Management', to: '/management/subscriptions' },
    can('company_payments', 'view') && { label: 'Payments', to: '/management/payments' },
    isAdmin && { label: 'Purchase Planning', to: '/management/purchase-planning' },
    isAdmin && { label: 'Inventory Health', to: '/management/inventory-health' },
    isAdmin && { label: 'Account Balance Watchlist', to: '/management/account-balance-watchlist' },
    isAdmin && { label: 'Amazon KSA Payment Clearing', to: '/management/amazon-payment-clearing' },
    isAdmin && { label: 'Amazon UAE Payment Clearing', to: '/management/amazon-uae-payment-clearing' },
    isAdmin && { label: 'Amazon Return Reconciliation', to: '/management/amazon-return-reconciliation' },
  ].filter(Boolean)

  const isTaxationActive = location.pathname.startsWith('/taxation')

  const TAXATION_ITEMS = [
    can('taxation', 'view') && { label: 'KSA VAT Tax', to: '/taxation/ksa-vat' },
  ].filter(Boolean)

  const REPORTS_ITEMS = [
    hasWeeklyReportsAccess && { label: 'Weekly Ads Report',    to: '/reports/weekly-report/weekly-ads' },
    hasWeeklyReportsAccess && { label: 'Weekly Sales Reports', to: '/reports/weekly-report/sales'      },
    hasWeeklyReportsAccess && { label: 'Sales vs Expenses',    to: '/reports/sales-vs-expenses'        },
    hasWeeklyReportsAccess && { label: 'Zoho Item Images',     to: '/reports/zoho-item-images'         },
  ].filter(Boolean)

  const focusedSectionConfig = useMemo(() => {
    const withIcons = (items) => items.map((item) => ({ ...item, icon: item.icon || itemIconToken(item.label) }))
    const sections = {
      hr: { title: 'HR', items: withIcons(hrItems) },
      admin: { title: 'Admin', items: withIcons(adminNavItems) },
      lists: { title: 'Lists', items: withIcons(listsItems) },
      influencers: { title: 'Marketing / Social Media', items: withIcons(INFLUENCER_ITEMS) },
      planner: {
        title: 'Planner',
        items: withIcons(hasPlannerAccess ? PLANNER_NAV_ITEMS : []),
      },
      ai: {
        title: 'AI & Automation',
        items: withIcons(hasAiHubAccess ? aiHubNavItems : []),
      },
      amazon: {
        title: 'Amazon',
        items: withIcons(hasAmazonAccess ? amazonNavItems : []),
      },
      management: { title: 'Management', items: withIcons(managementItems) },
      prices: { title: 'Prices', items: withIcons(pricesItems) },
      reports: { title: 'Reports', items: withIcons(REPORTS_ITEMS) },
      zoho: { title: 'Zoho', items: withIcons(zohoItems) },
    }
    return sections[focusedSection] || null
  }, [
    focusedSection,
    hrItems,
    adminNavItems,
    listsItems,
    INFLUENCER_ITEMS,
    isAdmin,
    hasPlannerAccess,
    hasAiHubAccess,
    aiHubNavItems,
    hasAmazonAccess,
    amazonNavItems,
    managementItems,
    pricesItems,
    REPORTS_ITEMS,
    zohoItems,
  ])

  // Flat list of every link shown in the sidebar (sidebar + topbar search). Keep in sync with nav groups above.
  const allNavItems = useMemo(() => [
    ...hrItems.map(i => ({ ...i, group: 'HR' })),
    ...HEALTH_FITNESS_ITEMS.map(i => ({ ...i, group: 'Health & Fitness', searchHint: 'nutrition fitness food workout meal plan wellness coach' })),
    ...listsItems.map(i => ({ ...i, group: 'Lists' })),
    ...INFLUENCER_ITEMS.map(i => ({ ...i, group: 'Marketing / Social Media' })),
    ...(hasPlannerAccess
      ? PLANNER_NAV_ITEMS.map((i) => ({
          ...i,
          group: 'AI Planner',
          searchHint: 'planner projects tasks ai',
        }))
      : []),
    ...(hasAiHubAccess
      ? aiHubNavItems.map((i) => ({
          ...i,
          group: 'AI & Automation',
          searchHint: i.searchHint || 'openai usage budget amazon listing tokens cost',
        }))
      : []),
    ...(hasAmazonAccess
      ? amazonNavItems.map((i) => ({
          ...i,
          group: 'Amazon',
          searchHint: i.searchHint || 'amazon selling partner orders listings dashboard inventory fba',
        }))
      : []),
    ...pricesItems.map((i) => ({
      ...i,
      group: 'Prices',
      searchHint:
        i.to === '/prices/all-prices'
          ? 'all prices uae aed catalog sku zoho inventory pricing ecommerce'
          : i.to === '/prices/all-prices-custom'
            ? 'all uae prices custom vat advertising profit commission catalog'
          : i.to === '/prices/all-prices-ksa'
            ? 'all prices ksa sar catalog sku zoho inventory pricing ecommerce'
          : i.to === '/prices/historical-prices'
          ? 'historical prices old production price audit replaced moved duplicate cleanup import'
          : i.to === '/prices/duplicate-cleanup'
          ? 'duplicate price cleanup active item no itemno safe auto conflict review'
          : i.to === '/prices/composite-items/reports'
            ? 'composite items price report zoho all composites incremental full saved reports components'
          : i.to === '/prices/composite-items-custom'
            ? 'composite items prices custom vat commission advertising profit editable rates bom bundle'
          : i.to === '/prices/composite-items'
            ? 'composite items prices bom bundle kit assembly components rolled up'
            : i.to === '/prices/saved-composite-items-custom'
              ? 'saved composite items custom skus bundle totals editable rates expandable'
            : i.to === '/prices/saved-composite-items'
              ? 'saved composite items skus bundle totals saved prices expandable'
              : '',
    })),
    ...managementItems.map(i => ({
      ...i,
      group: 'Management',
      searchHint:
        i.to === '/management/purchase-planning'
          ? 'purchase planning low stock vigil csv wholesale replenishment zoho purchase order po'
          : i.to === '/management/amazon-payment-clearing'
            ? 'amazon ksa payment clearing settlement report zoho invoice match payout fees preview sar'
          : i.to === '/management/amazon-uae-payment-clearing'
            ? 'amazon uae payment clearing settlement report zoho invoice match payout fees preview aed'
          : i.to === '/management/account-balance-watchlist'
            ? 'zoho books account balance watchlist bank cash clearing vat finance monitoring'
          : i.to === '/management/amazon-return-reconciliation'
            ? 'amazon return reconciliation removal order fnsku labels cartons qty agent report ksa'
          : i.to === '/management/payments'
          ? 'company payments asad main shop expense salary vat bill subscription supplier'
          : i.to === '/management/document-expiry'
            ? 'document licence trade license vat compliance expiry'
          : i.to === '/management/subscriptions'
            ? 'subscription management chatgpt cursor aws zoho adobe envato vercel invoice payment renewal'
            : '',
    })),
    ...REPORTS_ITEMS.map(i => ({
      ...i,
      group: 'Weekly Report',
      searchHint: 'weekly ads slow moving other family sales inventory performance reports zoho sku item images',
    })),
    ...TAXATION_ITEMS.map(i => ({
      ...i,
      group: 'Taxation',
      searchHint: 'ksa vat tax quarterly filing invoices credit notes zoho books',
    })),
    ...zohoItems.map(i => ({
      ...i,
      group: 'Zoho',
      searchHint: 'bulk zoho invoice sku customer warehouse line items inventory bulk quantity adjustment stock',
    })),
    ...adminNavItems.map(i => ({
      ...i,
      group: 'Admin',
      searchHint:
        i.to === '/admin/item-report-groups'
          ? 'item report groups slow moving other family weekly mapping zoho sku'
          : i.to === '/admin/ai-budget'
            ? 'ai budget openai daily monthly limit tokens generation'
            : '',
    })),
    { label: 'My Account', to: '/account', group: 'Account' },
  ], [hrItems, adminNavItems, listsItems, INFLUENCER_ITEMS, isAdmin, hasPlannerAccess, hasAiHubAccess, aiHubNavItems, hasAmazonAccess, amazonNavItems, managementItems, pricesItems, REPORTS_ITEMS, TAXATION_ITEMS, zohoItems])

  const showSidebarBackdrop = isSidebarOpen && navMode === 'full'

  return (
    <div className={`app ${isSidebarOpen && navMode === 'rail' && isAutoRailPath ? 'app--nav-rail' : ''}`.trim()}>
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
              <img
                src="/lifesmile-logo.png"
                alt="Life Smile"
                className="app-sidebar__brand-logo"
              />
              <span className="app-sidebar__brand-badge">Business Intelligence</span>
              <NavLink to={homePath} className="app-sidebar__brand" onClick={closeSidebar}>
                {displayAppTitle}
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
                      className={railLinkClass(item, focusedSectionConfig.items)}
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
                        className={subLinkClass(item, hrItems)}
                      onClick={() => openFocusedSection('hr')}
                    >
                      <span className="nav-group__link-dot" aria-hidden />
                      {item.label}
                    </NavLink>
                  ))}
                </NavGroup>

                <NavGroup label="Health & Fitness" hint="Wellness" isActive={isHealthFitnessActive} defaultOpen={isHealthFitnessActive}>
                  {HEALTH_FITNESS_ITEMS.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={subLinkClass(item, HEALTH_FITNESS_ITEMS)}
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
                        className={subLinkClass(item, listsItems)}
                        onClick={() => openFocusedSection('lists')}
                      >
                        <span className="nav-group__link-dot" aria-hidden />
                        {item.label}
                      </NavLink>
                    ))}
                  </NavGroup>
                )}

                {hasAnyInfluencerAccess && (
                  <NavGroup label="Marketing / Social Media" hint="Creator ops" isActive={isInfluencersActive}>
                    {INFLUENCER_ITEMS.map(item => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={subLinkClass(item, INFLUENCER_ITEMS)}
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
                        className={subLinkClass(item, TAXATION_ITEMS)}
                      >
                        <span className="nav-group__link-dot" aria-hidden />
                        {item.label}
                      </NavLink>
                    ))}
                  </NavGroup>
                )}

                {hasAnyPricesAccess && pricesItems.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Prices
                    </div>
                    <NavGroup label="Prices" hint="UAE & KSA" isActive={isPricesActive}>
                      {pricesItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass(item, pricesItems)}
                          onClick={() => openFocusedSection('prices')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {hasPlannerAccess && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      AI Planner
                    </div>
                    <NavGroup label="Planner" hint="AI-powered" isActive={location.pathname.startsWith('/projects')}>
                      {PLANNER_NAV_ITEMS.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass(item, PLANNER_NAV_ITEMS)}
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

                {hasAiHubAccess && aiHubNavItems.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      AI &amp; Automation
                    </div>
                    <NavGroup label="AI Hub" hint="Usage" isActive={isAiHubActive}>
                      {aiHubNavItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass(item, aiHubNavItems)}
                          onClick={() => openFocusedSection('ai')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {hasAmazonAccess && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Amazon
                    </div>
                    <NavGroup label="Amazon" hint="SP-API & listings" isActive={isAmazonActive}>
                      {amazonNavItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass(item, amazonNavItems)}
                          onClick={() => openFocusedSection('amazon')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
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
                          className={subLinkClass(item, managementItems)}
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
                          className={subLinkClass(item, REPORTS_ITEMS)}
                          onClick={() => openFocusedSection('reports')}
                        >
                          <span className="nav-group__link-dot" aria-hidden />
                          {item.label}
                        </NavLink>
                      ))}
                    </NavGroup>
                  </>
                )}

                {zohoItems.length > 0 && (
                  <>
                    <div className="app-sidebar__section-label" role="presentation">
                      Zoho
                    </div>
                    <NavGroup label="Zoho" hint="Inventory & invoices" isActive={isZohoActive}>
                      {zohoItems.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={subLinkClass(item, zohoItems)}
                          onClick={() => openFocusedSection('zoho')}
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
                          className={subLinkClass(item, adminNavItems)}
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
              <img src="/lifesmile-logo.png" alt="" className="app-topbar__chip-logo" aria-hidden />
              <span className="app-topbar__chip-text" title={displayAppTitle}>
                {displayAppTitle}
              </span>
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

      {/* Global task search modal */}
      {searchOpen && <TaskSearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
