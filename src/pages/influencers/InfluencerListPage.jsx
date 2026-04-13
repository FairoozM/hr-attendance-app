import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import './influencers.css'

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

export function InfluencerListPage() {
  const { influencers, updateInfluencer, updateWorkflowStatus } = useInfluencers()
  const navigate = useNavigate()
  const { user } = useAuth()
  const can = (action) => hasPermission(user, 'influencers', action)

  const [search, setSearch] = useState('')
  const [filterWorkflow, setFilterWorkflow] = useState('All')
  const [filterApproval, setFilterApproval] = useState('All')
  const [filterPayment, setFilterPayment] = useState('All')
  const [filterBasedIn, setFilterBasedIn] = useState('All')
  const [filterCollab, setFilterCollab] = useState('All')
  const [sortBy, setSortBy] = useState('newest')

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
    total: influencers.length,
    approved: influencers.filter(i => i.approvalStatus === 'Approved').length,
    pending: influencers.filter(i => i.paymentStatus === 'Ready for Payment').length,
    rejected: influencers.filter(i => i.approvalStatus === 'Rejected').length,
  }), [influencers])

  const handleQuickAction = (e, action, inf) => {
    e.stopPropagation()
    if (action === 'approve') updateInfluencer(inf.id, { approvalStatus: 'Approved', workflowStatus: 'Approved' })
    else if (action === 'reject') updateInfluencer(inf.id, { approvalStatus: 'Rejected', workflowStatus: 'Rejected' })
    else if (action === 'schedule') navigate(`/influencers/${inf.id}`)
    else if (action === 'agreement') navigate(`/influencers/${inf.id}`)
    else if (action === 'payment-ready') updateInfluencer(inf.id, { paymentStatus: 'Ready for Payment' })
    else if (action === 'paid') updateInfluencer(inf.id, { paymentStatus: 'Paid', workflowStatus: 'Paid' })
  }

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Influencer List</h1>
          <p className="inf-page-subtitle">{influencers.length} influencers in the system</p>
        </div>
        <div className="inf-page-actions">
          {can('manage') && (
            <button className="inf-btn inf-btn--primary" onClick={() => navigate('/influencers/new')}>
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
            <div className="inf-empty__icon">🔍</div>
            <div className="inf-empty__title">No influencers found</div>
            <div className="inf-empty__desc">Try adjusting your search or filters.</div>
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
              {filtered.map(inf => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}`)}>
                  <td>
                    <div className="inf-table__name">{inf.name}</div>
                    <div className="inf-table__muted">{inf.niche}</div>
                  </td>
                  <td><span className="inf-table__handle">{inf.instagram?.handle || '—'}</span></td>
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
                      {can('payments') && inf.approvalStatus === 'Approved' && inf.paymentStatus !== 'Paid' && (
                        <button className="inf-btn inf-btn--warning inf-btn--xs" onClick={e => handleQuickAction(e, 'payment-ready', inf)}>💳 Pay</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
