import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import { influencerInitials } from '../../components/influencers/influencerPerformanceTableShared'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY, fmtDMYRange } from '../../utils/dateFormat'
import { useInfluencerDashboard } from './useInfluencerDashboard'
import {
  influencerProfileUrl,
  performanceContractUrl,
  type DashboardContractMetrics,
  type DashboardInfluencerMetrics,
  type DashboardRecentActivityItem,
  type DashboardUpcomingCheckIn,
  type InfluencerDashboardDatePreset,
  type InfluencerDashboardGroupMode,
} from './influencerDashboardUtils'
import './influencers.css'
import './InfluencerDashboard.css'

const DATE_PRESETS: Array<{ id: InfluencerDashboardDatePreset; label: string }> = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
  { id: 'all_time', label: 'All Time' },
]

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

type RankRow = DashboardContractMetrics | DashboardInfluencerMetrics

function isContractRow(row: RankRow): row is DashboardContractMetrics {
  return 'contractId' in row
}

function rowName(row: RankRow): string {
  if (isContractRow(row)) return row.influencer?.name || 'Influencer'
  return row.influencer?.name || 'Influencer'
}

function rowHandle(row: RankRow): string {
  const handle = row.influencer?.username || ''
  if (isContractRow(row)) return handle || row.campaignName
  return handle || `${row.contractCount} contract${row.contractCount === 1 ? '' : 's'}`
}

function rowImage(row: RankRow): string {
  return row.influencer?.profileImage || ''
}

function KpiCard({
  label,
  value,
  tone = 'blue',
  hint,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
}) {
  return (
    <div className={`inf-stat inf-stat--${tone}`} title={hint}>
      <div className="inf-stat__value">{value}</div>
      <div className="inf-stat__label">{label}</div>
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
      <div className="inf-dashboard__skeleton-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="inf-dashboard__skeleton" />
        ))}
      </div>
      <div className="inf-dashboard__grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="inf-dashboard__panel inf-dashboard__panel--half inf-dashboard__skeleton-panel" />
        ))}
      </div>
    </div>
  )
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="clay-card inf-dashboard__panel">
      <div className="inf-empty">
        <div className="inf-empty__title">{title}</div>
        <div className="inf-empty__desc">{message}</div>
      </div>
    </section>
  )
}

