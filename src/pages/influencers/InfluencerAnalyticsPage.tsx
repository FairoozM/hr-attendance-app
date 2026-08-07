import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import { INFLUENCER_PLATFORMS } from '../../utils/influencerPerformanceUtils'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { useInfluencerAnalytics } from './useInfluencerAnalytics'
import {
  formatAnalyticsAxisValue,
  formatAnalyticsTooltipAed,
  influencerProfileUrl,
  performanceContractUrl,
  type InfluencerAnalyticsPoint,
} from './influencerAnalyticsUtils'
import './influencers.css'
import './InfluencerDashboard.css'
import './InfluencerAnalytics.css'
import './InfluencerContracts.css'

const DATE_PRESETS = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom' },
  { id: 'all_time', label: 'All Time' },
] as const

type TooltipPayload = { value?: number; name?: string; color?: string }

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="inf-analytics__tooltip" style={{
      background: 'var(--surface, #fff)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '0.65rem 0.85rem',
      fontSize: '0.78rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name}>{entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</div>
      ))}
    </div>
  )
}

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="inf-stat inf-stat--blue" title={hint}>
      <div className="inf-stat__value">{value}</div>
      <div className="inf-stat__label">{label}</div>
    </div>
  )
}

function RankList({
  title,
  rows,
  metric,
  onClick,
}: {
  title: string
  rows: InfluencerAnalyticsPoint[]
  metric: (row: InfluencerAnalyticsPoint) => string
  onClick: (row: InfluencerAnalyticsPoint) => void
}) {
  return (
    <section className="clay-card inf-analytics__section">
      <h3 className="inf-analytics__section-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="inf-analytics__section-sub">No data for current filters.</p>
      ) : (
        <ol className="inf-analytics__rank-list">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button type="button" className="inf-analytics__rank-item" onClick={() => onClick(row)}>
                <span><strong>{index + 1}. {row.label}</strong></span>
                <span>{metric(row)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function AnalyticsSkeleton() {
  return (
    <div>
      <div className="inf-dashboard__skeleton-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="inf-dashboard__skeleton" />)}</div>
      <div className="inf-analytics__skeleton-chart inf-dashboard__skeleton-panel" />
    </div>
  )
}

export function InfluencerAnalyticsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const [compareOpen, setCompareOpen] = useState(false)
  const {
    loading,
    error,
    reload,
    filters,
    updateFilters,
    resetFilters,
    snapshot,
    campaignOptions,
    platformOptions,
    influencers,
    compareIds,
    toggleCompare,
    comparePoints,
  } = useInfluencerAnalytics()

  function openPoint(point: InfluencerAnalyticsPoint) {
    if (point.contractId) {
      navigate(performanceContractUrl(point.contractId))
      return
    }
    navigate(influencerProfileUrl(point.influencerId))
  }

  if (loading) return <AnalyticsSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load analytics</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  if (!snapshot) return <AnalyticsSkeleton />

  const { summary } = snapshot
  const filteredInfluencer = filters.influencerId !== 'all'
    ? influencers.find((inf) => String(inf.id) === String(filters.influencerId))
    : undefined

  return (
    <div className="inf-analytics">
      {filteredInfluencer ? (
        <div className="inf-contracts__filter-banner">
          <UserRound size={14} aria-hidden />
          <span>Filtered by: <strong>{filteredInfluencer.name}</strong></span>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => updateFilters({ influencerId: 'all' })}>
            <X size={12} aria-hidden /> Clear filter
          </button>
          <Link to={influencerProfileUrl(String(filteredInfluencer.id))} className="inf-btn inf-btn--ghost inf-btn--xs">
            View profile
          </Link>
        </div>
      ) : null}

      <div className="inf-analytics__intro clay-card">
        <h2 className="inf-payments-roi__title">Analytics</h2>
        <p>
          Programme-wide trends and comparisons using the same financial definitions as Dashboard and Performance
          (latest check-in snapshot per contract; reach metrics summed across check-ins).
        </p>
      </div>

      <div className="inf-dashboard__toolbar">
        <div className="inf-dashboard__filters">
          <span className="inf-dashboard__filter-label">Period</span>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`inf-chip ${filters.datePreset === preset.id ? 'inf-chip--active' : ''}`}
              onClick={() => updateFilters({ datePreset: preset.id })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="inf-dashboard__grouping">
          <span className="inf-dashboard__filter-label">Group</span>
          <button type="button" className={`inf-chip ${filters.groupMode === 'influencer' ? 'inf-chip--active' : ''}`} onClick={() => updateFilters({ groupMode: 'influencer' })}>By Influencer</button>
          <button type="button" className={`inf-chip ${filters.groupMode === 'contract' ? 'inf-chip--active' : ''}`} onClick={() => updateFilters({ groupMode: 'contract' })}>By Contract</button>
        </div>
      </div>

      {filters.datePreset === 'custom' ? (
        <div className="inf-dashboard__custom-range clay-card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
          <label>From<input className="ip-control" type="date" value={filters.customFrom} onChange={(e) => updateFilters({ customFrom: e.target.value })} /></label>
          <label>To<input className="ip-control" type="date" value={filters.customTo} onChange={(e) => updateFilters({ customTo: e.target.value })} /></label>
        </div>
      ) : null}

      <div className="inf-analytics__filters clay-card">
        <label>
          Influencer
          <select className="ip-control" value={filters.influencerId} onChange={(e) => updateFilters({ influencerId: e.target.value })}>
            <option value="all">All</option>
            {influencers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((inf) => (
              <option key={inf.id} value={String(inf.id)}>{inf.name}</option>
            ))}
          </select>
        </label>
        <label>
          Campaign
          <select className="ip-control" value={filters.campaign} onChange={(e) => updateFilters({ campaign: e.target.value })}>
            <option value="all">All</option>
            {campaignOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Platform
          <select className="ip-control" value={filters.platform} onChange={(e) => updateFilters({ platform: e.target.value })}>
            <option value="all">All</option>
            {platformOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            {INFLUENCER_PLATFORMS.map((name) => platformOptions.includes(name) ? null : <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Contract status
          <select className="ip-control" value={filters.contractStatus} onChange={(e) => updateFilters({ contractStatus: e.target.value as typeof filters.contractStatus })}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={resetFilters}>Reset filters</button>
      </div>

      <div className="inf-analytics__kpi-grid">
        <Kpi label="Total Cost" value={formatAed(summary.totalCost)} />
        <Kpi label="Total Sales" value={formatAed(summary.totalSales)} />
        {showNetProfit ? (
          <>
            <Kpi label="Net Profit" value={formatAed(summary.totalNetProfit)} />
            <Kpi label="Overall ROI" value={formatPct(summary.overallRoi)} hint="Total net profit / total cost" />
            <Kpi label="Profit Margin" value={formatPct(summary.profitMargin)} hint="Total net profit / total sales" />
          </>
        ) : (
          <>
            <Kpi label="Net Profit" value="—" hint="Admin only" />
            <Kpi label="Overall ROI" value="—" />
            <Kpi label="Profit Margin" value="—" />
          </>
        )}
        <Kpi label="Total Views" value={summary.totalViews.toLocaleString()} />
        <Kpi label="Total Engagement" value={summary.totalEngagement.toLocaleString()} hint="Likes + comments + shares" />
        <Kpi label="Contracts Analysed" value={String(summary.contractsAnalysed)} />
      </div>

      <section className="clay-card inf-analytics__section">
        <h3 className="inf-analytics__section-title">Sales vs Cost vs Net Profit Over Time</h3>
        <p className="inf-analytics__section-sub">
          {snapshot.granularity} buckets · one financial snapshot per contract assigned to latest check-in period
        </p>
        {snapshot.trends.length === 0 ? (
          <p className="inf-analytics__section-sub">No trend data for the selected filters.</p>
        ) : (
          <div className="inf-analytics__chart inf-analytics__chart--tall">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={snapshot.trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} formatter={(value: number, name: string) => [formatAnalyticsTooltipAed(value), name]} />
                <Legend />
                <Bar dataKey="salesAed" name="Sales" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="Cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                {showNetProfit ? <Line type="monotone" dataKey="netProfitAed" name="Net Profit" stroke="#10b981" strokeWidth={2} dot={false} /> : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="inf-analytics__grid-2">
        <section className="clay-card inf-analytics__section">
          <h3 className="inf-analytics__section-title">ROI Trend</h3>
          {snapshot.roiTrends.length === 0 ? (
            <p className="inf-analytics__section-sub">No ROI trend data.</p>
          ) : (
            <div className="inf-analytics__chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={snapshot.roiTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} formatter={(value: number) => [`${Number(value).toFixed(1)}%`, 'ROI']} />
                  <Line type="monotone" dataKey="roi" name="ROI" stroke="#2563eb" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="clay-card inf-analytics__section">
          <h3 className="inf-analytics__section-title">Campaign / Contract Profitability</h3>
          <div className="inf-analytics__distribution">
            <div className="inf-analytics__distribution-item"><strong>{snapshot.campaignProfitability.profitable}</strong><span>Profitable</span></div>
            <div className="inf-analytics__distribution-item"><strong>{snapshot.campaignProfitability.breakEven}</strong><span>Break-even</span></div>
            <div className="inf-analytics__distribution-item"><strong>{snapshot.campaignProfitability.lossMaking}</strong><span>Loss-making</span></div>
          </div>
          <div className="inf-analytics__chart" style={{ marginTop: '0.75rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snapshot.profitDistribution.filter((row) => row.count > 0)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Count" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="inf-analytics__grid-2">
        <section className="clay-card inf-analytics__section">
          <h3 className="inf-analytics__section-title">Cost vs Net Profit</h3>
          <div className="inf-analytics__chart">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis type="number" dataKey="cost" name="Cost" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="netProfitAed" name="Net Profit" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const p = payload[0].payload as InfluencerAnalyticsPoint
                  return (
                    <div style={{ background: 'var(--surface,#fff)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.65rem', fontSize: '0.75rem' }}>
                      <strong>{p.label}</strong><br />
                      Cost: {formatAnalyticsTooltipAed(p.cost)}<br />
                      Sales: {formatAnalyticsTooltipAed(p.salesAed)}<br />
                      Net Profit: {formatAnalyticsTooltipAed(p.netProfitAed)}<br />
                      ROI: {formatPct(p.roi)}
                    </div>
                  )
                }} />
                <Scatter data={snapshot.scatterCostProfit} fill="#2563eb" onClick={(data) => {
                  const point = data as unknown as InfluencerAnalyticsPoint
                  if (point?.id) openPoint(point)
                }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="clay-card inf-analytics__section">
          <h3 className="inf-analytics__section-title">Views vs Sales</h3>
          <div className="inf-analytics__chart">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis type="number" dataKey="views" name="Views" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="salesAed" name="Sales" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const p = payload[0].payload as InfluencerAnalyticsPoint
                  return (
                    <div style={{ background: 'var(--surface,#fff)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.65rem', fontSize: '0.75rem' }}>
                      <strong>{p.label}</strong><br />
                      Views: {p.views.toLocaleString()}<br />
                      Sales: {formatAnalyticsTooltipAed(p.salesAed)}
                    </div>
                  )
                }} />
                <Scatter data={snapshot.scatterViewsSales} fill="#8b5cf6" onClick={(data) => {
                  const point = data as unknown as InfluencerAnalyticsPoint
                  if (point?.id) openPoint(point)
                }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="clay-card inf-analytics__section">
        <h3 className="inf-analytics__section-title">Engagement vs Sales</h3>
        <div className="inf-analytics__chart">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
              <XAxis type="number" dataKey="engagement" name="Engagement" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
              <YAxis type="number" dataKey="salesAed" name="Sales" tickFormatter={formatAnalyticsAxisValue} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const p = payload[0].payload as InfluencerAnalyticsPoint
                return (
                  <div style={{ background: 'var(--surface,#fff)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.65rem', fontSize: '0.75rem' }}>
                    <strong>{p.label}</strong><br />
                    Engagement: {p.engagement.toLocaleString()}<br />
                    Engagement rate: {formatPct(p.engagementRate)}<br />
                    Sales: {formatAnalyticsTooltipAed(p.salesAed)}
                  </div>
                )
              }} />
              <Scatter data={snapshot.scatterEngagementSales} fill="#059669" onClick={(data) => {
                const point = data as unknown as InfluencerAnalyticsPoint
                if (point?.id) openPoint(point)
              }} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="inf-analytics__grid-2">
        {showNetProfit ? <RankList title="Top Profit" rows={snapshot.topByNetProfit} metric={(row) => formatAed(row.netProfitAed)} onClick={openPoint} /> : null}
        <RankList title="Top Sales" rows={snapshot.topBySales} metric={(row) => formatAed(row.salesAed)} onClick={openPoint} />
        {showNetProfit ? <RankList title="Top ROI" rows={snapshot.topByRoi} metric={(row) => formatPct(row.roi)} onClick={openPoint} /> : null}
        <RankList title="Needs Attention" rows={snapshot.needsAttention} metric={(row) => formatAed(row.netProfitAed)} onClick={openPoint} />
      </div>

      <section className="clay-card inf-analytics__section">
        <h3 className="inf-analytics__section-title">Performance Insights</h3>
        {snapshot.insights.length === 0 ? (
          <p className="inf-analytics__section-sub">Not enough data to generate insights for this filter scope.</p>
        ) : (
          <ul className="inf-analytics__insights">
            {snapshot.insights.map((insight) => <li key={insight.id}>{insight.text}</li>)}
          </ul>
        )}
      </section>

      <section className="clay-card inf-analytics__section inf-analytics__compare">
        <button type="button" className="inf-btn inf-btn--ghost" onClick={() => setCompareOpen((open) => !open)}>
          Compare influencers (up to 3) {compareOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {compareOpen ? (
          <>
            <p className="inf-analytics__section-sub" style={{ marginTop: '0.65rem' }}>
              Select from the comparison pool below. Only influencer-grouped rows appear when grouping by contract.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
              {snapshot.comparisonPool.map((point) => (
                <button
                  key={point.id}
                  type="button"
                  className={`inf-chip ${compareIds.includes(point.id) ? 'inf-chip--active' : ''}`}
                  onClick={() => toggleCompare(point.id)}
                >
                  {point.label}
                </button>
              ))}
            </div>
            {comparePoints.length > 0 ? (
              <table className="inf-analytics__compare-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {comparePoints.map((point) => <th key={point.id}>{point.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['Cost', (p: InfluencerAnalyticsPoint) => formatAed(p.cost)],
                    ['Sales', (p: InfluencerAnalyticsPoint) => formatAed(p.salesAed)],
                    ['Net Profit', (p: InfluencerAnalyticsPoint) => formatAed(p.netProfitAed)],
                    ['ROI', (p: InfluencerAnalyticsPoint) => formatPct(p.roi)],
                    ['Views', (p: InfluencerAnalyticsPoint) => p.views.toLocaleString()],
                    ['Engagement', (p: InfluencerAnalyticsPoint) => p.engagement.toLocaleString()],
                  ] as Array<[string, (p: InfluencerAnalyticsPoint) => string]>).map(([label, fmt]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      {comparePoints.map((point) => <td key={point.id}>{fmt(point)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="inf-analytics__section-sub">Select up to 3 items to compare.</p>
            )}
          </>
        ) : null}
      </section>
    </div>
  )
}
