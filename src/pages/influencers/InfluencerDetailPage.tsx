import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ExternalLink, Pencil, Plus, RefreshCw } from 'lucide-react'
import { useAuth, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import { resolveInfluencerProfileImageUrl } from '../../lib/influencerProfileImageUrl'
import { influencerInitials } from '../../components/influencers/influencerPerformanceTableShared'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'
import { useInfluencerProfile } from './useInfluencerProfile'
import {
  moduleDeepLinks,
  profileEngagementRate,
  type InfluencerProfileTab,
} from './influencerProfileUtils'
import { performanceContractUrl } from './influencerPaymentsRoiUtils'
import type { DashboardContractMetrics } from './influencerDashboardUtils'
import './influencers.css'
import './InfluencerDashboard.css'
import './InfluencerProfile.css'

const TABS: Array<{ id: InfluencerProfileTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'performance', label: 'Performance' },
  { id: 'notes', label: 'Notes' },
]

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

function payBadge(status: string): string {
  const map: Record<string, string> = {
    Untracked: 'inf-badge--waiting',
    'Not Due': 'inf-badge--not-requested',
    Pending: 'inf-badge--ready',
    'Partially Paid': 'inf-badge--processing',
    Paid: 'inf-badge--paid',
    Overdue: 'inf-badge--waiting',
    Disputed: 'inf-badge--rejected',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--not-requested'}`
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="inf-stat inf-stat--blue" title={hint}>
      <div className="inf-stat__value">{value}</div>
      <div className="inf-stat__label">{label}</div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div>
      <div className="inf-dashboard__skeleton-panel" style={{ minHeight: '5rem', marginBottom: '0.75rem' }} />
      <div className="inf-dashboard__skeleton-grid">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="inf-dashboard__skeleton" />)}
      </div>
    </div>
  )
}

function KpiStrip({ snapshot, showNetProfit }: { snapshot: NonNullable<ReturnType<typeof useInfluencerProfile>['snapshot']>; showNetProfit: boolean }) {
  const { summary } = snapshot
  const engagementRate = profileEngagementRate(snapshot.contracts)
  return (
    <div className="inf-profile__kpi-grid">
      <Kpi label="Total Contracts" value={String(summary.contractsAnalysed)} />
      <Kpi label="Active Contracts" value={String(snapshot.activeContracts.length)} />
      <Kpi label="Total Cost" value={formatAed(summary.totalCost)} />
      <Kpi label="Total Sales" value={formatAed(summary.totalSales)} />
      {showNetProfit ? (
        <>
          <Kpi label="Net Profit" value={formatAed(summary.totalNetProfit)} />
          <Kpi label="Overall ROI" value={formatPct(summary.overallRoi)} hint="Total net profit / total cost" />
        </>
      ) : (
        <>
          <Kpi label="Net Profit" value="—" />
          <Kpi label="Overall ROI" value="—" />
        </>
      )}
      <Kpi label="Total Views" value={summary.totalViews.toLocaleString()} />
      <Kpi label="Engagement" value={`${summary.totalEngagement.toLocaleString()} · ${formatPct(engagementRate)}`} hint="Interactions / views" />
    </div>
  )
}

function ContractRow({ row, onClick, showNetProfit }: { row: DashboardContractMetrics; onClick: () => void; showNetProfit: boolean }) {
  return (
    <li>
      <button type="button" className="inf-profile__list-item" onClick={onClick}>
        <span>
          <strong>{row.campaignName}</strong>
          <div className="inf-table__muted">
            {fmtDMY(row.contractStartDate)} – {fmtDMY(row.contractEndDate)}
            {' · '}{row.recordedDays}/{row.monitoringDays} check-ins
            {' · '}{row.isActive ? 'Active' : row.isCompleted ? 'Completed' : 'Pending'}
          </div>
        </span>
        <span style={{ textAlign: 'right' }}>
          <div>{formatAed(row.cost)}</div>
          {showNetProfit ? <div className="inf-table__muted">NP {formatAed(row.netProfitAed)} · ROI {formatPct(row.roi)}</div> : null}
        </span>
      </button>
    </li>
  )
}

