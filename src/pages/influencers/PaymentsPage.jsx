import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfluencers } from '../../contexts/InfluencersContext'
import './influencers.css'

function payBadge(status) {
  const map = {
    'Not Requested': 'inf-badge--not-requested', 'Bank Details Pending': 'inf-badge--waiting',
    'Ready for Payment': 'inf-badge--ready', 'Payment Processing': 'inf-badge--processing',
    'Paid': 'inf-badge--paid',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--not-requested'}`
}

export function PaymentsPage() {
  const { influencers, updateInfluencer } = useInfluencers()
  const navigate = useNavigate()
  const [filterStatus, setFilterStatus] = useState('All')
  const [search, setSearch] = useState('')

  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()

  const stats = useMemo(() => {
    const approved = influencers.filter(i => i.approvalStatus === 'Approved')
    const pending = approved.filter(i => ['Ready for Payment', 'Bank Details Pending', 'Payment Processing'].includes(i.paymentStatus))
    const paid = approved.filter(i => i.paymentStatus === 'Paid')
    const noBankDetails = approved.filter(i => !i.bankName && i.paymentStatus !== 'Paid')
    const paidThisMonth = paid.filter(i => {
      const d = new Date(i.updatedAt)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    })
    const totalPaidAmount = paid.reduce((sum, i) => sum + Number(i.packagePrice || 0), 0)

    return {
      totalApproved: approved.length,
      pending: pending.length,
      paidThisMonth: paidThisMonth.length,
      noBankDetails: noBankDetails.length,
      totalPaidAmount,
    }
  }, [influencers, currentMonth, currentYear])

  const filtered = useMemo(() => {
    let list = influencers.filter(i => i.approvalStatus === 'Approved')
    if (filterStatus !== 'All') list = list.filter(i => i.paymentStatus === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i => [i.name, i.instagram?.handle].some(v => v?.toLowerCase().includes(q)))
    }
    return list.sort((a, b) => {
      const order = { 'Ready for Payment': 0, 'Payment Processing': 1, 'Bank Details Pending': 2, 'Not Requested': 3, 'Paid': 4 }
      return (order[a.paymentStatus] ?? 5) - (order[b.paymentStatus] ?? 5)
    })
  }, [influencers, filterStatus, search])

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Payments</h1>
          <p className="inf-page-subtitle">Track all influencer payment statuses</p>
        </div>
      </div>

      {/* Stats */}
      <div className="inf-stats-row">
        <div className="inf-stat inf-stat--blue">
          <div className="inf-stat__value">{stats.totalApproved}</div>
          <div className="inf-stat__label">Total Approved</div>
        </div>
        <div className="inf-stat inf-stat--amber">
          <div className="inf-stat__value">{stats.pending}</div>
          <div className="inf-stat__label">Payment Pending</div>
        </div>
        <div className="inf-stat inf-stat--green">
          <div className="inf-stat__value">{stats.paidThisMonth}</div>
          <div className="inf-stat__label">Paid This Month</div>
        </div>
        <div className="inf-stat inf-stat--red">
          <div className="inf-stat__value">{stats.noBankDetails}</div>
          <div className="inf-stat__label">Bank Details Missing</div>
        </div>
        <div className="inf-stat inf-stat--purple">
          <div className="inf-stat__value">
            {stats.totalPaidAmount > 0 ? `${stats.totalPaidAmount.toLocaleString()}` : '0'}
          </div>
          <div className="inf-stat__label">Total Paid (AED)</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="inf-toolbar">
        <div className="inf-search-wrap">
          <span className="inf-search-icon">🔍</span>
          <input className="inf-search" placeholder="Search influencer…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="inf-filter-chips">
          {['All', 'Not Requested', 'Bank Details Pending', 'Ready for Payment', 'Payment Processing', 'Paid'].map(s => (
            <button key={s} className={`inf-chip ${filterStatus === s ? 'inf-chip--active' : ''}`} onClick={() => setFilterStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="inf-table-wrap">
        {filtered.length === 0 ? (
          <div className="inf-empty">
            <div className="inf-empty__icon">💳</div>
            <div className="inf-empty__title">No payments found</div>
            <div className="inf-empty__desc">Approved influencers will appear here.</div>
          </div>
        ) : (
          <table className="inf-table">
            <thead>
              <tr>
                <th>Influencer</th>
                <th>Instagram</th>
                <th>Agreed Amount</th>
                <th>Bank</th>
                <th>IBAN</th>
                <th>Method</th>
                <th>Bank Details</th>
                <th>Payment Status</th>
                <th>Finance Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}`)}>
                  <td>
                    <div className="inf-table__name">{inf.name}</div>
                    <div className="inf-table__muted">{inf.nationality}</div>
                  </td>
                  <td><span className="inf-table__handle">{inf.instagram?.handle || '—'}</span></td>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                      {inf.packagePrice ? `${inf.currency} ${Number(inf.packagePrice).toLocaleString()}` : '—'}
                    </span>
                  </td>
                  <td><span className="inf-table__muted">{inf.bankName || '—'}</span></td>
                  <td><span className="inf-table__muted" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {inf.iban ? inf.iban.replace(/(.{4})/g, '$1 ').trim() : '—'}
                  </span></td>
                  <td><span className="inf-table__muted">{inf.paymentMethod || '—'}</span></td>
                  <td>
                    <span className={`inf-badge ${inf.bankName ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.bankName ? 'Available' : 'Missing'}
                    </span>
                  </td>
                  <td><span className={payBadge(inf.paymentStatus)}>{inf.paymentStatus}</span></td>
                  <td className="wrap"><span className="inf-table__muted">{inf.paymentNotes || '—'}</span></td>
                  <td>
                    <div className="inf-table__actions" onClick={e => e.stopPropagation()}>
                      {inf.paymentStatus !== 'Paid' && inf.paymentStatus !== 'Ready for Payment' && (
                        <button className="inf-btn inf-btn--warning inf-btn--xs"
                          onClick={() => updateInfluencer(inf.id, { paymentStatus: 'Ready for Payment' })}>
                          Ready
                        </button>
                      )}
                      {inf.paymentStatus !== 'Paid' && (
                        <button className="inf-btn inf-btn--success inf-btn--xs"
                          onClick={() => updateInfluencer(inf.id, { paymentStatus: 'Paid', workflowStatus: 'Paid' })}>
                          Paid ✓
                        </button>
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
