import { useEffect, useMemo, useState } from 'react'
import { Crown, Eye, Medal, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY, fmtISO } from '../../utils/dateFormat'
import {
  EMPTY_RANK_MAP,
  influencerInitials,
  useMetricBests,
  winnerPillMod,
  WINNER_TITLE,
} from './influencerPerformanceTableShared'

const AMOUNT_COLUMN_KEYS = new Set(['cost', 'salesAed', 'netProfitAed'])

const CLOSED_ROW_MENU = { openId: null, menuStyle: null }

/** Pointer targets can be Text nodes (no .closest); normalize to an Element. */
function pointerTargetElement(event) {
  const t = event.target
  return t instanceof Element ? t : t?.parentElement ?? null
}

function tableColumns(showNetProfitColumn) {
  const cols = [
    ['date', 'Contract Dates'],
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

function InfluencerIdentity({ influencer }) {
  const name = influencer?.name || 'Unknown'
  return (
    <div className="ip-table__influencer-cell">
      <div className="ip-table__avatar" aria-hidden="true">
        <span>{influencerInitials(name)}</span>
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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function compactContractDateRange(start, end) {
  const startIso = fmtISO(start)
  const endIso = fmtISO(end)
  if (!startIso && !endIso) return '—'
  if (!endIso || startIso === endIso) {
    const [year, month, day] = (startIso || endIso).split('-')
    return `${day} ${SHORT_MONTHS[Number(month) - 1]} ${year}`
  }
  if (!startIso) {
    const [year, month, day] = endIso.split('-')
    return `${day} ${SHORT_MONTHS[Number(month) - 1]} ${year}`
  }
  const [startYear, startMonth, startDay] = startIso.split('-')
  const [endYear, endMonth, endDay] = endIso.split('-')
  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay} - ${endDay} ${SHORT_MONTHS[Number(endMonth) - 1]} ${endYear}`
  }
  if (startYear === endYear) {
    return `${startDay} ${SHORT_MONTHS[Number(startMonth) - 1]} - ${endDay} ${SHORT_MONTHS[Number(endMonth) - 1]} ${endYear}`
  }
  return `${startDay} ${SHORT_MONTHS[Number(startMonth) - 1]} ${startYear} - ${endDay} ${SHORT_MONTHS[Number(endMonth) - 1]} ${endYear}`
}

function ContractDatesCell({ record }) {
  const start = record.startDate || record.contractStartDate || record.date || '—'
  const latest = record.latestDate || record.latest?.date || start
  const dateText = compactContractDateRange(start, latest)
  const dayText = `${record.recordedDays || 0} of ${record.monitoringDays || 5} check-ins`
  return (
    <td>
      <div className="ip-table__contract-dates">
        <strong>{dateText}</strong>
        <span>{dayText}</span>
      </div>
    </td>
  )
}

export function InfluencerPerformanceTable({
  records,
  influencersById,
  rankingsByContractId = EMPTY_RANK_MAP,
  showNetProfitColumn = false,
  sort,
  onSort,
  onEdit,
  onDelete,
  headerAction,
  activeMonitorInfluencerId,
  onToggleMonitor,
  dateFrom = '',
  dateTo = '',
  onDateFromChange,
  onDateToChange,
  onClearTableDates,
  totalContracts,
}) {
  const [rowMenu, setRowMenu] = useState(CLOSED_ROW_MENU)

  useEffect(() => {
    if (!rowMenu.openId) return undefined
    const openId = rowMenu.openId
    const onDocPointerDown = (event) => {
      const menu = pointerTargetElement(event)?.closest('.ip-table__row-menu')
      if (!menu || menu.getAttribute('data-record-id') !== String(openId)) {
        setRowMenu(CLOSED_ROW_MENU)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setRowMenu(CLOSED_ROW_MENU)
    }
    const closeMenu = () => setRowMenu(CLOSED_ROW_MENU)
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
  }, [rowMenu.openId])

  useEffect(() => {
    if (!rowMenu.openId) return
    const exists = records.some((r) => String(r.id) === String(rowMenu.openId))
    if (!exists) setRowMenu(CLOSED_ROW_MENU)
  }, [records, rowMenu.openId])

  function toggleActionMenu(event, recordId) {
    setRowMenu((prev) => {
      if (String(prev.openId) === String(recordId)) {
        return CLOSED_ROW_MENU
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const menuWidth = 224
      const menuHeight = 188
      const gutter = 12
      const top = rect.bottom + menuHeight + gutter > window.innerHeight
        ? Math.max(gutter, rect.top - menuHeight - 6)
        : rect.bottom + 6
      const left = Math.min(
        Math.max(gutter, rect.right - menuWidth),
        window.innerWidth - menuWidth - gutter,
      )
      return {
        openId: recordId,
        menuStyle: { top: `${top}px`, left: `${left}px`, minWidth: `${menuWidth}px` },
      }
    })
  }

  const columns = useMemo(() => tableColumns(showNetProfitColumn), [showNetProfitColumn])
  const metricKeys = useMemo(() => metricColumnKeySet(showNetProfitColumn), [showNetProfitColumn])
  const bests = useMetricBests(records, showNetProfitColumn)
  const total = totalContracts != null ? totalContracts : records.length
  const hasTableDateFilter = Boolean(dateFrom || dateTo)

  return (
    <section className="ip-table-card">
      <div className="ip-section-heading ip-table-card__heading">
        <div className="ip-table-card__heading-copy">
          <span className="ip-section-heading__icon"><Eye size={18} /></span>
          <div>
            <h2>Influencers Performance Ranking</h2>
            {hasTableDateFilter ? (
              <p className="ip-table-card__filter-summary" role="status">
                Showing <strong>{records.length}</strong> of <strong>{total}</strong> contracts
                {dateFrom && dateTo ? (
                  <> for {fmtDMY(dateFrom)} – {fmtDMY(dateTo)}</>
                ) : dateFrom ? (
                  <> from {fmtDMY(dateFrom)}</>
                ) : (
                  <> through {fmtDMY(dateTo)}</>
                )}
                .
              </p>
            ) : null}
          </div>
        </div>
        <div className="ip-table-card__heading-toolbar">
          <div className="ip-table-card__heading-filters" role="group" aria-label="Filter ranking by contract dates">
            <label className="ip-field ip-field--inline">
              <span>From</span>
              <input
                className="ip-control"
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange?.(e.target.value)}
              />
            </label>
            <label className="ip-field ip-field--inline">
              <span>To</span>
              <input
                className="ip-control"
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange?.(e.target.value)}
              />
            </label>
            {hasTableDateFilter ? (
              <button
                type="button"
                className="inf-btn inf-btn--ghost inf-btn--xs ip-table-card__clear-dates"
                onClick={() => onClearTableDates?.()}
              >
                Clear dates
              </button>
            ) : null}
          </div>
          {headerAction ? <div className="ip-table-card__heading-action">{headerAction}</div> : null}
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
              const isMonitorActive = String(activeMonitorInfluencerId) === String(record.id) || String(activeMonitorInfluencerId) === influencerId
              const influencer = influencersById.get(influencerId)
              const rankInfo = rankingsByContractId.get(record.id)
              return (
                <tr key={record.id} className={`ip-table__detail-row ${isMonitorActive ? 'ip-table__detail-row--active' : ''}`}>
                  <RankCell rankInfo={rankInfo} />
                  <ContractDatesCell record={record} />
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
                        aria-expanded={String(rowMenu.openId) === String(record.id)}
                        onClick={(event) => toggleActionMenu(event, record.id)}
                      >
                        <MoreVertical size={18} strokeWidth={2.25} aria-hidden />
                      </button>
                      {String(rowMenu.openId) === String(record.id) ? (
                        <div className="ip-table__row-menu-dropdown" role="menu" style={rowMenu.menuStyle || undefined}>
                          <button
                            type="button"
                            className="ip-table__row-menu-item"
                            role="menuitem"
                            onClick={() => {
                              onToggleMonitor(record.influencerId, record)
                              setRowMenu(CLOSED_ROW_MENU)
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
                                setRowMenu(CLOSED_ROW_MENU)
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
                                setRowMenu(CLOSED_ROW_MENU)
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