export function InfluencerDetailPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const {
    influencerId,
    loading,
    error,
    notFound,
    reload,
    snapshot,
    activeTab,
    setActiveTab,
  } = useInfluencerProfile()

  if (loading) return <ProfileSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load profile</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  if (notFound || !snapshot) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <div className="inf-empty__title">Influencer not found</div>
          <div className="inf-empty__desc">No roster record matches id &quot;{influencerId}&quot;.</div>
          <Link to="/influencers/dashboard" className="inf-btn inf-btn--ghost inf-btn--xs">Back to dashboard</Link>
        </div>
      </section>
    )
  }

  const links = moduleDeepLinks(influencerId)
  const { influencer } = snapshot
  const profileImage = resolveInfluencerProfileImageUrl(influencer)
  const platforms = [
    influencer.instagram?.handle ? 'Instagram' : '',
    influencer.youtube?.handle ? 'YouTube' : '',
    influencer.tiktok?.handle ? 'TikTok' : '',
  ].filter(Boolean).join(', ')

  function openContract(contractId: string) {
    navigate(performanceContractUrl(contractId))
  }

  return (
    <div className="inf-profile">
      <header className="clay-card inf-profile__header">
        <div className="inf-profile__identity">
          <span className="inf-profile__avatar" aria-hidden="true">
            {profileImage ? <img src={profileImage} alt="" /> : <span>{influencerInitials(influencer.name)}</span>}
          </span>
          <div>
            <h1 className="inf-profile__name">{influencer.name}</h1>
            <p className="inf-profile__meta">
              {influencer.instagram?.handle || influencer.youtube?.handle || '—'}
              {platforms ? ` · ${platforms}` : ''}
              {influencer.niche ? ` · ${influencer.niche}` : ''}
              {` · ${influencer.workflowStatus}`}
              {influencer.basedIn ? ` · ${influencer.basedIn}` : ''}
            </p>
            {(influencer.mobile || influencer.email) ? (
              <p className="inf-profile__meta">
                {[influencer.mobile, influencer.email].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="inf-profile__actions">
          <Link to={links.edit} className="inf-btn inf-btn--ghost inf-btn--xs"><Pencil size={14} aria-hidden /> Edit</Link>
          <Link to={links.addContract} className="inf-btn inf-btn--primary inf-btn--xs"><Plus size={14} aria-hidden /> Add Contract</Link>
        </div>
      </header>

      <KpiStrip snapshot={snapshot} showNetProfit={showNetProfit} />

      <nav className="inf-profile__tabs" aria-label="Profile sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`inf-chip ${activeTab === tab.id ? 'inf-chip--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <div className="inf-profile__grid-2">
          <section className="clay-card inf-profile__section">
            <h2 className="inf-profile__section-title">Active contracts</h2>
            {snapshot.activeContracts.length === 0 ? (
              <p className="inf-table__muted">No active contracts.</p>
            ) : (
              <ul className="inf-profile__list">
                {snapshot.activeContracts.map((row) => (
                  <ContractRow key={row.contractId} row={row} showNetProfit={showNetProfit} onClick={() => openContract(row.contractId)} />
                ))}
              </ul>
            )}
          </section>

          <section className="clay-card inf-profile__section">
            <h2 className="inf-profile__section-title">Performance snapshot</h2>
            <p className="inf-table__muted" style={{ margin: 0 }}>
              Views {snapshot.summary.totalViews.toLocaleString()} · Engagement {snapshot.summary.totalEngagement.toLocaleString()}
              {' · '}Rate {formatPct(profileEngagementRate(snapshot.contracts))}
              {' · '}Sales {formatAed(snapshot.summary.totalSales)}
              {showNetProfit ? ` · Profit ${formatAed(snapshot.summary.totalNetProfit)}` : ''}
            </p>
          </section>

          <section className="clay-card inf-profile__section">
            <h2 className="inf-profile__section-title">Finance snapshot</h2>
            <p className="inf-table__muted" style={{ margin: 0 }}>
              Contracted {formatAed(snapshot.finance.totalContracted)} · Paid {formatAed(snapshot.finance.trackedPaid)}
              {' · '}Outstanding {formatAed(snapshot.finance.trackedOutstanding)} (tracked only)
              {' · '}Untracked {snapshot.finance.untrackedContractCount}
              {' · '}Overdue {snapshot.finance.overdueTrackedCount}
            </p>
          </section>

          <section className="clay-card inf-profile__section">
            <h2 className="inf-profile__section-title">Needs attention</h2>
            {snapshot.needsAttention.length === 0 ? (
              <p className="inf-table__muted">Nothing flagged.</p>
            ) : (
              <ul className="inf-profile__list">
                {snapshot.needsAttention.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`inf-profile__list-item inf-profile__attention ${item.tone === 'danger' ? 'inf-profile__attention--danger' : ''}`}
                      onClick={() => navigate(item.href)}
                    >
                      <span><strong>{item.label}</strong><div className="inf-table__muted">{item.detail}</div></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === 'contracts' ? (
        <section className="clay-card inf-profile__section">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.65rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 className="inf-profile__section-title" style={{ margin: 0 }}>All contracts</h2>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <Link to={links.contracts} className="inf-btn inf-btn--ghost inf-btn--xs">
                <ExternalLink size={14} /> Open all contracts
              </Link>
              <Link to={links.addContract} className="inf-btn inf-btn--primary inf-btn--xs"><Plus size={14} /> Add Contract</Link>
            </div>
          </div>
          {snapshot.contracts.length === 0 ? (
            <p className="inf-table__muted">No performance contracts recorded.</p>
          ) : (
            <div className="inf-table-wrap">
              <table className="inf-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Cost</th>
                    <th>Sales</th>
                    {showNetProfit ? <th>Net Profit</th> : null}
                    <th>Check-ins</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.contracts.map((row) => {
                    const pay = snapshot.paymentRows.find((p) => p.contractId === row.contractId)
                    return (
                      <tr key={row.contractId} onClick={() => openContract(row.contractId)} style={{ cursor: 'pointer' }}>
                        <td>{fmtDMY(row.contractStartDate)} – {fmtDMY(row.contractEndDate)}</td>
                        <td>{row.campaignName}</td>
                        <td>{row.isActive ? 'Active' : row.isCompleted ? 'Completed' : 'Pending'}</td>
                        <td>{formatAed(row.cost)}</td>
                        <td>{formatAed(row.salesAed)}</td>
                        {showNetProfit ? <td>{formatAed(row.netProfitAed)}</td> : null}
                        <td>{row.recordedDays}/{row.monitoringDays}</td>
                        <td>{pay ? pay.effectiveStatus : 'Untracked'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'performance' ? (
        <section className="clay-card inf-profile__section">
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.65rem' }}>
            <Link to={links.performance} className="inf-btn inf-btn--ghost inf-btn--xs"><ExternalLink size={14} /> Open in Performance</Link>
          </div>
          {snapshot.performancePoints.length === 0 ? (
            <p className="inf-table__muted">No performance data.</p>
          ) : (
            <div className="inf-table-wrap">
              <table className="inf-table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Views</th>
                    <th>Likes</th>
                    <th>Comments</th>
                    <th>Shares</th>
                    <th>Engagement</th>
                    <th>Sales</th>
                    {showNetProfit ? <><th>Net Profit</th><th>ROI</th></> : null}
                  </tr>
                </thead>
                <tbody>
                  {[...snapshot.performancePoints].sort((a, b) => b.salesAed - a.salesAed).map((row) => (
                    <tr key={row.id} onClick={() => row.contractId && openContract(row.contractId)} style={{ cursor: row.contractId ? 'pointer' : 'default' }}>
                      <td>{row.label}</td>
                      <td>{row.views.toLocaleString()}</td>
                      <td>{row.likes.toLocaleString()}</td>
                      <td>{row.comments.toLocaleString()}</td>
                      <td>{row.shares.toLocaleString()}</td>
                      <td>{formatPct(row.engagementRate)}</td>
                      <td>{formatAed(row.salesAed)}</td>
                      {showNetProfit ? <><td>{formatAed(row.netProfitAed)}</td><td>{formatPct(row.roi)}</td></> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'notes' ? (
        <section className="clay-card inf-profile__section">
          <p className="inf-table__muted" style={{ marginTop: 0 }}>
            Notes are stored on the influencer roster record. Edit to update persisted CRM notes.
          </p>
          {snapshot.notesFields.length === 0 ? (
            <p className="inf-table__muted">No notes recorded yet.</p>
          ) : (
            snapshot.notesFields.map((note) => (
              <div key={note.key} className="inf-profile__note-block">
                <strong>{note.label}</strong>
                <p>{note.value}</p>
              </div>
            ))
          )}
          <Link to={links.edit} className="inf-btn inf-btn--ghost inf-btn--xs">Edit notes in roster editor</Link>
        </section>
      ) : null}
    </div>
  )
}
