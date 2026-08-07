import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Camera,
  CalendarDays,
  Crown,
  Eye,
  Heart,
  Medal,
  MessageSquare,
  MoreVertical,
  Pencil,
  Send,
  ShoppingBag,
  Trash2,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtISO } from '../../utils/dateFormat'
import type {
  InfluencerContractRanking,
  InfluencerContractRow,
  InfluencerMetricBestField,
  InfluencerMetricBests,
  InfluencerPerformanceProfile,
  InfluencerPerformanceSort,
} from '../../types/influencer'
import {
  EMPTY_RANK_MAP,
  influencerInitials,
  useMetricBests,
  winnerPillMod,
  WINNER_TITLE,
} from './influencerPerformanceTableShared'
import {
  PERFORMANCE_RANKING_DATE_PRESETS,
  sumPerformanceRankingTotals,
  type InfluencerPerformanceRankingDatePreset,
} from '../../pages/influencers/influencerPerformanceRankingUtils'

const AMOUNT_COLUMN_KEYS = new Set<InfluencerMetricBestField>(['cost', 'salesAed', 'netProfitAed'])

type TableColumnKey = 'rank' | 'date' | 'influencer' | InfluencerMetricBestField

interface RowMenuStyle {
  top: string
  left: string
  minWidth: string
}

interface RowMenuState {
  openId: string | number | null
  menuStyle: RowMenuStyle | null
}

interface InfluencerPerformanceTableProps {
  records: InfluencerContractRow[]
  influencersById: Map<string, InfluencerPerformanceProfile>
  rankingsByContractId?: Map<string, InfluencerContractRanking>
  showNetProfitColumn?: boolean
  sort: InfluencerPerformanceSort
  onSort: (key: string) => void
  onEdit?: (row: InfluencerContractRow) => void
  onDelete?: (contractId: string | number) => void
  onInfluencerClick?: (influencerId: string) => void
  headerAction?: ReactNode
  activeMonitorInfluencerId?: string | number | null
  onToggleMonitor: (influencerId: string | number | undefined, row: InfluencerContractRow) => void
  datePreset?: InfluencerPerformanceRankingDatePreset
  onDatePresetChange?: (preset: InfluencerPerformanceRankingDatePreset) => void
  rankingCustomFrom?: string
  rankingCustomTo?: string
  onRankingCustomFromChange?: (value: string) => void
  onRankingCustomToChange?: (value: string) => void
  showRankingSummary?: boolean
}

interface MetricCellProps {
  field: InfluencerMetricBestField
  record: InfluencerContractRow
  bests: InfluencerMetricBests | null
  className?: string
  children: ReactNode
}

interface RankCellProps {
  rankInfo?: InfluencerContractRanking
}

interface InfluencerIdentityProps {
  influencer?: InfluencerPerformanceProfile
  onClick?: () => void
}

interface ContractDatesCellProps {
  record: InfluencerContractRow
}

const CLOSED_ROW_MENU: RowMenuState = { openId: null, menuStyle: null }

/** Pointer targets can be Text nodes (no .closest); normalize to an Element. */
function pointerTargetElement(event: { target: EventTarget | null }): Element | null {
  const t = event.target
  if (t instanceof Element) return t
  if (t instanceof Node) return t.parentElement
  return null
}

function tableColumns(showNetProfitColumn: boolean): Array<[TableColumnKey, string]> {
  const cols: Array<[TableColumnKey, string]> = [
    ['date', 'Contract Dates'],
    ['influencer', 'Influencer'],
    ['cost', 'Cost'],
    ['views', 'Views'],
    ['likes', 'Likes'],
    ['comments', 'Comments'],
    ['shares', 'Shares'],
    ['salesAed', 'Sales (AED)'],
  ]
  if (showNetProfitColumn) cols.push(['netProfitAed', 'Net Profit (AED)'])
  return [['rank', '#'], ...cols]
}

function metricColumnKeySet(showNetProfitColumn: boolean): Set<string> {
  const keys: string[] = ['rank', 'cost', 'views', 'likes', 'comments', 'shares', 'salesAed']
  if (showNetProfitColumn) keys.push('netProfitAed')
  return new Set(keys)
}

