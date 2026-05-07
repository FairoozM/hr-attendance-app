import { useEffect, useMemo, useState } from 'react'
import { Crown, Eye, Medal, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const AMOUNT_COLUMN_KEYS = new Set(['cost', 'salesAed', 'netProfitAed'])
const EMPTY_RANK_MAP = new Map()

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

function MetricSlot({ label, field, record, bests, children }) {
  const mod = winnerPillMod(field, record, bests)
  return (
    <div className="ip-phone-card__metric">
      <span className="ip-phone-card__metric-label">{label}</span>
      <div
        className={[
          'ip-phone-card__metric-value',
          AMOUNT_COLUMN_KEYS.has(field) ? 'ip-phone-card__metric-value--amount' : '',
        ].filter(Boolean).join(' ')}
        title={mod ? WINNER_TITLE[field] : undefined}
      >
        {mod ? (
          <span className={`ip-table__winner-pill ip-table__winner-pill--${mod}`}>{children}</span>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function RankBadge({ rankInfo }) {
  if (!rankInfo) {
    return <span className="ip-table__rank-muted">—</span>
  }
  const { rank } = rankInfo
  if (rank === 1) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--gold" title="1st place (contract composite)">
        <Crown size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--silver" title="2nd place (contract composite)">
        <Medal size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--bronze" title="3rd place (contract composite)">
        <Medal size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  return <span className="ip-table__rank-muted">#{rank}</span>
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
    <div className="ip-table__influencer-cell ip-phone-card__influencer">
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

export function InfluencerPerformanceTableIphone({
  records,
  influencersById,
  rankingByRecordId = EMPTY_RANK_MAP,
  showNetProfitColumn = false,
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

  const bests = useMetricBests(records, showNetProfitColumn)

  return (
    <section className="ip-table-card ip-table-card--iphone">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Eye size={18} /></span>
        <div>
          <h2>Performance ranking</h2>
          <p className="ip-table-card--iphone__hint">One card per row — scroll vertically. Use Sort above to change order.</p>
        </div>
      </div>

      <ul className="ip-phone-ranking">
        {records.length === 0 ? (
          <li className="ip-phone-card ip-phone-card--empty">
            <div className="ip-empty-row">No performance records match these filters.</div>
          </li>
        ) : records.map((record) => {
          const influencerId = String(record.influencerId || '')
          const isMonitorActive = String(activeMonitorInfluencerId) === influencerId
          const influencer = influencersById.get(influencerId)
          const rankInfo = rankingByRecordId.get(record.id)
          return (
            <li
              key={record.id}
              className={[
                'ip-phone-card',
                isMonitorActive ? 'ip-phone-card--active' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="ip-phone-card__top">
                <RankBadge rankInfo={rankInfo} />
                <div
                  className="ip-table__row-menu ip-phone-card__menu"
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
              </div>

              <InfluencerIdentity influencer={influencer} />

              <div className="ip-phone-card__date">{record.date}</div>

              <div className="ip-phone-card__metrics">
                <MetricSlot label="Cost" field="cost" record={record} bests={bests}>
                  {formatNumber(record.cost, { currency: 'AED' })}
                </MetricSlot>
                <MetricSlot label="Views" field="views" record={record} bests={bests}>
                  {formatNumber(record.views)}
                </MetricSlot>
                <MetricSlot label="Likes" field="likes" record={record} bests={bests}>
                  {formatNumber(record.likes)}
                </MetricSlot>
                <MetricSlot label="Comments" field="comments" record={record} bests={bests}>
                  {formatNumber(record.comments)}
                </MetricSlot>
                <MetricSlot label="Shares" field="shares" record={record} bests={bests}>
                  {formatNumber(record.shares)}
                </MetricSlot>
                <MetricSlot label="Sales AED" field="salesAed" record={record} bests={bests}>
                  {formatNumber(record.salesAed, { currency: 'AED' })}
                </MetricSlot>
                {showNetProfitColumn ? (
                  <MetricSlot label="Net profit" field="netProfitAed" record={record} bests={bests}>
                    {formatNumber(record.netProfitAed, { currency: 'AED' })}
                  </MetricSlot>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
