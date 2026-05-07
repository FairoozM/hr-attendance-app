import { useMemo } from 'react'
import { Crown, Eye, Medal, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const EMPTY_RANK_MAP = new Map()

function tableColumns(showNetProfitColumn) {
  const mid = [
    ['date', 'Date'],
    ['influencer', 'Influencer'],
    ['campaignName', 'Video contract'],
    ['views', 'Views'],
    ['likes', 'Likes'],
    ['comments', 'Comments'],
    ['shares', 'Shares'],
    ['salesAed', 'Sales AED'],
    ['cost', 'Cost'],
  ]
  if (showNetProfitColumn) mid.push(['netProfitAed', 'Net profit AED'])
  mid.push(['score', 'Score'])
  return [['rank', '#'], ...mid]
}

function metricColumnKeySet(showNetProfitColumn) {
  const keys = ['rank', 'views', 'likes', 'comments', 'shares', 'salesAed', 'cost']
  if (showNetProfitColumn) keys.push('netProfitAed')
  keys.push('score')
  return new Set(keys)
}

function thClass(key, sort, metricKeys) {
  const sortKey = sort?.key
  const isSorted = key === 'score' ? sortKey === 'rank' : sortKey === key
  return [isSorted ? 'sorted' : '', metricKeys.has(key) ? 'ip-table__col--metric' : ''].filter(Boolean).join(' ')
}

/** Best values among currently visible rows (ties all win). Max for metrics; min for cost. */
function useMetricBests(records, includeNetProfit) {
  return useMemo(() => {
    if (!records.length) return null
    const views = records.map((r) => toNumber(r.views))
    const likes = records.map((r) => toNumber(r.likes))
    const comments = records.map((r) => toNumber(r.comments))
    const shares = records.map((r) => toNumber(r.shares))
    const salesAed = records.map((r) => toNumber(r.salesAed))
    const cost = records.map((r) => toNumber(r.cost))
    const base = {
      views: Math.max(...views),
      likes: Math.max(...likes),
      comments: Math.max(...comments),
      shares: Math.max(...shares),
      salesAed: Math.max(...salesAed),
      cost: Math.min(...cost),
    }
    if (includeNetProfit) {
      const netProfitAed = records.map((r) => toNumber(r.netProfitAed))
      base.netProfitAed = Math.max(...netProfitAed)
    }
    return base
  }, [records, includeNetProfit])
}

const WINNER_TITLE = {
  views: 'Highest views in this table',
  likes: 'Most likes in this table',
  comments: 'Most comments in this table',
  shares: 'Most shares in this table',
  salesAed: 'Highest sales (AED) in this table',
  netProfitAed: 'Highest net profit (AED) in this table',
  cost: 'Lowest cost (AED) in this table',
}

/** Suffix for `.ip-table__winner-pill--{suffix}` or '' if not a winner in this column. */
function winnerPillMod(field, record, bests) {
  if (!bests) return ''
  if (field === 'cost') {
    if (toNumber(record.cost) === bests.cost) return 'cost'
    return ''
  }
  if (field === 'netProfitAed') {
    const val = toNumber(record.netProfitAed)
    const best = bests.netProfitAed
    if (val !== best) return ''
    return 'sales'
  }
  const val = toNumber(record[field])
  const best = bests[field]
  if (best <= 0) return ''
  if (val !== best) return ''
  if (field === 'salesAed') return 'sales'
  return field
}

function MetricCell({ field, record, bests, children }) {
  const mod = winnerPillMod(field, record, bests)
  return (
    <td className="ip-table__col--metric" title={mod ? WINNER_TITLE[field] : undefined}>
      {mod ? (
        <span className={`ip-table__winner-pill ip-table__winner-pill--${mod}`}>{children}</span>
      ) : (
        children
      )}
    </td>
  )
}

function sortIndicator(sort, key) {
  if (key === 'score') {
    if (sort.key !== 'rank') return ''
    return sort.direction === 'asc' ? ' ↑' : ' ↓'
  }
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
}

function formatScoreTooltip(rankInfo) {
  if (!rankInfo?.breakdown) return ''
  const b = rankInfo.breakdown
  const parts = [
    `Sales ${b.normSales.toFixed(2)}`,
    `Views ${b.normViews.toFixed(2)}`,
    `Likes ${b.normLikes.toFixed(2)}`,
    `Comments ${b.normComments.toFixed(2)}`,
    `Shares ${b.normShares.toFixed(2)}`,
    `Cost eff. ${b.normCostEff.toFixed(2)}`,
  ]
  return `Contract rank #${rankInfo.rank} · ${rankInfo.score100}/100 (min–max vs visible contracts)\n${parts.join(' · ')}`
}

function RankCell({ rankInfo }) {
  if (!rankInfo) {
    return <td className="ip-table__col--metric ip-table__col--rank"><span className="ip-table__rank-muted">—</span></td>
  }
  const { rank } = rankInfo
  if (rank === 1) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--gold" title="1st place (contract composite)">
          <Crown size={14} strokeWidth={2.2} aria-hidden />
          <span>#{rank}</span>
        </span>
      </td>
    )
  }
  if (rank === 2) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--silver" title="2nd place (contract composite)">
          <Medal size={14} strokeWidth={2.2} aria-hidden />
          <span>#{rank}</span>
        </span>
      </td>
    )
  }
  if (rank === 3) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--bronze" title="3rd place (contract composite)">
          <Medal size={14} strokeWidth={2.2} aria-hidden />
          <span>#{rank}</span>
        </span>
      </td>
    )
  }
  return (
    <td className="ip-table__col--metric ip-table__col--rank">
      <span className="ip-table__rank-muted">#{rank}</span>
    </td>
  )
}

