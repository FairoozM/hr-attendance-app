import { useEffect, useMemo, useState } from 'react'
import { Crown, Eye, Medal, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMYRange } from '../../utils/dateFormat'

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

function MetricSlot({ label, field, record, bests, valueAlign = 'start', children }) {
  const mod = winnerPillMod(field, record, bests)
  const end = valueAlign === 'end'
  return (
    <div
      className={[
        'flex min-w-0 flex-col gap-1 rounded-2xl border px-3.5 py-3',
        'bg-[var(--ip-phone-metric-bg)] border-[var(--ip-phone-metric-border)]',
        'shadow-[var(--ip-phone-metric-inset)]',
      ].join(' ')}
    >
      <span className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[color:var(--ip-phone-label)]">
        {label}
      </span>
      <div
        className={[
          'text-[0.875rem] font-bold tabular-nums leading-tight text-[color:var(--ip-phone-value)]',
          end ? 'flex w-full justify-end text-right' : 'text-left',
        ].join(' ')}
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

function NetProfitFooter({ record, bests }) {
  const field = 'netProfitAed'
  const mod = winnerPillMod(field, record, bests)
  const val = formatNumber(record.netProfitAed, { currency: 'AED' })
  return (
    <div
      className={[
        'mt-4 rounded-full border px-4 py-3.5',
        'bg-[var(--ip-phone-net-bg)] border-[var(--ip-phone-net-border)]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]',
      ].join(' ')}
    >
      <div className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[color:var(--ip-phone-label)]">
        Net profit
      </div>
      <div
        className="flex justify-end text-[0.94rem] font-black tabular-nums text-[color:var(--ip-phone-value)]"
        title={mod ? WINNER_TITLE[field] : undefined}
      >
        {mod ? (
          <span className={`ip-table__winner-pill ip-table__winner-pill--${mod}`}>{val}</span>
        ) : (
          val
        )}
      </div>
    </div>
  )
}

function RankBadge({ rankInfo }) {
  if (!rankInfo) {
    return <span className="ip-phone-rank-plain">—</span>
  }
  const { rank } = rankInfo
  if (rank === 1) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--gold shadow-sm" title="1st place (contract composite)">
        <Crown size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--silver shadow-sm" title="2nd place (contract composite)">
        <Medal size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="ip-table__rank-pill ip-table__rank-pill--bronze shadow-sm" title="3rd place (contract composite)">
        <Medal size={14} strokeWidth={2.2} aria-hidden />
        <span>#{rank}</span>
      </span>
    )
  }
  return <span className="ip-phone-rank-plain">#{rank}</span>
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
    <div className="flex items-center gap-3.5 pb-1 pt-0.5">
      <div
        className={[
          'relative grid h-[3.25rem] w-[3.25rem] shrink-0 place-items-center overflow-hidden rounded-full',
          'shadow-md ring-2 ring-[var(--ip-phone-avatar-ring)]',
        ].join(' ')}
        style={{ background: 'var(--ip-phone-avatar-placeholder)' }}
        aria-hidden
      >
        <span className="relative z-[1] text-[0.68rem] font-black tracking-wide text-[color:var(--ip-phone-avatar-fg)]">{initials(name)}</span>
        {influencer?.profileImage ? (
          <img
            src={influencer.profileImage}
            alt=""
            className="absolute inset-0 z-[2] size-full object-cover"
            onError={(event) => {
              event.currentTarget.remove()
            }}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.95rem] font-bold leading-snug text-[color:var(--ip-phone-value)]">{name}</div>
        <div className="truncate text-[0.72rem] font-semibold text-[color:var(--ip-phone-label)]">
          {influencer?.username?.trim() || '—'}
        </div>
      </div>
    </div>
  )
}