function RankList({
  title,
  subtitle,
  rows,
  metricLabel,
  metricValue,
  onRowClick,
}: {
  title: string
  subtitle: string
  rows: RankRow[]
  metricLabel: string
  metricValue: (row: RankRow) => string
  onRowClick: (row: RankRow) => void
}) {
  return (
    <section className="clay-card inf-dashboard__panel inf-dashboard__panel--third">
      <div className="inf-dashboard__panel-head">
        <div>
          <h2 className="inf-dashboard__panel-title">{title}</h2>
          <p className="inf-dashboard__panel-sub">{subtitle}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="inf-empty">
          <div className="inf-empty__desc">No data for this date range.</div>
        </div>
      ) : (
        <ol className="inf-dashboard__list">
          {rows.map((row, index) => (
            <li key={isContractRow(row) ? row.contractId : row.influencerId}>
              <button type="button" className="inf-dashboard__row" onClick={() => onRowClick(row)}>
                <span className="inf-dashboard__rank">{index + 1}</span>
                <Avatar name={rowName(row)} imageUrl={rowImage(row)} />
                <span className="inf-dashboard__copy">
                  <strong>{rowName(row)}</strong>
                  <em>{rowHandle(row)}</em>
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
    </section>
  )
}

export function InfluencerDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
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
    groupMode,
    setGroupMode,
    rosterTotal,
  } = useInfluencerDashboard()

  function openRankRow(row: RankRow) {
    if (isContractRow(row)) {
      navigate(performanceContractUrl(row.contractId))
      return
    }
    navigate(influencerProfileUrl(row.influencerId))
  }

  function openContract(row: DashboardContractMetrics) {
    navigate(performanceContractUrl(row.contractId))
  }

  function openActivity(item: DashboardRecentActivityItem) {
    if (item.contractId) {
      navigate(performanceContractUrl(item.contractId))
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

  const groupingLabel = groupMode === 'influencer' ? 'By Influencer' : 'By Contract'

  return (
    <div className="inf-dashboard">
      <div className="inf-dashboard__toolbar">
        <div className="inf-dashboard__filters">
          <span className="inf-dashboard__filter-label">Period</span>
          {DATE_PRESETS.map((preset) => (
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
        <div className="inf-dashboard__grouping">
          <span className="inf-dashboard__filter-label">Group</span>
          <button
            type="button"
            className={`inf-chip ${groupMode === 'influencer' ? 'inf-chip--active' : ''}`}
            onClick={() => setGroupMode('influencer' satisfies InfluencerDashboardGroupMode)}
          >
            By Influencer
          </button>
          <button
            type="button"
            className={`inf-chip ${groupMode === 'contract' ? 'inf-chip--active' : ''}`}
            onClick={() => setGroupMode('contract' satisfies InfluencerDashboardGroupMode)}
          >
            By Contract
          </button>
        </div>
      </div>

      {datePreset === 'custom' ? (
        <div className="inf-dashboard__custom-range clay-card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
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

      <div className="inf-dashboard__kpi-grid">
        <KpiCard
          label="Total Influencers"
          value={String(snapshot.totalInfluencers)}
          tone="blue"
          hint={datePreset === 'all_time' ? `${rosterTotal} in roster` : 'Influencers with contracts in range'}
        />
        <KpiCard label="Active Contracts" value={String(snapshot.activeContracts)} tone="green" />
        <KpiCard label="Completed Contracts" value={String(snapshot.completedContracts)} tone="teal" />
        <KpiCard label="Total Influencer Cost" value={formatAed(snapshot.totalCost)} tone="amber" />
        <KpiCard label="Total Sales" value={formatAed(snapshot.totalSales)} tone="purple" />
        {showNetProfit ? (
          <>
            <KpiCard label="Total Net Profit" value={formatAed(snapshot.totalNetProfit)} tone="pink" />
            <KpiCard label="Overall ROI" value={formatPct(snapshot.overallRoi)} tone="indigo" hint="Net profit / cost" />
            <KpiCard label="Profit Margin" value={formatPct(snapshot.profitMargin)} tone="cyan" hint="Net profit / sales" />
          </>
        ) : (
          <>
            <KpiCard label="Total Net Profit" value="—" tone="pink" hint="Admin only" />
            <KpiCard label="Overall ROI" value="—" tone="indigo" hint="Admin only" />
            <KpiCard label="Profit Margin" value="—" tone="cyan" hint="Admin only" />
          </>
        )}
      </div>

      <div className="inf-dashboard__grid">
        {showNetProfit ? (
          <RankList
            title="Top 5 by Net Profit"
            subtitle={groupingLabel}
            rows={snapshot.topByNetProfit}
            metricLabel="Net profit"
            metricValue={(row) => formatAed(row.netProfitAed)}
            onRowClick={openRankRow}
          />
        ) : null}
        <RankList
          title="Top 5 by Sales"
          subtitle={groupingLabel}
          rows={snapshot.topBySales}
          metricLabel="Sales"
          metricValue={(row) => formatAed(row.salesAed)}
          onRowClick={openRankRow}
        />
        {showNetProfit ? (
          <RankList
            title="Top 5 by ROI"
            subtitle={groupingLabel}
            rows={snapshot.topByRoi.filter((row) => toNumber(row.cost) > 0)}
            metricLabel="ROI"
            metricValue={(row) => formatPct(row.roi)}
            onRowClick={openRankRow}
          />
        ) : null}

        <section className="clay-card inf-dashboard__panel inf-dashboard__panel--half">
          <div className="inf-dashboard__panel-head">
            <div>
              <h2 className="inf-dashboard__panel-title">Active Contracts</h2>
              <p className="inf-dashboard__panel-sub">In monitoring window with open check-in days</p>
            </div>
          </div>
          {snapshot.activeContractRows.length === 0 ? (
            <div className="inf-empty"><div className="inf-empty__desc">No active contracts in this period.</div></div>
          ) : (
            <ul className="inf-dashboard__list">
              {snapshot.activeContractRows.slice(0, 6).map((row) => (
                <li key={row.contractId}>
                  <button type="button" className="inf-dashboard__row" onClick={() => openContract(row)}>
                    <Avatar name={rowName(row)} imageUrl={rowImage(row)} />
                    <span className="inf-dashboard__copy">
                      <strong>{row.campaignName}</strong>
                      <em>{row.influencer?.username || row.influencer?.name} · {row.recordedDays}/{row.monitoringDays} check-ins</em>
                    </span>
                    <span className="inf-dashboard__metric">
                      {fmtDMYRange(row.contractStartDate, row.contractEndDate, ' – ')}
                      <small>Ends {fmtDMY(row.contractEndDate)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="clay-card inf-dashboard__panel inf-dashboard__panel--half">
          <div className="inf-dashboard__panel-head">
            <div>
              <h2 className="inf-dashboard__panel-title">Upcoming Check-ins</h2>
              <p className="inf-dashboard__panel-sub">Open days in active contract windows</p>
            </div>
          </div>
          {snapshot.upcomingCheckIns.length === 0 ? (
            <div className="inf-empty"><div className="inf-empty__desc">No upcoming check-ins scheduled.</div></div>
          ) : (
            <ul className="inf-dashboard__list">
              {snapshot.upcomingCheckIns.map((row: DashboardUpcomingCheckIn) => (
                <li key={`${row.contractId}-${row.checkDate}`}>
                  <button type="button" className="inf-dashboard__row" onClick={() => openContract(toContractFromUpcoming(row))}>
                    <Avatar name={row.influencer?.name || 'Influencer'} imageUrl={row.influencer?.profileImage} />
                    <span className="inf-dashboard__copy">
                      <strong>{row.campaignName}</strong>
                      <em>{row.influencer?.name} · Day {row.dayNumber}</em>
                    </span>
                    <span className="inf-dashboard__metric">
                      {fmtDMY(row.checkDate)}
                      <small>Due check-in</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="clay-card inf-dashboard__panel inf-dashboard__panel--half">
          <div className="inf-dashboard__panel-head">
            <div>
              <h2 className="inf-dashboard__panel-title">Contracts Ending Soon</h2>
              <p className="inf-dashboard__panel-sub">Within the next 7 days</p>
            </div>
          </div>
          {snapshot.contractsEndingSoon.length === 0 ? (
            <div className="inf-empty"><div className="inf-empty__desc">No contracts ending soon.</div></div>
          ) : (
            <ul className="inf-dashboard__list">
              {snapshot.contractsEndingSoon.map((row) => (
                <li key={row.contractId}>
                  <button type="button" className="inf-dashboard__row" onClick={() => openContract(row)}>
                    <Avatar name={rowName(row)} imageUrl={rowImage(row)} />
                    <span className="inf-dashboard__copy">
                      <strong>{row.campaignName}</strong>
                      <em>{row.influencer?.name}</em>
                    </span>
                    <span className="inf-dashboard__metric">
                      {fmtDMY(row.contractEndDate)}
                      <small>{row.recordedDays}/{row.monitoringDays} done</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {showNetProfit ? (
          <section className="clay-card inf-dashboard__panel inf-dashboard__panel--half">
            <div className="inf-dashboard__panel-head">
              <div>
                <h2 className="inf-dashboard__panel-title">Loss-Making Campaigns</h2>
                <p className="inf-dashboard__panel-sub">Negative net profit on latest check-in</p>
              </div>
              <TrendingDown size={18} aria-hidden style={{ opacity: 0.65 }} />
            </div>
            {snapshot.lossMaking.length === 0 ? (
              <div className="inf-empty"><div className="inf-empty__desc">No loss-making campaigns in this period.</div></div>
            ) : (
              <ul className="inf-dashboard__list">
                {snapshot.lossMaking.slice(0, 6).map((row) => (
                  <li key={row.contractId}>
                    <button type="button" className="inf-dashboard__row inf-dashboard__row--warn" onClick={() => openContract(row)}>
                      <Avatar name={rowName(row)} imageUrl={rowImage(row)} />
                      <span className="inf-dashboard__copy">
                        <strong>{row.campaignName}</strong>
                        <em>{row.influencer?.name}</em>
                      </span>
                      <span className="inf-dashboard__metric">
                        {formatAed(row.netProfitAed)}
                        <small>Net profit</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className={`clay-card inf-dashboard__panel ${showNetProfit ? 'inf-dashboard__panel--half' : ''}`}>
          <div className="inf-dashboard__panel-head">
            <div>
              <h2 className="inf-dashboard__panel-title">Recent Activity</h2>
              <p className="inf-dashboard__panel-sub">Check-ins and workflow timeline events</p>
            </div>
            <TrendingUp size={18} aria-hidden style={{ opacity: 0.65 }} />
          </div>
          {snapshot.recentActivity.length === 0 ? (
            <div className="inf-empty"><div className="inf-empty__desc">No recent activity in this period.</div></div>
          ) : (
            <ul className="inf-dashboard__list">
              {snapshot.recentActivity.map((item) => (
                <li key={item.id}>
                  <button type="button" className="inf-dashboard__row" onClick={() => openActivity(item)}>
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
      </div>

      {snapshot.contracts.length === 0 ? (
        <EmptyPanel
          title="No contract performance in this period"
          message="Try widening the date range or add performance check-ins from the Performance tab."
        />
      ) : null}
    </div>
  )
}

function toContractFromUpcoming(row: DashboardUpcomingCheckIn): DashboardContractMetrics {
  const contract = row.contract
  return {
    contractId: row.contractId,
    influencerId: row.influencerId,
    influencer: row.influencer,
    campaignName: row.campaignName,
    videoTitle: contract.videoTitle || row.campaignName,
    contractStartDate: contract.contractStartDate,
    contractEndDate: contract.contractEndDate || '',
    latestDate: contract.latestDate || '',
    cost: toNumber(contract.totals?.cost),
    salesAed: toNumber(contract.totals?.salesAed),
    netProfitAed: toNumber(contract.totals?.netProfitAed),
    roi: 0,
    profitMargin: 0,
    recordedDays: contract.recordedDays,
    monitoringDays: contract.monitoringDays,
    isActive: true,
    isCompleted: false,
    contract,
  }
}
