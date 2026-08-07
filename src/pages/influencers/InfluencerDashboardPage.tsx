import { Link, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Plus,
  RefreshCw,
  TrendingDown,
  Users,
} from 'lucide-react'
import { useAuth, canMutateInfluencerPerformance, canViewInfluencerPerformanceNetProfit, hasPermission } from '../../contexts/AuthContext'
import { influencerInitials } from '../../components/influencers/influencerPerformanceTableShared'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'
import { useInfluencerDashboard } from './useInfluencerDashboard'
import {
  INFLUENCER_DASHBOARD_DATE_PRESETS,
  influencerProfileUrl,
  type DashboardContractMetrics,
  type DashboardInfluencerMetrics,
  type DashboardRecentActivityItem,
} from './influencerDashboardUtils'
import './influencers.css'
import './InfluencerDashboard.css'

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`
  return formatNumber(value)
}

function ExecKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="inf-dashboard__exec-kpi" title={hint}>
      <span className="inf-dashboard__exec-kpi-value">{value}</span>
      <span className="inf-dashboard__exec-kpi-label">{label}</span>
    </div>
  )
}

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  return (
    <span className="inf-dashboard__avatar" aria-hidden="true">
      {imageUrl ? <img src={imageUrl} alt="" /> : <span>{influencerInitials(name)}</span>}
    </span>
  )
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="inf-dashboard__exec-kpi-row inf-dashboard__exec-kpi-row--skeleton">
        {Array.from({ length: 9 }).map((_, index) => (
          <div key={index} className="inf-dashboard__skeleton inf-dashboard__skeleton--kpi" />
        ))}
      </div>
      <div className="inf-dashboard__sections">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="inf-dashboard__section inf-dashboard__skeleton-panel" />
        ))}
      </div>
    </div>
  )
}

function SectionHead({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="inf-dashboard__section-head">
      <div>
        <h2 className="inf-dashboard__section-title">{title}</h2>
        {subtitle ? <p className="inf-dashboard__section-sub">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

function InfluencerRankList({
  title,
  rows,
  metricLabel,
  metricValue,
  onRowClick,
}: {
  title: string
  rows: DashboardInfluencerMetrics[]
  metricLabel: string
  metricValue: (row: DashboardInfluencerMetrics) => string
  onRowClick: (row: DashboardInfluencerMetrics) => void
}) {
  return (
    <div className="inf-dashboard__rank-card">
      <h3 className="inf-dashboard__rank-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="inf-dashboard__empty-note">No data for this period.</p>
      ) : (
        <ol className="inf-dashboard__list inf-dashboard__list--compact">
          {rows.map((row, index) => (
            <li key={row.influencerId}>
              <button type="button" className="inf-dashboard__row inf-dashboard__row--compact" onClick={() => onRowClick(row)}>
                <span className="inf-dashboard__rank">{index + 1}</span>
                <Avatar name={row.influencer?.name || 'Influencer'} imageUrl={row.influencer?.profileImage} />
                <span className="inf-dashboard__copy">
                  <strong>{row.influencer?.name || 'Influencer'}</strong>
                  <em>{row.contractCount} contract{row.contractCount === 1 ? '' : 's'}</em>
                </span>
                <span className="inf-dashboard__metric">
                  {metricValue(row)}
                  <small>{metricLabel}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function contractStatusLabel(row: DashboardContractMetrics): string {
  if (row.isActive) return 'Active'
  if (row.isCompleted) return 'Completed'
  return 'In progress'
}

export function InfluencerDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const canAddContract = canMutateInfluencerPerformance(user)
  const canAddInfluencer = hasPermission(user, 'influencers', 'manage')

  const {
    loading,
    error,
    reload,
    snapshot,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    rosterTotal,
  } = useInfluencerDashboard()

  function openInfluencer(row: DashboardInfluencerMetrics) {
    navigate(influencerProfileUrl(row.influencerId))
  }

  function openContract(row: DashboardContractMetrics) {
    navigate(`/influencers/performance?contract=${encodeURIComponent(row.contractId)}`)
  }

  function openActivity(item: DashboardRecentActivityItem) {
    if (item.contractId) {
      navigate(`/influencers/performance?contract=${encodeURIComponent(item.contractId)}`)
      return
    }
    navigate(influencerProfileUrl(item.influencerId))
  }

  if (loading) return <DashboardSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load dashboard</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  if (!snapshot) return <DashboardSkeleton />

  const activeRows = snapshot.activeContractRows.slice(0, 8)
  const recentActivity = snapshot.recentActivity.slice(0, 8)

  return (
    <div className="inf-dashboard">
      <div className="inf-dashboard__toolbar">
        <div className="inf-dashboard__filters">
          <span className="inf-dashboard__filter-label">Period</span>
          {INFLUENCER_DASHBOARD_DATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`inf-chip ${datePreset === preset.id ? 'inf-chip--active' : ''}`}
              onClick={() => setDatePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="inf-dashboard__quick-actions">
          {canAddInfluencer ? (
            <Link to="/influencers/new" className="inf-btn inf-btn--ghost inf-btn--xs">
              <Plus size={14} aria-hidden /> Add Influencer
            </Link>
          ) : null}
          {canAddContract ? (
            <Link to="/influencers/performance?add=1" className="inf-btn inf-btn--ghost inf-btn--xs">
              <Plus size={14} aria-hidden /> Add Contract
            </Link>
          ) : null}
          <Link to="/influencers/list" className="inf-btn inf-btn--ghost inf-btn--xs">View Roster</Link>
          <Link to="/influencers/contracts" className="inf-btn inf-btn--ghost inf-btn--xs">View Contracts</Link>
          <Link to="/influencers/analytics" className="inf-btn inf-btn--ghost inf-btn--xs">
            <BarChart3 size={14} aria-hidden /> Analytics
          </Link>
        </div>
      </div>

      {datePreset === 'custom' ? (
        <div className="inf-dashboard__custom-range clay-card">
          <label>
            From
            <input className="ip-control" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label>
            To
            <input className="ip-control" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      <section className="inf-dashboard__section" aria-labelledby="inf-dashboard-exec-heading">
        <SectionHead
          title="Executive overview"
          subtitle="Management totals for the selected period"
        />
        <div id="inf-dashboard-exec-heading" className="inf-dashboard__exec-kpi-row">
          <ExecKpi
            label="Influencers"
            value={String(snapshot.totalInfluencers)}
            hint={datePreset === 'all_time' ? `${rosterTotal} in roster` : 'Influencers with contracts in range'}
          />
          <ExecKpi label="Contracts" value={String(snapshot.totalContracts)} />
          <ExecKpi label="Influencer cost" value={formatAed(snapshot.totalCost)} />
          <ExecKpi label="Sales" value={formatAed(snapshot.totalSales)} />
          {showNetProfit ? (
            <>
              <ExecKpi label="Net profit" value={formatAed(snapshot.totalNetProfit)} />
              <ExecKpi label="Overall ROI" value={formatPct(snapshot.overallRoi)} hint="Net profit / cost" />
            </>
          ) : (
            <>
              <ExecKpi label="Net profit" value="—" hint="Restricted" />
              <ExecKpi label="Overall ROI" value="—" hint="Restricted" />
            </>
          )}
          <ExecKpi label="Views" value={formatCompactCount(snapshot.totalViews)} />
          <ExecKpi label="Engagement" value={formatCompactCount(snapshot.totalEngagement)} />
          <ExecKpi label="Active contracts" value={String(snapshot.activeContracts)} />
        </div>
      </section>

      <section className="inf-dashboard__section" aria-labelledby="inf-dashboard-perf-heading">
        <SectionHead
          title="Performance snapshot"
          subtitle="Top influencers and campaigns needing attention"
        />
        <div id="inf-dashboard-perf-heading" className="inf-dashboard__perf-grid">
          <InfluencerRankList
            title="Top by sales"
            rows={snapshot.topInfluencersBySales}
            metricLabel="Sales"
            metricValue={(row) => formatAed(row.salesAed)}
            onRowClick={openInfluencer}
          />
          {showNetProfit ? (
            <InfluencerRankList
              title="Top by net profit"
              rows={snapshot.topInfluencersByNetProfit}
              metricLabel="Net profit"
              metricValue={(row) => formatAed(row.netProfitAed)}
              onRowClick={openInfluencer}
            />
          ) : null}
          {showNetProfit ? (
            <InfluencerRankList
              title="Top by ROI"
              rows={snapshot.topInfluencersByRoi}
              metricLabel="ROI"
              metricValue={(row) => formatPct(row.roi)}
              onRowClick={openInfluencer}
            />
          ) : null}
          {showNetProfit ? (
            <div className="inf-dashboard__rank-card inf-dashboard__rank-card--attention">
              <h3 className="inf-dashboard__rank-title">
                <TrendingDown size={15} aria-hidden /> Needs attention
              </h3>
              {snapshot.lossMaking.length === 0 ? (
                <p className="inf-dashboard__empty-note">No loss-making campaigns in this period.</p>
              ) : (
                <ol className="inf-dashboard__list inf-dashboard__list--compact">
                  {snapshot.lossMaking.slice(0, 5).map((row) => (
                    <li key={row.contractId}>
                      <button type="button" className="inf-dashboard__row inf-dashboard__row--compact inf-dashboard__row--warn" onClick={() => openContract(row)}>
                        <Avatar name={row.influencer?.name || 'Influencer'} imageUrl={row.influencer?.profileImage} />
                        <span className="inf-dashboard__copy">
                          <strong>{row.influencer?.name || 'Influencer'}</strong>
                          <em>{row.campaignName}</em>
                        </span>
                        <span className="inf-dashboard__metric">
                          {formatAed(row.netProfitAed)}
                          <small>Net profit</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="inf-dashboard__section" aria-labelledby="inf-dashboard-active-heading">
        <SectionHead
          title="Active contracts"
          subtitle="Operational view of contracts currently in monitoring"
          action={(
            <Link to="/influencers/contracts" className="inf-dashboard__section-link">
              View all performance contracts <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        />
        {activeRows.length === 0 ? (
          <p className="inf-dashboard__empty-note">No active contracts in this period.</p>
        ) : (
          <div className="inf-dashboard__table-wrap">
            <table className="inf-dashboard__table">
              <thead>
                <tr>
                  <th>Influencer</th>
                  <th>Campaign</th>
                  <th>Cost</th>
                  <th>Sales</th>
                  {showNetProfit ? <th>Net profit</th> : null}
                  {showNetProfit ? <th>ROI</th> : null}
                  <th>Check-ins</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => (
                  <tr key={row.contractId}>
                    <td>
                      <button type="button" className="inf-dashboard__table-link" onClick={() => navigate(influencerProfileUrl(row.influencerId))}>
                        {row.influencer?.name || 'Influencer'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="inf-dashboard__table-link" onClick={() => openContract(row)}>
                        {row.campaignName}
                      </button>
                    </td>
                    <td>{formatAed(row.cost)}</td>
                    <td>{formatAed(row.salesAed)}</td>
                    {showNetProfit ? <td>{formatAed(row.netProfitAed)}</td> : null}
                    {showNetProfit ? <td>{formatPct(row.roi)}</td> : null}
                    <td>{row.recordedDays}/{row.monitoringDays}</td>
                    <td><span className="inf-dashboard__status">{contractStatusLabel(row)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="inf-dashboard__section" aria-labelledby="inf-dashboard-activity-heading">
        <SectionHead
          title="Recent activity"
          subtitle="Latest check-ins and workflow timeline events"
        />
        {recentActivity.length === 0 ? (
          <p className="inf-dashboard__empty-note">No recent activity in this period.</p>
        ) : (
          <ul className="inf-dashboard__list">
            {recentActivity.map((item) => (
              <li key={item.id}>
                <button type="button" className="inf-dashboard__row inf-dashboard__row--compact" onClick={() => openActivity(item)}>
                  <Avatar name={item.influencer?.name || item.subtitle} imageUrl={item.influencer?.profileImage} />
                  <span className="inf-dashboard__copy">
                    <strong>{item.title}</strong>
                    <em>{item.subtitle}</em>
                  </span>
                  <span className="inf-dashboard__metric">
                    {fmtDMY(item.date)}
                    <small>{item.kind === 'check_in' ? 'Check-in' : 'Timeline'}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {snapshot.contracts.length === 0 ? (
        <section className="clay-card inf-dashboard__panel">
          <div className="inf-empty">
            <Users size={24} aria-hidden style={{ opacity: 0.65 }} />
            <div className="inf-empty__title">No contract performance in this period</div>
            <div className="inf-empty__desc">Widen the date range or add performance check-ins from the Performance tab.</div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