export function InfluencerPerformanceTableIphone({
  records,
  influencersById,
  rankingByRecordId = EMPTY_RANK_MAP,
  showNetProfitColumn = false,
  onEdit,
  onDelete,
  activeMonitorInfluencerId,
  onToggleMonitor,
}) {
  const [openActionsForId, setOpenActionsForId] = useState(null)
  const [actionMenuStyle, setActionMenuStyle] = useState(null)

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
    const closeMenu = () => setOpenActionsForId(null)
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [openActionsForId])

  function toggleActionMenu(event, recordId) {
    setOpenActionsForId((current) => {
      if (current === recordId) {
        setActionMenuStyle(null)
        return null
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const menuWidth = Math.min(224, window.innerWidth - 24)
      const menuHeight = 188
      const gutter = 12
      const top = rect.bottom + menuHeight + gutter > window.innerHeight
        ? Math.max(gutter, rect.top - menuHeight - 6)
        : rect.bottom + 6
      const left = Math.min(
        Math.max(gutter, rect.right - menuWidth),
        window.innerWidth - menuWidth - gutter,
      )
      setActionMenuStyle({ top: `${top}px`, left: `${left}px`, minWidth: `${menuWidth}px` })
      return recordId
    })
  }

  const bests = useMetricBests(records, showNetProfitColumn)

  return (
    <section className="ip-table-card ip-table-card--iphone">
      <div className="ip-section-heading flex items-start gap-2">
        <span className="ip-section-heading__icon mt-0.5 grid place-items-center rounded-xl bg-[var(--ip-phone-metric-bg)] p-2 shadow-sm ring-1 ring-[var(--ip-phone-metric-border)]">
          <Eye size={17} className="text-[color:var(--ip-phone-label)]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.06rem] font-bold tracking-tight text-[color:var(--ip-phone-value)]">Performance ranking</h2>
          <p className="ip-table-card--iphone__hint">
            Soft cards + metric tiles — scroll vertically. Sort with the controls above.
          </p>
        </div>
      </div>

      <ul className="ip-phone-ranking">
        {records.length === 0 ? (
          <li
            className={[
              'rounded-[1.35rem] border border-[var(--ip-phone-card-border)] bg-[var(--ip-phone-card-bg)]',
              'p-8 text-center shadow-[var(--ip-phone-card-shadow)] ring-1 ring-[var(--ip-phone-card-ring)]',
            ].join(' ')}
          >
            <div className="ip-empty-row text-[color:var(--ip-phone-label)]">No performance records match these filters.</div>
          </li>
        ) : records.map((record) => {
          const influencerId = String(record.influencerId || '')
          const isMonitorActive = String(activeMonitorInfluencerId) === String(record.id) || String(activeMonitorInfluencerId) === influencerId
          const influencer = influencersById.get(influencerId)
          const rankInfo = rankingByRecordId.get(record.id)
          return (
            <li
              key={record.id}
              className={[
                'ip-phone-card group relative overflow-hidden rounded-[1.35rem] border',
                'border-[var(--ip-phone-card-border)] bg-[var(--ip-phone-card-bg)]',
                'p-5 shadow-[var(--ip-phone-card-shadow)] ring-1 ring-[var(--ip-phone-card-ring)]',
                'sm:p-6',
                'transition-[transform,box-shadow] duration-200 will-change-transform',
                'active:scale-[0.985]',
                isMonitorActive ? 'ring-2 ring-cyan-500/35 ring-offset-2 ring-offset-[var(--ip-phone-canvas)]' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 shrink pt-0.5">
                  <RankBadge rankInfo={rankInfo} />
                </div>
                <div className="ip-table__row-menu ip-phone-card__menu shrink-0" data-record-id={record.id}>
                  <button
                    type="button"
                    className="ip-table__row-menu-trigger"
                    aria-label="Row actions"
                    aria-haspopup="menu"
                    aria-expanded={openActionsForId === record.id}
                    onClick={(event) => toggleActionMenu(event, record.id)}
                  >
                    <MoreVertical size={18} strokeWidth={2.25} aria-hidden />
                  </button>
                  {openActionsForId === record.id ? (
                    <div className="ip-table__row-menu-dropdown" role="menu" style={actionMenuStyle || undefined}>
                      <button
                        type="button"
                        className="ip-table__row-menu-item"
                        role="menuitem"
                        onClick={() => {
                          onToggleMonitor(record.influencerId, record)
                          setOpenActionsForId(null)
                        }}
                      >
                        <span className="ip-table__row-menu-icon-slot" aria-hidden />
                      {isMonitorActive ? 'Hide contract timeline' : 'Open contract timeline'}
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

              <div className="mb-3.5 flex flex-wrap items-center gap-2 text-[0.78rem] font-semibold tabular-nums text-[color:var(--ip-phone-date)]">
                <span>
                  {fmtDMYRange(
                    record.startDate || record.contractStartDate || record.date,
                    record.latestDate || record.latest?.date || record.date,
                  )}
                </span>
                <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.1em] text-cyan-700">
                  {record.recordedDays || 0}/{record.monitoringDays || 5} days
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
                <MetricSlot label="Cost" field="cost" record={record} bests={bests} valueAlign="start">
                  {formatNumber(record.cost, { currency: 'AED' })}
                </MetricSlot>
                <MetricSlot label="Views" field="views" record={record} bests={bests} valueAlign="end">
                  {formatNumber(record.views)}
                </MetricSlot>
                <MetricSlot label="Likes" field="likes" record={record} bests={bests} valueAlign="start">
                  {formatNumber(record.likes)}
                </MetricSlot>
                <MetricSlot label="Comments" field="comments" record={record} bests={bests} valueAlign="end">
                  {formatNumber(record.comments)}
                </MetricSlot>
                <MetricSlot label="Shares" field="shares" record={record} bests={bests} valueAlign="start">
                  {formatNumber(record.shares)}
                </MetricSlot>
                <MetricSlot label="Sales AED" field="salesAed" record={record} bests={bests} valueAlign="end">
                  {formatNumber(record.salesAed, { currency: 'AED' })}
                </MetricSlot>
              </div>

              {showNetProfitColumn ? <NetProfitFooter record={record} bests={bests} /> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
