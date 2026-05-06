import { useMemo } from 'react'
import { Eye, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const columns = [
  ['date', 'Date'],
  ['influencer', 'Influencer'],
  ['campaignName', 'Video contract'],
  ['views', 'Views'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['salesAed', 'Sales AED'],
  ['engagementRate', 'Eng.'],
  ['cost', 'Cost'],
]

const METRIC_COLUMN_KEYS = new Set(['views', 'likes', 'comments', 'shares', 'salesAed', 'engagementRate', 'cost'])

function thClass(key, sortKey) {
  return [sortKey === key ? 'sorted' : '', METRIC_COLUMN_KEYS.has(key) ? 'ip-table__col--metric' : ''].filter(Boolean).join(' ')
}

function engagementSortKey(record) {
  return Number(toNumber(record.engagementRate).toFixed(2))
}

/** Best values among currently visible rows (ties all win). Max for metrics; min for cost. */
function useMetricBests(records) {
  return useMemo(() => {
    if (!records.length) return null
    const views = records.map((r) => toNumber(r.views))
    const likes = records.map((r) => toNumber(r.likes))
    const comments = records.map((r) => toNumber(r.comments))
    const shares = records.map((r) => toNumber(r.shares))
    const salesAed = records.map((r) => toNumber(r.salesAed))
    const eng = records.map((r) => engagementSortKey(r))
    const cost = records.map((r) => toNumber(r.cost))
    return {
      views: Math.max(...views),
      likes: Math.max(...likes),
      comments: Math.max(...comments),
      shares: Math.max(...shares),
      salesAed: Math.max(...salesAed),
      engagementRate: Math.max(...eng),
      cost: Math.min(...cost),
    }
  }, [records])
}

const WINNER_TITLE = {
  views: 'Highest views in this table',
  likes: 'Most likes in this table',
  comments: 'Most comments in this table',
  shares: 'Most shares in this table',
  salesAed: 'Highest sales (AED) in this table',
  engagementRate: 'Highest engagement rate in this table',
  cost: 'Lowest cost (AED) in this table',
}

function winnerMetricClass(field, record, bests) {
  if (!bests) return ''
  if (field === 'cost') {
    if (toNumber(record.cost) === bests.cost) return 'ip-table__cell--winner ip-table__cell--winner-cost'
    return ''
  }
  const val = field === 'engagementRate' ? engagementSortKey(record) : toNumber(record[field])
  const best = bests[field]
  if (best <= 0) return ''
  if (val === best) {
    const mod =
      field === 'engagementRate'
        ? 'eng'
        : field === 'salesAed'
          ? 'sales'
          : field
    return `ip-table__cell--winner ip-table__cell--winner-${mod}`
  }
  return ''
}

function sortIndicator(sort, key) {
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
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
  sort,
  onSort,
  onView,
  onEdit,
  onDelete,
  activeMonitorInfluencerId,
  onToggleMonitor,
}) {
  const bests = useMetricBests(records)

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
                <th key={key} className={thClass(key, sort.key)} onClick={() => onSort(key)}>
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
              const win = {
                views: winnerMetricClass('views', record, bests),
                likes: winnerMetricClass('likes', record, bests),
                comments: winnerMetricClass('comments', record, bests),
                shares: winnerMetricClass('shares', record, bests),
                salesAed: winnerMetricClass('salesAed', record, bests),
                engagementRate: winnerMetricClass('engagementRate', record, bests),
                cost: winnerMetricClass('cost', record, bests),
              }
              return (
                <tr key={record.id} className={`ip-table__detail-row ${isMonitorActive ? 'ip-table__detail-row--active' : ''}`}>
                  <td>{record.date}</td>
                  <td>
                    <InfluencerIdentity influencer={influencer} />
                  </td>
                  <td>
                    <span className="inf-table__name">{record.campaignName || record.videoTitle}</span>
                  </td>
                  <td className={`ip-table__col--metric ${win.views}`.trim()} title={win.views ? WINNER_TITLE.views : undefined}>
                    {formatNumber(record.views)}
                  </td>
                  <td className={`ip-table__col--metric ${win.likes}`.trim()} title={win.likes ? WINNER_TITLE.likes : undefined}>
                    {formatNumber(record.likes)}
                  </td>
                  <td className={`ip-table__col--metric ${win.comments}`.trim()} title={win.comments ? WINNER_TITLE.comments : undefined}>
                    {formatNumber(record.comments)}
                  </td>
                  <td className={`ip-table__col--metric ${win.shares}`.trim()} title={win.shares ? WINNER_TITLE.shares : undefined}>
                    {formatNumber(record.shares)}
                  </td>
                  <td className={`ip-table__col--metric ${win.salesAed}`.trim()} title={win.salesAed ? WINNER_TITLE.salesAed : undefined}>
                    {formatNumber(record.salesAed, { currency: 'AED' })}
                  </td>
                  <td className={`ip-table__col--metric ${win.engagementRate}`.trim()} title={win.engagementRate ? WINNER_TITLE.engagementRate : undefined}>
                    <strong>{toNumber(record.engagementRate).toFixed(2)}%</strong>
                  </td>
                  <td className={`ip-table__col--metric ${win.cost}`.trim()} title={win.cost ? WINNER_TITLE.cost : undefined}>
                    {formatNumber(record.cost, { currency: 'AED' })}
                  </td>
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