function ScoreCell({ rankInfo }) {
  if (!rankInfo) {
    return (
      <td className="ip-table__col--metric ip-table__col--score">
        <span className="ip-table__rank-muted">—</span>
      </td>
    )
  }
  const w = Math.min(100, Math.max(0, rankInfo.score100))
  return (
    <td className="ip-table__col--metric ip-table__col--score" title={formatScoreTooltip(rankInfo)}>
      <div className="ip-score-cell">
        <span className="ip-score-cell__value">{rankInfo.score100}</span>
        <div className="ip-score-bar" role="presentation">
          <span className="ip-score-bar__fill" style={{ width: `${w}%` }} />
        </div>
      </div>
    </td>
  )
}

function initials(name) {
  return String(name || 'IN')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'IN'
}

function InfluencerIdentity({ influencer }) {
  const name = influencer?.name || 'Unknown'
  return (
    <div className="ip-table__influencer-cell">
      <div className="ip-table__avatar" aria-hidden="true">
        <span>{initials(name)}</span>
        {influencer?.profileImage ? (
          <img
            src={influencer.profileImage}
            alt=""
            onError={(event) => {
              event.currentTarget.remove()
            }}
          />
        ) : null}
      </div>
      <div className="ip-table__influencer-copy">
        <span className="inf-table__name">{name}</span>
        <span className="ip-table__sub">{influencer?.username?.trim() || '—'}</span>
      </div>
    </div>
  )
}

export function InfluencerPerformanceTable({
  records,
  influencersById,
  rankingByRecordId = EMPTY_RANK_MAP,
  showNetProfitColumn = false,
  sort,
  onSort,
  onView,
  onEdit,
  onDelete,
  activeMonitorInfluencerId,
  onToggleMonitor,
}) {
  const columns = useMemo(() => tableColumns(showNetProfitColumn), [showNetProfitColumn])
  const metricKeys = useMemo(() => metricColumnKeySet(showNetProfitColumn), [showNetProfitColumn])
  const bests = useMetricBests(records, showNetProfitColumn)

  return (
    <section className="ip-table-card">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Eye size={18} /></span>
        <div>
          <h2>Performance records</h2>
        </div>
      </div>

      <div className="inf-table-wrap ip-table-wrap">
        <table className="inf-table ip-table">
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  className={thClass(key, sort, metricKeys)}
                  onClick={() => onSort(key === 'score' ? 'rank' : key)}
                >
                  {label}{sortIndicator(sort, key)}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  <div className="ip-empty-row">No performance records match these filters.</div>
                </td>
              </tr>
            ) : records.map((record) => {
              const influencerId = String(record.influencerId || '')
              const isMonitorActive = String(activeMonitorInfluencerId) === influencerId
              const influencer = influencersById.get(influencerId)
              const rankInfo = rankingByRecordId.get(record.id)
              return (
                <tr key={record.id} className={`ip-table__detail-row ${isMonitorActive ? 'ip-table__detail-row--active' : ''}`}>
                  <RankCell rankInfo={rankInfo} />
                  <td>{record.date}</td>
                  <td>
                    <InfluencerIdentity influencer={influencer} />
                  </td>
                  <td>
                    <span className="inf-table__name">{record.campaignName || record.videoTitle}</span>
                  </td>
                  <MetricCell field="views" record={record} bests={bests}>
                    {formatNumber(record.views)}
                  </MetricCell>
                  <MetricCell field="likes" record={record} bests={bests}>
                    {formatNumber(record.likes)}
                  </MetricCell>
                  <MetricCell field="comments" record={record} bests={bests}>
                    {formatNumber(record.comments)}
                  </MetricCell>
                  <MetricCell field="shares" record={record} bests={bests}>
                    {formatNumber(record.shares)}
                  </MetricCell>
                  <MetricCell field="salesAed" record={record} bests={bests}>
                    {formatNumber(record.salesAed, { currency: 'AED' })}
                  </MetricCell>
                  <MetricCell field="cost" record={record} bests={bests}>
                    {formatNumber(record.cost, { currency: 'AED' })}
                  </MetricCell>
                  {showNetProfitColumn ? (
                    <MetricCell field="netProfitAed" record={record} bests={bests}>
                      {formatNumber(record.netProfitAed, { currency: 'AED' })}
                    </MetricCell>
                  ) : null}
                  <ScoreCell rankInfo={rankInfo} />
                  <td>
                    <div className="inf-table__actions">
                      <button
                        type="button"
                        className="inf-btn inf-btn--ghost inf-btn--xs ip-table__expand-btn"
                        onClick={() => onToggleMonitor(record.influencerId)}
                      >
                        {isMonitorActive ? 'Hide' : 'Show'}
                      </button>
                      <button type="button" className="inf-btn-icon" onClick={() => onView(record)} aria-label="View performance record">
                        <Eye size={15} />
                      </button>
                      {onEdit ? (
                        <button type="button" className="inf-btn-icon" onClick={() => onEdit(record)} aria-label="Edit performance record">
                          <Pencil size={15} />
                        </button>
                      ) : null}
                      {onDelete ? (
                        <button type="button" className="inf-btn-icon ip-danger-icon" onClick={() => onDelete(record.id)} aria-label="Delete performance record">
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
