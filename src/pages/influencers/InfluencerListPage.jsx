import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Smartphone,
  Users,
  MoreHorizontal,
  Eye,
  Pencil,
  Check,
  X,
  CreditCard,
  Trash2,
} from 'lucide-react'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { AddInfluencerPage } from './AddInfluencerPage'
import { resolveApiUrl } from '../../api/client'
import './influencers.css'

function InstagramCell({ handle, url, storedPicUrl }) {
  const [imgError, setImgError] = useState(false)
  const raw = handle ? handle.replace(/^@/, '').trim() : ''
  if (!raw) return <span className="inf-table__muted">—</span>
  const profileUrl = url || `https://www.instagram.com/${raw}/`
  const avatarSrc = storedPicUrl || resolveApiUrl(`/api/instagram-proxy/avatar/${encodeURIComponent(raw)}`)
  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inf-ig-cell"
      onClick={e => e.stopPropagation()}
    >
      <div className="inf-ig-cell__avatar-wrap">
        {!imgError ? (
          <img src={avatarSrc} alt={raw} className="inf-ig-cell__avatar" onError={() => setImgError(true)} />
        ) : (
          <div className="inf-ig-cell__avatar-fallback">{raw.slice(0, 2).toUpperCase()}</div>
        )}
        <div className="inf-ig-cell__ring" />
      </div>
      <span className="inf-ig-cell__handle">@{raw}</span>
    </a>
  )
}

function workflowBadgeClass(status) {
  const map = {
    'New Lead': 'inf-badge--new-lead', 'Contacted': 'inf-badge--contacted',
    'Waiting for Price': 'inf-badge--waiting', 'Waiting for Insights': 'inf-badge--waiting',
    'Under Review': 'inf-badge--review', 'Shortlisted': 'inf-badge--shortlisted',
    'Approved': 'inf-badge--approved', 'Rejected': 'inf-badge--rejected',
    'Shoot Scheduled': 'inf-badge--scheduled', 'Shot Completed': 'inf-badge--completed',
    'Waiting for Upload': 'inf-badge--upload', 'Uploaded': 'inf-badge--uploaded',
    'Payment Pending': 'inf-badge--payment', 'Paid': 'inf-badge--paid',
    'Closed': 'inf-badge--closed',
  }
  return map[status] || 'inf-badge--pending'
}

function paymentBadgeClass(status) {
  const map = {
    'Not Requested': 'inf-badge--not-requested', 'Bank Details Pending': 'inf-badge--waiting',
    'Ready for Payment': 'inf-badge--ready', 'Payment Processing': 'inf-badge--processing',
    'Paid': 'inf-badge--paid',
  }
  return map[status] || 'inf-badge--not-requested'
}

