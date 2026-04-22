import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfluencers, SHOOT_STATUSES } from '../../contexts/InfluencersContext'
import { fmtDMY } from '../../utils/dateFormat'
import './influencers.css'

function shootBadge(status) {
  const map = {
    'Scheduled': 'inf-badge--scheduled', 'Confirmed': 'inf-badge--shortlisted',
    'Completed': 'inf-badge--completed', 'Cancelled': 'inf-badge--rejected',
    'Reschedule Needed': 'inf-badge--waiting',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--pending'}`
}

export function ShootSchedulePage() {
  const { influencers, updateInfluencer } = useInfluencers()
  const navigate = useNavigate()
  const [view, setView] = useState('cards')
  const [filterStatus, setFilterStatus] = useState('All')

  const scheduled = useMemo(() => {
    return influencers
      .filter(inf => inf.shootDate || ['Shoot Scheduled', 'Shot Completed', 'Confirmed'].includes(inf.workflowStatus))
      .filter(inf => filterStatus === 'All' || inf.workflowStatus === filterStatus)
      .sort((a, b) => {
        if (!a.shootDate && !b.shootDate) return 0
        if (!a.shootDate) return 1
        if (!b.shootDate) return -1
        return new Date(a.shootDate) - new Date(b.shootDate)
      })
  }, [influencers, filterStatus])

  const today = new Date().toISOString().split('T')[0]
  const upcoming = scheduled.filter(i => i.shootDate && i.shootDate >= today)
  const past = scheduled.filter(i => i.shootDate && i.shootDate < today)
  const noDate = scheduled.filter(i => !i.shootDate)

  const stats = useMemo(() => ({
    total: scheduled.length,
    upcoming: upcoming.length,
    completed: influencers.filter(i => i.workflowStatus === 'Shot Completed').length,
    confirmed: influencers.filter(i => i.workflowStatus === 'Shoot Scheduled').length,
  }), [scheduled, influencers, upcoming])

  function ShootCard({ inf }) {
    return (
      <div className="inf-schedule-card" onClick={() => navigate(`/influencers/${inf.id}/edit`)}>
        <div className="inf-schedule-card__date">
          {inf.shootDate
            ? `📅 ${fmtDMY(inf.shootDate)}${inf.shootTime ? ` · ${inf.shootTime}` : ''}`
            : 'No date set'}
        </div>
        <div className="inf-schedule-card__name">{inf.name}</div>
        <div className="inf-schedule-card__handle">{inf.instagram?.handle || '—'}</div>
        <div className="inf-schedule-card__meta">
          {inf.shootLocation && <span>📍 {inf.shootLocation}</span>}
          {inf.campaign && <span>🎯 {inf.campaign}</span>}
          {inf.assignedTo && <span>👤 {inf.assignedTo}</span>}
        </div>
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.35rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={shootBadge(inf.workflowStatus)}>{inf.workflowStatus}</span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <button className="inf-btn inf-btn--ghost inf-btn--xs"
              onClick={e => { e.stopPropagation(); updateInfluencer(inf.id, { workflowStatus: 'Shot Completed' }) }}>
              ✓ Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Shoot Schedule</h1>
          <p className="inf-page-subtitle">Track all scheduled and completed shoots</p>
        </div>
        <div className="inf-page-actions">
          <button
            className={`inf-btn ${view === 'cards' ? 'inf-btn--primary' : 'inf-btn--ghost'}`}
            onClick={() => setView('cards')}
          >⊞ Cards</button>
          <button
            className={`inf-btn ${view === 'list' ? 'inf-btn--primary' : 'inf-btn--ghost'}`}
            onClick={() => setView('list')}
          >≡ List</button>
        </div>
      </div>

      {/* Stats */}
      <div className="inf-stats-row">
        <div className="inf-stat inf-stat--blue">
          <div className="inf-stat__value">{stats.total}</div>
          <div className="inf-stat__label">Total Shoots</div>
        </div>
        <div className="inf-stat inf-stat--amber">
          <div className="inf-stat__value">{stats.upcoming}</div>
          <div className="inf-stat__label">Upcoming</div>
        </div>
        <div className="inf-stat inf-stat--green">
          <div className="inf-stat__value">{stats.completed}</div>
          <div className="inf-stat__label">Completed</div>
        </div>
        <div className="inf-stat inf-stat--purple">
          <div className="inf-stat__value">{stats.confirmed}</div>
          <div className="inf-stat__label">Scheduled</div>
        </div>
      </div>

      {/* Filter */}
      <div className="inf-toolbar" style={{ marginBottom: '1.25rem' }}>
        <div className="inf-filter-chips">
          {['All', 'Shoot Scheduled', 'Shot Completed', 'Waiting for Upload', 'Uploaded'].map(s => (
            <button key={s} className={`inf-chip ${filterStatus === s ? 'inf-chip--active' : ''}`} onClick={() => setFilterStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {scheduled.length === 0 ? (
        <div className="clay-card">
          <div className="inf-empty">
            <div className="inf-empty__icon">📸</div>
            <div className="inf-empty__title">No shoots scheduled</div>
            <div className="inf-empty__desc">Add shoot dates when approving influencers.</div>
          </div>
        </div>
      ) : view === 'cards' ? (
        <>
          {upcoming.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                Upcoming ({upcoming.length})
              </h3>
              <div className="inf-schedule-grid" style={{ marginBottom: '1.5rem' }}>
                {upcoming.map(inf => <ShootCard key={inf.id} inf={inf} />)}
              </div>
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                Past Shoots ({past.length})
              </h3>
              <div className="inf-schedule-grid" style={{ marginBottom: '1.5rem' }}>
                {past.map(inf => <ShootCard key={inf.id} inf={inf} />)}
              </div>
            </>
          )}
          {noDate.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                Date Pending ({noDate.length})
              </h3>
              <div className="inf-schedule-grid">
                {noDate.map(inf => <ShootCard key={inf.id} inf={inf} />)}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="inf-table-wrap">
          <table className="inf-table">
            <thead>
              <tr>
                <th>Influencer</th>
                <th>Instagram</th>
                <th>Date</th>
                <th>Time</th>
                <th>Location</th>
                <th>Campaign</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map(inf => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}/edit`)}>
                  <td><div className="inf-table__name">{inf.name}</div></td>
                  <td><span className="inf-table__handle">{inf.instagram?.handle || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.shootDate ? fmtDMY(inf.shootDate) : '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.shootTime || '—'}</span></td>
                  <td className="wrap"><span className="inf-table__muted">{inf.shootLocation || '—'}</span></td>
                  <td className="wrap"><span className="inf-table__muted">{inf.campaign || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.assignedTo || '—'}</span></td>
                  <td><span className={shootBadge(inf.workflowStatus)}>{inf.workflowStatus}</span></td>
                  <td>
                    <div className="inf-table__actions" onClick={e => e.stopPropagation()}>
                      <button className="inf-btn inf-btn--success inf-btn--xs"
                        onClick={() => updateInfluencer(inf.id, { workflowStatus: 'Shot Completed' })}>
                        ✓ Done
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
