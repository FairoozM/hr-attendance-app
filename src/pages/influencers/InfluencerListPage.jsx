import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { AddInfluencerPage } from './AddInfluencerPage'
import { resolveApiUrl } from '../../api/client'
import './influencers.css'

const HIDDEN_HANDLES = ['queenslifeindubai']

function InstagramCell({ handle, url }) {
  const [imgError, setImgError] = useState(false)
  const raw = handle ? handle.replace(/^@/, '').trim() : ''
  if (!raw || HIDDEN_HANDLES.includes(raw.toLowerCase())) return <span className="inf-table__muted">—</span>
  const profileUrl = url || `https://www.instagram.com/${raw}/`
  const avatarSrc = resolveApiUrl(`/api/instagram-proxy/avatar/${encodeURIComponent(raw)}`)
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

function approvalBadgeClass(status) {
  const map = {
    'Pending': 'inf-badge--pending', 'Shortlisted': 'inf-badge--shortlisted',
    'Approved': 'inf-badge--approved', 'Rejected': 'inf-badge--rejected',
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

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'updated', label: 'Last Updated' },
  { value: 'shoot', label: 'Shoot Date' },
  { value: 'approved', label: 'Approved' },
  { value: 'payment', label: 'Payment Pending' },
]
const PAGE_SIZE = 10

export function InfluencerListPage() {
  const {
    influencers,
    loading,
    loadError,
    listMeta,
    retryLoad,
    refetchInfluencerPage,
    updateInfluencer,
    updateWorkflowStatus,
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
  const [filterCollab, setFilterCollab] = useState('All')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const useServerPaging = listMeta && !listMeta.isFullListClientPaging

  const cities = useMemo(() => ['All', ...new Set(influencers.map(i => i.basedIn).filter(Boolean))], [influencers])
  const collabTypes = useMemo(() => ['All', ...new Set(influencers.map(i => i.collaborationType).filter(Boolean))], [influencers])

  const filtered = useMemo(() => {
    let list = influencers.filter(inf => {
      const q = search.toLowerCase()
      if (q && ![inf.name, inf.instagram?.handle, inf.mobile, inf.whatsapp].some(v => v?.toLowerCase().includes(q))) return false
      if (filterWorkflow !== 'All' && inf.workflowStatus !== filterWorkflow) return false
      if (filterApproval !== 'All' && inf.approvalStatus !== filterApproval) return false
      if (filterPayment !== 'All' && inf.paymentStatus !== filterPayment) return false
      if (filterBasedIn !== 'All' && inf.basedIn !== filterBasedIn) return false
      if (filterCollab !== 'All' && inf.collaborationType !== filterCollab) return false
      return true
    })

    if (sortBy === 'newest') list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    else if (sortBy === 'updated') list = [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    else if (sortBy === 'shoot') list = [...list].sort((a, b) => (a.shootDate || 'z') < (b.shootDate || 'z') ? -1 : 1)
    else if (sortBy === 'approved') list = [...list].filter(i => i.approvalStatus === 'Approved').concat(list.filter(i => i.approvalStatus !== 'Approved'))
    else if (sortBy === 'payment') list = [...list].sort((a, b) => (a.paymentStatus === 'Ready for Payment' ? -1 : 1))

    return list
  }, [influencers, search, filterWorkflow, filterApproval, filterPayment, filterBasedIn, filterCollab, sortBy])

  const stats = useMemo(() => ({
    total: useServerPaging ? listMeta.total : influencers.length,
    approved: influencers.filter(i => i.approvalStatus === 'Approved').length,
    pending: influencers.filter(i => i.paymentStatus === 'Ready for Payment').length,
    rejected: influencers.filter(i => i.approvalStatus === 'Rejected').length,
  }), [influencers, listMeta, useServerPaging])

  useEffect(() => {
    setPage(1)
  }, [search, filterWorkflow, filterApproval, filterPayment, filterBasedIn, filterCollab, sortBy])

  const clientTotalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, clientTotalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE

  useEffect(() => {
    if (!useServerPaging && page > clientTotalPages) setPage(clientTotalPages)
  }, [page, clientTotalPages, useServerPaging])

  const pageRows = useMemo(() => {
    if (useServerPaging) return filtered
    return filtered.slice(pageStart, pageStart + PAGE_SIZE)
  }, [useServerPaging, filtered, pageStart])

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
      <div className="inf-page">
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
    <div className="inf-page">
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
            placeholder="Search name, Instagram, mobile…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="inf-select" value={filterWorkflow} onChange={e => setFilterWorkflow(e.target.value)}>
          <option value="All">All Stages</option>
          {['New Lead','Contacted','Waiting for Price','Waiting for Insights','Under Review','Shortlisted','Approved','Rejected','Shoot Scheduled','Shot Completed','Waiting for Upload','Uploaded','Payment Pending','Paid','Closed'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="inf-select" value={filterApproval} onChange={e => setFilterApproval(e.target.value)}>
          <option value="All">All Approval</option>
          {['Pending','Shortlisted','Approved','Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="inf-select" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
          <option value="All">All Payment</option>
          {['Not Requested','Bank Details Pending','Ready for Payment','Payment Processing','Paid'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="inf-select" value={filterBasedIn} onChange={e => setFilterBasedIn(e.target.value)}>
          {cities.map(c => <option key={c} value={c}>{c === 'All' ? 'All Cities' : c}</option>)}
        </select>
        <select className="inf-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Filter chips for quick rejected view */}
      <div className="inf-filter-chips" style={{ marginBottom: '1rem' }}>
        {['All', 'Active', 'Rejected', 'Payment Pending', 'Approved'].map(chip => (
          <button
            key={chip}
            className={`inf-chip ${
              (chip === 'All' && filterWorkflow === 'All' && filterApproval === 'All')
              || (chip === 'Rejected' && filterApproval === 'Rejected')
              || (chip === 'Approved' && filterApproval === 'Approved')
              || (chip === 'Payment Pending' && filterPayment === 'Ready for Payment')
                ? 'inf-chip--active' : ''
            }`}
            onClick={() => {
              setFilterWorkflow('All'); setFilterApproval('All'); setFilterPayment('All')
              if (chip === 'Rejected') setFilterApproval('Rejected')
              else if (chip === 'Approved') setFilterApproval('Approved')
              else if (chip === 'Payment Pending') setFilterPayment('Ready for Payment')
              else if (chip === 'Active') setFilterWorkflow('Contacted')
            }}
          >
            {chip}
          </button>
        ))}
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '0.5rem' }}>
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
          <table className="inf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Instagram</th>
                <th>Mobile</th>
                <th>Based In</th>
                <th>Reel</th>
                <th>Package</th>
                <th>Insights</th>
                <th>Stage</th>
                <th>Approval</th>
                <th>Payment</th>
                <th>Shoot Date</th>
                <th>Assigned</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(inf => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}`)}>
                  <td>
                    <div className="inf-table__name">{inf.name}</div>
                    <div className="inf-table__muted">{inf.niche}</div>
                  </td>
                  <td><InstagramCell handle={inf.instagram?.handle} url={inf.instagram?.url} /></td>
                  <td><span className="inf-table__muted">{inf.mobile || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.basedIn || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.reelsPrice ? `${inf.currency} ${inf.reelsPrice.toLocaleString()}` : '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.packagePrice ? `${inf.currency} ${inf.packagePrice.toLocaleString()}` : '—'}</span></td>
                  <td>
                    <span className={`inf-badge ${inf.insightsReceived ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.insightsReceived ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${workflowBadgeClass(inf.workflowStatus)}`}>
                      {inf.workflowStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${approvalBadgeClass(inf.approvalStatus)}`}>
                      {inf.approvalStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${paymentBadgeClass(inf.paymentStatus)}`}>
                      {inf.paymentStatus}
                    </span>
                  </td>
                  <td><span className="inf-table__muted">{inf.shootDate || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.assignedTo || '—'}</span></td>
                  <td>
                    <div className="inf-table__actions" onClick={e => e.stopPropagation()}>
                      <button className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => navigate(`/influencers/${inf.id}`)}>View</button>
                      {can('manage') && (
                        <button className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => navigate(`/influencers/${inf.id}/edit`)}>Edit</button>
                      )}
                      {can('approve') && inf.approvalStatus !== 'Approved' && inf.approvalStatus !== 'Rejected' && (
                        <button className="inf-btn inf-btn--success inf-btn--xs" onClick={e => handleQuickAction(e, 'approve', inf)}>✓ Approve</button>
                      )}
                      {can('approve') && inf.approvalStatus !== 'Rejected' && (
                        <button className="inf-btn inf-btn--danger inf-btn--xs" onClick={e => handleQuickAction(e, 'reject', inf)}>✕ Reject</button>
                      )}
                      {can('payments') && inf.approvalStatus === 'Approved' && inf.paymentStatus !== 'Paid' && (
                        <button className="inf-btn inf-btn--warning inf-btn--xs" onClick={e => handleQuickAction(e, 'payment-ready', inf)}>💳 Pay</button>
                      )}
                      {can('manage') && (
                        <button className="inf-btn inf-btn--danger inf-btn--xs" onClick={e => handleQuickAction(e, 'delete', inf)}>🗑 Delete</button>
                      )}
                    </div>
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
              else setPage(p => Math.max(1, p - 1))
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
              else setPage(p => Math.min(totalPages, p + 1))
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