function thClass(key: string, sort: InfluencerPerformanceSort, metricKeys: Set<string>) {
  const sortKey = sort?.key
  const isSorted = sortKey === key
  return [
    isSorted ? 'sorted' : '',
    metricKeys.has(key) ? 'ip-table__col--metric' : '',
    AMOUNT_COLUMN_KEYS.has(key as InfluencerMetricBestField) ? 'ip-table__col--amount' : '',
  ].filter(Boolean).join(' ')
}

function MetricCell({ field, record, bests, className = '', children }: MetricCellProps) {
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

function sortIndicator(sort: InfluencerPerformanceSort, key: string) {
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? '↑' : '↓'
}

function RankingMetricIcon({ metric, size = 14 }: { metric: TableColumnKey; size?: number }) {
  const props = { size, strokeWidth: 2, 'aria-hidden': true as const }
  switch (metric) {
    case 'date': return <CalendarDays {...props} />
    case 'influencer': return <Camera {...props} />
    case 'cost': return <WalletCards {...props} />
    case 'views': return <Eye {...props} />
    case 'likes': return <Heart {...props} />
    case 'comments': return <MessageSquare {...props} />
    case 'shares': return <Send {...props} />
    case 'salesAed': return <ShoppingBag {...props} />
    case 'netProfitAed': return <TrendingUp {...props} />
    default: return null
  }
}

function RankCell({ rankInfo }: RankCellProps) {
  if (!rankInfo) {
    return <td className="ip-table__col--metric ip-table__col--rank"><span className="ip-table__rank-muted">—</span></td>
  }
  const { rank } = rankInfo
  if (rank === 1) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--gold" title="1st place (net profit)">
          <Crown size={14} strokeWidth={2.2} aria-hidden />
          <span>#{rank}</span>
        </span>
      </td>
    )
  }
  if (rank === 2) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--silver" title="2nd place (net profit)">
          <Medal size={14} strokeWidth={2.2} aria-hidden />
          <span>#{rank}</span>
        </span>
      </td>
    )
  }
  if (rank === 3) {
    return (
      <td className="ip-table__col--metric ip-table__col--rank">
        <span className="ip-table__rank-pill ip-table__rank-pill--bronze" title="3rd place (net profit)">
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

function InfluencerIdentity({ influencer, onClick }: InfluencerIdentityProps) {
  const name = influencer?.name || 'Unknown'
  const content = (
    <>
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
    </>
  )
  if (!onClick || !influencer?.id) {
    return <div className="ip-table__influencer-cell">{content}</div>
  }
  return (
    <button type="button" className="ip-table__influencer-cell ip-table__influencer-cell--link" onClick={(event) => {
      event.stopPropagation()
      onClick()
    }}>
      {content}
    </button>
  )
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function compactContractDateRange(start: string | undefined, end: string | undefined) {
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

function ContractDatesCell({ record }: ContractDatesCellProps) {
  const start = record.startDate || record.contractStartDate || record.date || '—'
  const latest = record.latestDate || record.latest?.date || start
  const dateText = compactContractDateRange(start, latest)
  const dayText = `${record.recordedDays || 0} of ${record.monitoringDays || 5} check-ins`
  return (
    <td className="ip-table__col--dates">
      <div className="ip-table__contract-dates">
        <strong>{dateText}</strong>
        <span>{dayText}</span>
      </div>
    </td>
  )
}

function RankingTableColgroup({ showNetProfitColumn }: { showNetProfitColumn: boolean }) {
  return (
    <colgroup>
      <col className="ip-table__col-rank" />
      <col className="ip-table__col-dates" />
      <col className="ip-table__col-influencer" />
      <col className="ip-table__col-cost" />
      <col className="ip-table__col-metric-sm" />
      <col className="ip-table__col-metric-sm" />
      <col className="ip-table__col-metric-md" />
      <col className="ip-table__col-metric-sm" />
      <col className="ip-table__col-sales" />
      {showNetProfitColumn ? <col className="ip-table__col-metric-net" /> : null}
      <col className="ip-table__col-actions" />
    </colgroup>
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
  onInfluencerClick,
  headerAction,
  activeMonitorInfluencerId,
  onToggleMonitor,
  datePreset = 'all_time',
  onDatePresetChange,
  rankingCustomFrom = '',
  rankingCustomTo = '',
  onRankingCustomFromChange,
  onRankingCustomToChange,
  showRankingSummary = false,
}: InfluencerPerformanceTableProps) {
  const [rowMenu, setRowMenu] = useState<RowMenuState>(CLOSED_ROW_MENU)

  useEffect(() => {
    if (!rowMenu.openId) return undefined
    const openId = rowMenu.openId
    const onDocPointerDown = (event: PointerEvent) => {
      const t = pointerTargetElement(event)
      // Dropdown is portaled to document.body; it is not under .ip-table__row-menu in the DOM.
      if (t?.closest('.ip-table__row-menu-dropdown')) return
      const menu = t?.closest('.ip-table__row-menu')
      if (!menu || menu.getAttribute('data-record-id') !== String(openId)) {
        setRowMenu(CLOSED_ROW_MENU)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
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

  function toggleActionMenu(event: MouseEvent<HTMLButtonElement>, recordId: string | number) {
    const trigger = event.currentTarget
    if (!trigger || !(trigger instanceof Element)) {
      setRowMenu(CLOSED_ROW_MENU)
      return
    }

    if (String(rowMenu.openId) === String(recordId)) {
      setRowMenu(CLOSED_ROW_MENU)
      return
    }

    const rect = trigger.getBoundingClientRect()
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
    setRowMenu({
      openId: recordId,
      menuStyle: { top: `${top}px`, left: `${left}px`, minWidth: `${menuWidth}px` },
    })
  }

  const columns = useMemo(() => tableColumns(showNetProfitColumn), [showNetProfitColumn])
  const metricKeys = useMemo(() => metricColumnKeySet(showNetProfitColumn), [showNetProfitColumn])
  const bests = useMetricBests(records, showNetProfitColumn)
  const rankingTotals = useMemo(
    () => (showRankingSummary ? sumPerformanceRankingTotals(records) : null),
    [records, showRankingSummary],
  )

  const openMenuRecord = useMemo(
    () => (rowMenu.openId ? records.find((r) => String(r.id) === String(rowMenu.openId)) : null),
    [records, rowMenu.openId],
  )

  const rowMenuPortal = useMemo(() => {
    if (!openMenuRecord || typeof document === 'undefined') return null
    const influencerId = String(openMenuRecord.influencerId || '')
    const isMonitorActive =
      String(activeMonitorInfluencerId) === String(openMenuRecord.id) ||
      String(activeMonitorInfluencerId) === influencerId
    return createPortal(
      <div className="ip-table__row-menu-dropdown" role="menu" style={rowMenu.menuStyle || undefined}>
        <button
          type="button"
          className="ip-table__row-menu-item"
          role="menuitem"
          onClick={() => {
            onToggleMonitor(openMenuRecord.influencerId, openMenuRecord)
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
              onEdit(openMenuRecord)
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
              onDelete(openMenuRecord.id)
              setRowMenu(CLOSED_ROW_MENU)
            }}
          >
            <Trash2 size={15} aria-hidden /> Delete
          </button>
        ) : null}
      </div>,
      document.body,
    )
  }, [openMenuRecord, rowMenu.menuStyle, onToggleMonitor, onEdit, onDelete, activeMonitorInfluencerId])

  return (
    <section className="ip-table-card">
      <div className="ip-section-heading ip-table-card__heading">
        <div className="ip-table-card__heading-copy">
          <span className="ip-section-heading__icon ip-table-card__instagram-icon"><Camera size={19} /></span>
          <div>
            <h2>Influencers Performance Ranking</h2>
            <p>Track and compare influencer campaign performance.</p>
          </div>
        </div>
        <div className="ip-table-card__heading-toolbar">
          <div className="ip-table-card__heading-filters ip-ranking-date-filters" role="group" aria-label="Filter ranking by time period">
            <div className="ip-ranking-date-filters__presets">
              {PERFORMANCE_RANKING_DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`inf-chip ${datePreset === preset.id ? 'inf-chip--active' : ''}`}
                  onClick={() => onDatePresetChange?.(preset.id)}
                >
                  {preset.id === 'custom' ? <CalendarDays size={13} aria-hidden /> : null}
                  {preset.label}
                </button>
              ))}
            </div>
            {datePreset === 'custom' ? (
              <div className="ip-ranking-date-filters__custom">
                <label className="ip-field ip-field--inline">
                  <span>From</span>
                  <input
                    className="ip-control"
                    type="date"
                    value={rankingCustomFrom}
                    onChange={(e) => onRankingCustomFromChange?.(e.target.value)}
                  />
                </label>
                <label className="ip-field ip-field--inline">
                  <span>To</span>
                  <input
                    className="ip-control"
                    type="date"
                    value={rankingCustomTo}
                    onChange={(e) => onRankingCustomToChange?.(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
          {headerAction ? <div className="ip-table-card__heading-action">{headerAction}</div> : null}
        </div>
      </div>

      {showRankingSummary && rankingTotals ? (
        <div className="ip-ranking-totals" aria-label="Ranking totals for visible rows">
          <div className="ip-ranking-totals__item" data-metric="cost">
            <span className="ip-ranking-totals__icon"><WalletCards size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Cost</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.cost, { currency: 'AED' })}</strong>
            </span>
          </div>
          <div className="ip-ranking-totals__item" data-metric="views">
            <span className="ip-ranking-totals__icon"><Eye size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Views</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.views)}</strong>
            </span>
          </div>
          <div className="ip-ranking-totals__item" data-metric="likes">
            <span className="ip-ranking-totals__icon"><Heart size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Likes</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.likes)}</strong>
            </span>
          </div>
          <div className="ip-ranking-totals__item" data-metric="comments">
            <span className="ip-ranking-totals__icon"><MessageSquare size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Comments</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.comments)}</strong>
            </span>
          </div>
          <div className="ip-ranking-totals__item" data-metric="shares">
            <span className="ip-ranking-totals__icon"><Send size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Shares</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.shares)}</strong>
            </span>
          </div>
          <div className="ip-ranking-totals__item" data-metric="sales">
            <span className="ip-ranking-totals__icon"><ShoppingBag size={18} aria-hidden /></span>
            <span className="ip-ranking-totals__copy">
              <span className="ip-ranking-totals__label">Total Sales</span>
              <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.salesAed, { currency: 'AED' })}</strong>
            </span>
          </div>
          {showNetProfitColumn ? (
            <div className="ip-ranking-totals__item" data-metric="profit">
              <span className="ip-ranking-totals__icon"><TrendingUp size={18} aria-hidden /></span>
              <span className="ip-ranking-totals__copy">
                <span className="ip-ranking-totals__label">Total Net Profit</span>
                <strong className="ip-ranking-totals__value">{formatNumber(rankingTotals.netProfitAed, { currency: 'AED' })}</strong>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="inf-table-wrap ip-table-wrap">
        <table className="inf-table ip-table">
          <RankingTableColgroup showNetProfitColumn={showNetProfitColumn} />
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  data-col={key}
                  className={thClass(key, sort, metricKeys)}
                  onClick={() => onSort(key)}
                >
                  <span className="ip-table__header-content">
                    <span className="ip-table__header-icon"><RankingMetricIcon metric={key} /></span>
                    <span>{label}</span>
                    {sortIndicator(sort, key) ? <span className="ip-table__sort-indicator">{sortIndicator(sort, key)}</span> : null}
                  </span>
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
                    <InfluencerIdentity
                      influencer={influencer}
                      onClick={onInfluencerClick && influencerId ? () => onInfluencerClick(influencerId) : undefined}
                    />
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
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {showRankingSummary && rankingTotals && records.length > 0 ? (
            <tfoot>
              <tr className="ip-table__total-row">
                <td className="ip-table__col--metric ip-table__col--rank"><strong>TOTAL</strong></td>
                <td />
                <td />
                <td className="ip-table__col--metric ip-table__col--amount"><strong>{formatNumber(rankingTotals.cost, { currency: 'AED' })}</strong></td>
                <td className="ip-table__col--metric"><strong>{formatNumber(rankingTotals.views)}</strong></td>
                <td className="ip-table__col--metric"><strong>{formatNumber(rankingTotals.likes)}</strong></td>
                <td className="ip-table__col--metric"><strong>{formatNumber(rankingTotals.comments)}</strong></td>
                <td className="ip-table__col--metric"><strong>{formatNumber(rankingTotals.shares)}</strong></td>
                <td className="ip-table__col--metric ip-table__col--amount"><strong>{formatNumber(rankingTotals.salesAed, { currency: 'AED' })}</strong></td>
                {showNetProfitColumn ? (
                  <td className="ip-table__col--metric ip-table__col--amount ip-table__col--netprofit">
                    <strong>{formatNumber(rankingTotals.netProfitAed, { currency: 'AED' })}</strong>
                  </td>
                ) : null}
                <td className="ip-table__col--actions ip-table__col--actions-compact" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {rowMenuPortal}
    </section>
  )
}
