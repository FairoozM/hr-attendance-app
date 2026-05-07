import { useEffect, useMemo, useState } from 'react'
import { Crown, Eye, Medal, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const AMOUNT_COLUMN_KEYS = new Set(['cost', 'salesAed', 'netProfitAed'])
const EMPTY_RANK_MAP = new Map()

function tableColumns(showNetProfitColumn) {
  const cols = [
    ['date', 'Date'],
    ['influencer', 'Influencer'],
    ['cost', 'Cost'],
    ['views', 'Views'],
    ['likes', 'Likes'],
    ['comments', 'Comments'],
    ['shares', 'Shares'],
    ['salesAed', 'Sales AED'],
  ]
  if (showNetProfitColumn) cols.push(['netProfitAed', 'Net profit'])
  return [['rank', '#'], ...cols]
}

function metricColumnKeySet(showNetProfitColumn) {
  const keys = ['rank', 'cost', 'views', 'likes', 'comments', 'shares', 'salesAed']
  if (showNetProfitColumn) keys.push('netProfitAed')
  return new Set(keys)
}

function thClass(key, sort, metricKeys) {
  const sortKey = sort?.key
  const isSorted = sortKey === key
  return [
    isSorted ? 'sorted' : '',
    metricKeys.has(key) ? 'ip-table__col--metric' : '',
    AMOUNT_COLUMN_KEYS.has(key) ? 'ip-table__col--amount' : '',
  ].filter(Boolean).join(' ')
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

function MetricCell({ field, record, bests, className = '', children }) {
  const mod = winnerPillMod(field, record, bests)
  const tdClass = [
    'ip-table__col--metric',
    AMOUNT_COLUMN_KEYS.has(field) ? 'ip-table__col--amount' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <td className={tdClass} title={mod ? WINNER_TITLE[field] : undefined}>
      {mod ? (
        <span className={`ip-table__winner-pill ip-table__winner-pill--${mod}`}>{children}</span>
      ) : (
        children
      )}
    </td>
  )
}

function sortIndicator(sort, key) {
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
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
  const [openActionsForId, setOpenActionsForId] = useState(null)

  useEffect(() => {
    if (!openActionsForId) return undefined
    const onDocPointerDown = (event) => {
      const menu = event.target.closest('.ip-table__row-menu')
      if (!menu || menu.getAttribute('data-record-id') !== String(openActionsForId)) {
        setOpenActionsForId(null)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenActionsForId(null)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openActionsForId])

  const columns = useMemo(() => tableColumns(showNetProfitColumn), [showNetProfitColumn])
  const metricKeys = useMemo(() => metricColumnKeySet(showNetProfitColumn), [showNetProfitColumn])
  const bests = useMetricBests(records, showNetProfitColumn)

  return (
    <section className="ip-table-card">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Eye size={18} /></span>
        <div>
          <h2>Influencers Performance Ranking</h2>
        </div>
      </div>

      <div className="inf-table-wrap ip-table-wrap">
        <table className="inf-table ip-table">
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  data-col={key}
                  className={thClass(key, sort, metricKeys)}
                  onClick={() => onSort(key)}
                >
                  {label}{sortIndicator(sort, key)}
                </th>
              ))}
              <th className="ip-table__col--actions ip-table__col--actions-compact" aria-label="Actions" />
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
                  <td className="ip-table__col--influencer">
                    <InfluencerIdentity influencer={influencer} />
                  </td>
                  <MetricCell field="cost" record={record} bests={bests}>
                    {formatNumber(record.cost, { currency: 'AED' })}
                  </MetricCell>
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
                  {showNetProfitColumn ? (
                    <MetricCell field="netProfitAed" record={record} bests={bests} className="ip-table__col--netprofit">
                      {formatNumber(record.netProfitAed, { currency: 'AED' })}
                    </MetricCell>
                  ) : null}
                  <td className="ip-table__col--actions ip-table__col--actions-compact">
                    <div
                      className="ip-table__row-menu"
                      data-record-id={record.id}
                    >
                      <button
                        type="button"
                        className="ip-table__row-menu-trigger"
                        aria-label="Row actions"
                        aria-haspopup="menu"
                        aria-expanded={openActionsForId === record.id}
                        onClick={() => setOpenActionsForId((current) => (current === record.id ? null : record.id))}
                      >
                        <MoreVertical size={18} strokeWidth={2.25} aria-hidden />
                      </button>
                      {openActionsForId === record.id ? (
                        <div className="ip-table__row-menu-dropdown" role="menu">
                          <button
                            type="button"
                            className="ip-table__row-menu-item"
                            role="menuitem"
                            onClick={() => {
                              onToggleMonitor(record.influencerId)
                              setOpenActionsForId(null)
                            }}
                          >
                            <span className="ip-table__row-menu-icon-slot" aria-hidden />
                            {isMonitorActive ? 'Hide contract timeline' : 'Show contract timeline'}
                          </button>
                          <button
                            type="button"
                            className="ip-table__row-menu-item"
                            role="menuitem"
                            onClick={() => {
                              onView(record)
                              setOpenActionsForId(null)
                            }}
                          >
                            <Eye size={15} aria-hidden /> View
                          </button>
                          {onEdit ? (
                            <button
                              type="button"
                              className="ip-table__row-menu-item"
                              role="menuitem"
                              onClick={() => {
                                onEdit(record)
                                setOpenActionsForId(null)
                              }}
                            >
                              <Pencil size={15} aria-hidden /> Edit
                            </button>
                          ) : null}
                          {onDelete ? (
                            <button
                              type="button"
                              className="ip-table__row-menu-item ip-table__row-menu-item--danger"
                              role="menuitem"
                              onClick={() => {
                                onDelete(record.id)
                                setOpenActionsForId(null)
                              }}
                            >
                              <Trash2 size={15} aria-hidden /> Delete
                            </button>
                          ) : null}
                        </div>
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