function parseFollowersCount(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = parseInt(String(value).replace(/[^0-9]/g, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

function formatFollowersCell(value) {
  const n = parseFollowersCount(value)
  if (n <= 0 && (value == null || value === '')) return '—'
  if (n > 0) return n.toLocaleString()
  return String(value).trim() || '—'
}

/** Follower count filter buckets (uses parseFollowersCount). */
const FOLLOWER_FILTER_OPTIONS = [
  { value: 'All', label: 'All Followers' },
  { value: 'none', label: 'No follower data' },
  { value: 'lt10k', label: 'Under 10K' },
  { value: '10k-100k', label: '10K – 100K' },
  { value: '100k-500k', label: '100K – 500K' },
  { value: '500k-1m', label: '500K – 1M' },
  { value: '1m+', label: '1M+' },
]

function matchesFollowerFilter(count, filter) {
  if (filter === 'All') return true
  const n = parseFollowersCount(count)
  if (filter === 'none') return n === 0
  if (n === 0) return false
  if (filter === 'lt10k') return n < 10_000
  if (filter === '10k-100k') return n >= 10_000 && n < 100_000
  if (filter === '100k-500k') return n >= 100_000 && n < 500_000
  if (filter === '500k-1m') return n >= 500_000 && n < 1_000_000
  if (filter === '1m+') return n >= 1_000_000
  return true
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'updated', label: 'Last Updated' },
  { value: 'shoot', label: 'Shoot Date' },
  { value: 'approved', label: 'Approved' },
  { value: 'payment', label: 'Payment Pending' },
  { value: 'followers-desc', label: 'Followers (high → low)' },
  { value: 'followers-asc', label: 'Followers (low → high)' },
]

/** Quick chip row: all | active | rejected | payment | approved */
const QUICK_CHIP = {
  ALL: 'all',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  PAYMENT: 'payment',
  APPROVED: 'approved',
}
const PAGE_SIZE = 20

/** Compact row actions: trigger + dropdown; closes on outside click / Escape (not only on ⋯). */
function InfluencerRowActions({ inf, can, navigate, onQuickAction }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const run = (e, fn) => {
    e.stopPropagation()
    setOpen(false)
    fn(e)
  }

  return (
    <div ref={rootRef} className="inf-list-menu" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className={`inf-list-menu__trigger ${open ? 'inf-list-menu__trigger--open' : ''}`}
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div className="inf-list-menu__panel" role="menu">
          <button
            type="button"
            className="inf-list-menu__item"
            role="menuitem"
            onClick={e => run(e, () => navigate(`/influencers/${inf.id}`))}
          >
            <Eye size={14} aria-hidden /> View profile
          </button>
          {can('manage') ? (
            <button
              type="button"
              className="inf-list-menu__item"
              role="menuitem"
              onClick={e => run(e, () => navigate(`/influencers/${inf.id}/edit`))}
            >
              <Pencil size={14} aria-hidden /> Edit
            </button>
          ) : null}
          {can('approve') && inf.approvalStatus !== 'Approved' && inf.approvalStatus !== 'Rejected' ? (
            <button
              type="button"
              className="inf-list-menu__item inf-list-menu__item--success"
              role="menuitem"
              onClick={e => run(e, (ev) => onQuickAction(ev, 'approve', inf))}
            >
              <Check size={14} aria-hidden /> Approve
            </button>
          ) : null}
          {can('approve') && inf.approvalStatus !== 'Rejected' ? (
            <button
              type="button"
              className="inf-list-menu__item inf-list-menu__item--danger"
              role="menuitem"
              onClick={e => run(e, (ev) => onQuickAction(ev, 'reject', inf))}
            >
              <X size={14} aria-hidden /> Reject
            </button>
          ) : null}
          {can('payments') && inf.approvalStatus === 'Approved' && inf.paymentStatus !== 'Paid' ? (
            <button
              type="button"
              className="inf-list-menu__item inf-list-menu__item--warning"
              role="menuitem"
              onClick={e => run(e, (ev) => onQuickAction(ev, 'payment-ready', inf))}
            >
              <CreditCard size={14} aria-hidden /> Mark ready for payment
            </button>
          ) : null}
          {can('manage') ? (
            <button
              type="button"
              className="inf-list-menu__item inf-list-menu__item--danger"
              role="menuitem"
              onClick={e => run(e, (ev) => onQuickAction(ev, 'delete', inf))}
            >
              <Trash2 size={14} aria-hidden /> Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function InfluencerListPage() {
  const {
    influencers,
    loading,
    loadError,
    listMeta,
    retryLoad,
    refetchInfluencerPage,
    updateInfluencer,
    deleteInfluencer,
  } = useInfluencers()
  const navigate = useNavigate()
  const { user } = useAuth()
  const can = (action) => hasPermission(user, 'influencers', action)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)

  const [search, setSearch] = useState('')
  const [filterWorkflow, setFilterWorkflow] = useState('All')
  const [filterApproval, setFilterApproval] = useState('All')
  const [filterPayment, setFilterPayment] = useState('All')
  const [filterBasedIn, setFilterBasedIn] = useState('All')
  const [filterNationality, setFilterNationality] = useState('All')
  const [filterCollab, setFilterCollab] = useState('All')
  const [filterFollowers, setFilterFollowers] = useState('All')
  const [quickChip, setQuickChip] = useState(QUICK_CHIP.ALL)
  const [sortBy, setSortBy] = useState('newest')
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const setPage = useCallback((p) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (p <= 1) next.delete('page')
      else next.set('page', String(p))
      return next
    }, { replace: true })
  }, [setSearchParams])
  const useServerPaging = listMeta && !listMeta.isFullListClientPaging

  const cities = useMemo(() => ['All', ...new Set(influencers.map(i => i.basedIn).filter(Boolean))], [influencers])
  const nationalities = useMemo(() => ['All', ...new Set(influencers.map(i => i.nationality).filter(Boolean))], [influencers])
  const collabTypes = useMemo(() => ['All', ...new Set(influencers.map(i => i.collaborationType).filter(Boolean))], [influencers])

  const filtered = useMemo(() => {
    let list = influencers.filter((inf) => {
      if (quickChip === QUICK_CHIP.ACTIVE) {
        if (inf.approvalStatus === 'Rejected' || inf.workflowStatus === 'Closed') return false
      } else if (quickChip === QUICK_CHIP.REJECTED) {
        if (inf.approvalStatus !== 'Rejected') return false
      } else if (quickChip === QUICK_CHIP.PAYMENT) {
        if (inf.paymentStatus !== 'Ready for Payment') return false
      } else if (quickChip === QUICK_CHIP.APPROVED) {
        if (inf.approvalStatus !== 'Approved') return false
      }

      const q = search.toLowerCase()
      if (
        q
        && ![
          inf.name,
          inf.instagram?.handle,
          inf.mobile,
          inf.whatsapp,
          inf.nationality,
        ].some((v) => v?.toLowerCase().includes(q))
      ) {
        return false
      }
      if (filterWorkflow !== 'All' && inf.workflowStatus !== filterWorkflow) return false
      if (filterApproval !== 'All' && inf.approvalStatus !== filterApproval) return false
      if (filterPayment !== 'All' && inf.paymentStatus !== filterPayment) return false
      if (filterBasedIn !== 'All' && inf.basedIn !== filterBasedIn) return false
      if (filterNationality !== 'All' && inf.nationality !== filterNationality) return false
      if (filterCollab !== 'All' && inf.collaborationType !== filterCollab) return false
      if (!matchesFollowerFilter(inf.followersCount, filterFollowers)) return false
      return true
    })

    if (sortBy === 'newest') list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    else if (sortBy === 'updated') list = [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    else if (sortBy === 'shoot') list = [...list].sort((a, b) => (a.shootDate || 'z') < (b.shootDate || 'z') ? -1 : 1)
    else if (sortBy === 'approved') list = [...list].filter(i => i.approvalStatus === 'Approved').concat(list.filter(i => i.approvalStatus !== 'Approved'))
    else if (sortBy === 'payment') list = [...list].sort((a, b) => (a.paymentStatus === 'Ready for Payment' ? -1 : 1))
    else if (sortBy === 'followers-desc') {
      list = [...list].sort((a, b) => parseFollowersCount(b.followersCount) - parseFollowersCount(a.followersCount))
    } else if (sortBy === 'followers-asc') {
      list = [...list].sort((a, b) => parseFollowersCount(a.followersCount) - parseFollowersCount(b.followersCount))
    }

    return list
  }, [influencers, search, filterWorkflow, filterApproval, filterPayment, filterBasedIn, filterNationality, filterCollab, filterFollowers, sortBy, quickChip])

  const stats = useMemo(() => ({
    total: useServerPaging ? listMeta.total : influencers.length,
    approved: influencers.filter(i => i.approvalStatus === 'Approved').length,
    pending: influencers.filter(i => i.paymentStatus === 'Ready for Payment').length,
    rejected: influencers.filter(i => i.approvalStatus === 'Rejected').length,
  }), [influencers, listMeta, useServerPaging])

  useEffect(() => {
    setPage(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterWorkflow, filterApproval, filterPayment, filterBasedIn, filterNationality, filterCollab, filterFollowers, sortBy, quickChip])

  const clientTotalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, clientTotalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE

  useEffect(() => {
    if (!useServerPaging && page > clientTotalPages) setPage(clientTotalPages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, clientTotalPages, useServerPaging])

  const pageRows = useMemo(() => {
    if (useServerPaging) return filtered
    return filtered.slice(pageStart, pageStart + PAGE_SIZE)
  }, [useServerPaging, filtered, pageStart])

  /** Index of first row on this page (for Sr. No.) */
  const serialOffset = useMemo(() => {
    if (useServerPaging && listMeta) return (listMeta.page - 1) * listMeta.limit
    return pageStart
  }, [useServerPaging, listMeta, pageStart])

  const totalPages = useServerPaging ? listMeta.totalPages : clientTotalPages
  const currentPageDisplay = useServerPaging ? listMeta.page : currentPage
  const showPagination =
    (useServerPaging && listMeta.totalPages > 1) ||
    (!useServerPaging && clientTotalPages > 1)

  const handleQuickAction = (e, action, inf) => {
    e.stopPropagation()
    if (action === 'approve') updateInfluencer(inf.id, { approvalStatus: 'Approved', workflowStatus: 'Approved' })
    else if (action === 'reject') updateInfluencer(inf.id, { approvalStatus: 'Rejected', workflowStatus: 'Rejected' })
    else if (action === 'schedule') navigate(`/influencers/${inf.id}`)
    else if (action === 'agreement') navigate(`/influencers/${inf.id}`)
    else if (action === 'payment-ready') updateInfluencer(inf.id, { paymentStatus: 'Ready for Payment' })
    else if (action === 'paid') updateInfluencer(inf.id, { paymentStatus: 'Paid', workflowStatus: 'Paid' })
    else if (action === 'delete') { e.stopPropagation(); setConfirmDeleteId(inf.id) }
  }

  const confirmDelete = () => {
    if (confirmDeleteId) deleteInfluencer(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  if (loading && influencers.length === 0 && !loadError) {
    return (
      <div className="inf-page inf-page--list">
        <p className="inf-page-subtitle" style={{ marginTop: '2rem' }}>
          Loading influencers…
        </p>
      </div>
    )
  }

  const errorPreamble =
    influencers.length > 0
      ? 'Could not refresh the list. Showing the last successfully loaded data until the API responds.'
      : null

  return (
    <div className="inf-page inf-page--list">
      {loadError ? (
        <div
          className="inf-page-subtitle"
          style={{
            marginBottom: '1rem',
            color: 'var(--warning)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.75rem',
          }}
          role="alert"
        >
          <span>
            {errorPreamble
              ? `${errorPreamble} (${loadError})`
              : loadError.includes('Failed to fetch') || loadError.includes('NetworkError')
                ? `Could not reach the API (${loadError}). Check API URL / network, then retry.`
                : loadError}
          </span>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => retryLoad()}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Influencer List</h1>
          <p className="inf-page-subtitle">
            {(listMeta && !listMeta.isFullListClientPaging ? listMeta.total : influencers.length)} influencers in the system
          </p>
        </div>
        <div className="inf-page-actions">
          {can('manage') && (
            <button className="inf-btn inf-btn--primary" onClick={() => setShowAddModal(true)}>
              + Add Influencer
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="inf-stats-row">
        <div className="inf-stat inf-stat--blue">
          <div className="inf-stat__value">{stats.total}</div>
          <div className="inf-stat__label">Total</div>
        </div>
        <div className="inf-stat inf-stat--green">
          <div className="inf-stat__value">{stats.approved}</div>
          <div className="inf-stat__label">Approved</div>
        </div>
        <div className="inf-stat inf-stat--amber">
          <div className="inf-stat__value">{stats.pending}</div>
          <div className="inf-stat__label">Payment Pending</div>
        </div>
        <div className="inf-stat inf-stat--red">
          <div className="inf-stat__value">{stats.rejected}</div>
          <div className="inf-stat__label">Rejected</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="inf-toolbar">
        <div className="inf-search-wrap">
          <span className="inf-search-icon">🔍</span>
          <input
            className="inf-search"
            placeholder="Search name, Instagram, mobile, nationality…"
            value={search}
            onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setSearch(e.target.value) }}
          />
        </div>
        <select className="inf-select" value={filterWorkflow} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterWorkflow(e.target.value) }}>
          <option value="All">All Stages</option>
          {['New Lead','Contacted','Waiting for Price','Waiting for Insights','Under Review','Shortlisted','Approved','Rejected','Shoot Scheduled','Shot Completed','Waiting for Upload','Uploaded','Payment Pending','Paid','Closed'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="inf-select" value={filterApproval} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterApproval(e.target.value) }}>
          <option value="All">All Approval</option>
          {['Pending','Shortlisted','Approved','Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="inf-select" value={filterPayment} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterPayment(e.target.value) }}>
          <option value="All">All Payment</option>
          {['Not Requested','Bank Details Pending','Ready for Payment','Payment Processing','Paid'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="inf-select" value={filterBasedIn} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterBasedIn(e.target.value) }}>
          {cities.map(c => <option key={c} value={c}>{c === 'All' ? 'All Cities' : c}</option>)}
        </select>
        <select className="inf-select" value={filterNationality} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterNationality(e.target.value) }}>
          {nationalities.map((n) => (
            <option key={n} value={n}>{n === 'All' ? 'All Nationalities' : n}</option>
          ))}
        </select>
        <select className="inf-select" value={filterCollab} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterCollab(e.target.value) }}>
          {collabTypes.map((c) => (
            <option key={c} value={c}>{c === 'All' ? 'All Collab Types' : c}</option>
          ))}
        </select>
        <select className="inf-select" value={filterFollowers} onChange={(e) => { setQuickChip(QUICK_CHIP.ALL); setFilterFollowers(e.target.value) }}>
          {FOLLOWER_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select className="inf-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Filter chips for quick views */}
      <div className="inf-filter-chips inf-filter-chips--tight">
        {[
          { label: 'All', key: QUICK_CHIP.ALL },
          { label: 'Active', key: QUICK_CHIP.ACTIVE },
          { label: 'Rejected', key: QUICK_CHIP.REJECTED },
          { label: 'Payment Pending', key: QUICK_CHIP.PAYMENT },
          { label: 'Approved', key: QUICK_CHIP.APPROVED },
        ].map(({ label, key }) => (
          <button
            key={key}
            type="button"
            className={`inf-chip ${quickChip === key ? 'inf-chip--active' : ''}`}
            onClick={() => {
              setFilterWorkflow('All')
              setFilterApproval('All')
              setFilterPayment('All')
              setFilterBasedIn('All')
              setFilterNationality('All')
              setFilterCollab('All')
              setFilterFollowers('All')
              setSearch('')
              setQuickChip(key)
            }}
          >
            {label}
          </button>
        ))}
        <span className="inf-filter-chips__meta">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="inf-table-wrap">
        {filtered.length === 0 ? (
          <div className="inf-empty">
            <div className="inf-empty__icon">{influencers.length === 0 && loadError ? '⚠️' : '🔍'}</div>
            <div className="inf-empty__title">
              {influencers.length === 0 && loadError ? 'Could not load influencers' : 'No influencers found'}
            </div>
            <div className="inf-empty__desc">
              {influencers.length === 0 && loadError
                ? 'The API request failed and there is no cached list in this browser yet.'
                : 'Try adjusting your search or filters.'}
            </div>
            {influencers.length === 0 && loadError ? (
              <button type="button" className="inf-btn inf-btn--primary" style={{ marginTop: '1rem' }} onClick={() => retryLoad()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : (
          <table className="inf-table inf-table--compact">
            <thead>
              <tr>
                <th className="inf-table__th-sr">Sr. No.</th>
                <th className="inf-table__col inf-table__col--name">Name</th>
                <th className="inf-table__col inf-table__col--hide-lg">Nationality</th>
                <th className="inf-table__col inf-table__col--ig">Instagram</th>
                <th className="inf-table__col inf-table__col--mobile">Mobile</th>
                <th className="inf-table__col inf-table__col--hide-lg">Based In</th>
                <th className="inf-table__col inf-table__col--num">Followers</th>
                <th className="inf-table__col inf-table__col--pkg">Package</th>
                <th className="inf-table__col inf-table__col--tight">Insights</th>
                <th className="inf-table__th--badge-col inf-table__col--stage">Stage</th>
                <th className="inf-table__th--badge-col inf-table__col--tight">Payment</th>
                <th className="inf-table__col inf-table__col--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((inf, index) => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}`)}>
                  <td className="inf-table__sr">{serialOffset + index + 1}</td>
                  <td className="inf-table__col inf-table__col--name">
                    <div className="inf-table__name">{inf.name}</div>
                    {inf.niche ? <div className="inf-table__sub">{inf.niche}</div> : null}
                  </td>
                  <td className="inf-table__col inf-table__col--hide-lg"><span className="inf-table__muted">{inf.nationality || '—'}</span></td>
                  <td className="inf-table__col inf-table__col--ig"><InstagramCell handle={inf.instagram?.handle} url={inf.instagram?.url} storedPicUrl={inf.instagram?.picUrl} /></td>
                  <td className="inf-table__col inf-table__col--mobile">
                    <span className="inf-table__cell-icon-row">
                      <Smartphone size={13} className="inf-table__cell-icon" aria-hidden />
                      <span className="inf-table__muted">{inf.mobile || '—'}</span>
                    </span>
                  </td>
                  <td className="inf-table__col inf-table__col--hide-lg"><span className="inf-table__muted">{inf.basedIn || '—'}</span></td>
                  <td className="inf-table__col inf-table__col--num">
                    <span className="inf-table__cell-icon-row">
                      <Users size={13} className="inf-table__cell-icon" aria-hidden />
                      <span className="inf-table__muted">{formatFollowersCell(inf.followersCount)}</span>
                    </span>
                  </td>
                  <td className="inf-table__col inf-table__col--pkg"><span className="inf-table__muted">{inf.reelsPrice ? `${inf.currency} ${Number(inf.reelsPrice).toLocaleString()}` : '—'}</span></td>
                  <td className="inf-table__col inf-table__col--tight">
                    <span className={`inf-badge inf-badge--table ${inf.insightsReceived ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.insightsReceived ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="inf-table__cell--badge-col inf-table__col--stage">
                    <span
                      className={`inf-badge inf-badge--dot inf-badge--table ${workflowBadgeClass(inf.workflowStatus)}`}
                      title={inf.workflowStatus}
                    >
                      {inf.workflowStatus}
                    </span>
                  </td>
                  <td className="inf-table__cell--badge-col inf-table__col--tight">
                    <span
                      className={`inf-badge inf-badge--dot inf-badge--table ${paymentBadgeClass(inf.paymentStatus)}`}
                      title={inf.paymentStatus}
                    >
                      {inf.paymentStatus}
                    </span>
                  </td>
                  <td className="inf-table__col inf-table__col--actions">
                    <InfluencerRowActions
                      inf={inf}
                      can={can}
                      navigate={navigate}
                      onQuickAction={handleQuickAction}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showPagination ? (
        <div className="inf-pagination">
          <button
            className="inf-btn inf-btn--ghost inf-btn--xs"
            disabled={currentPageDisplay <= 1}
            onClick={() => {
              if (useServerPaging) void refetchInfluencerPage({ page: listMeta.page - 1, limit: listMeta.limit })
              else setPage(Math.max(1, page - 1))
            }}
          >
            Previous
          </button>
          <span className="inf-pagination__meta">
            Page {currentPageDisplay} of {totalPages}
            {useServerPaging ? ` (${listMeta.total} total)` : ''}
          </span>
          <button
            className="inf-btn inf-btn--ghost inf-btn--xs"
            disabled={currentPageDisplay >= totalPages}
            onClick={() => {
              if (useServerPaging) void refetchInfluencerPage({ page: listMeta.page + 1, limit: listMeta.limit })
              else setPage(Math.min(totalPages, page + 1))
            }}
          >
            Next
          </button>
        </div>
      ) : null}
      {/* Add Influencer modal */}
      {showAddModal && (
        <AddInfluencerPage asModal onClose={() => setShowAddModal(false)} />
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="inf-modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="inf-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="inf-modal__header">
              <span className="inf-modal__title">Delete Influencer</span>
              <button className="inf-modal__close" onClick={() => setConfirmDeleteId(null)}>×</button>
            </div>
            <div className="inf-modal__body">
              <p style={{ margin: 0, color: 'var(--text)', lineHeight: 1.6 }}>
                Are you sure you want to permanently delete <strong>{influencers.find(i => i.id === confirmDeleteId)?.name}</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className="inf-modal__footer">
              <button className="inf-btn inf-btn--ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="inf-btn inf-btn--danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
