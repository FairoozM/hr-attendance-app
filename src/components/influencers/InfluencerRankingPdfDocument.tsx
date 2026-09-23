import { forwardRef, useMemo, type ReactNode } from 'react'
import {
  BadgeDollarSign,
  Camera,
  CalendarDays,
  Crown,
  Eye,
  Heart,
  Medal,
  MessageSquare,
  Send,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerContractRanking,
  InfluencerContractRow,
  InfluencerMetricBestField,
  InfluencerMetricBests,
  InfluencerPerformanceProfile,
} from '../../types/influencer'
import {
  EMPTY_RANK_MAP,
  influencerInitials,
  useMetricBests,
  winnerPillMod,
} from './influencerPerformanceTableShared'
import {
  contractDatesCellText,
  sumPerformanceRankingTotals,
} from '../../pages/influencers/influencerPerformanceRankingUtils'
import { RANKING_PDF_DOC_WIDTH } from './rankingPdfExport'
import './InfluencerRankingPdfDocument.css'

/**
 * Print-only rendering of the ranking totals + table, laid out so html2canvas
 * rasterizes it faithfully: fixed width, `line-height: normal`, inline-block pills,
 * table cells for vertical centering, and JS truncation instead of CSS ellipsis.
 * Rendered off-screen for the duration of a PDF export; never shown in the UI.
 */

export interface InfluencerRankingPdfDocumentProps {
  records: InfluencerContractRow[]
  influencersById: Map<string, InfluencerPerformanceProfile>
  rankingsByContractId?: Map<string, InfluencerContractRanking>
  showNetProfitColumn: boolean
}

type MetricColumn = {
  field: InfluencerMetricBestField
  label: string
  icon: ReactNode
  amount: boolean
  className: string
}

const ICON = { size: 13, strokeWidth: 2.2, 'aria-hidden': true as const }

const METRIC_COLUMNS: MetricColumn[] = [
  { field: 'cost', label: 'Cost', icon: <BadgeDollarSign {...ICON} />, amount: true, className: 'rpd-col-cost' },
  { field: 'views', label: 'Views', icon: <Eye {...ICON} />, amount: false, className: 'rpd-col-metric' },
  { field: 'likes', label: 'Likes', icon: <Heart {...ICON} />, amount: false, className: 'rpd-col-metric' },
  { field: 'comments', label: 'Comments', icon: <MessageSquare {...ICON} />, amount: false, className: 'rpd-col-metric-md' },
  { field: 'shares', label: 'Shares', icon: <Send {...ICON} />, amount: false, className: 'rpd-col-metric' },
  { field: 'salesAed', label: 'Sales (AED)', icon: <ShoppingBag {...ICON} />, amount: true, className: 'rpd-col-sales' },
  { field: 'netProfitAed', label: 'Net Profit (AED)', icon: <TrendingUp {...ICON} />, amount: true, className: 'rpd-col-net' },
]

const MAX_NAME_CHARS = 26
const MAX_USERNAME_CHARS = 28

function truncate(value: string, max: number) {
  const text = value.trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function formatMetric(field: InfluencerMetricBestField, value: unknown) {
  return field === 'cost' || field === 'salesAed' || field === 'netProfitAed'
    ? formatNumber(value, { currency: 'AED' })
    : formatNumber(value)
}

/**
 * Capsule highlight. html2canvas draws text inside inline-block boxes too low, but
 * positions text inside table cells correctly, so the pill is an inline table whose
 * single cell vertically centres its content.
 */
function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`rpd-pill ${className}`}>
      <span className="rpd-pill__cell">{children}</span>
    </span>
  )
}

function RankPill({ rankInfo }: { rankInfo?: InfluencerContractRanking }) {
  if (!rankInfo) return <span className="rpd-rank-muted">—</span>
  const { rank } = rankInfo
  if (rank > 3) return <span className="rpd-rank-muted">#{rank}</span>
  const tone = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze'
  const Icon = rank === 1 ? Crown : Medal
  return (
    <Pill className={`rpd-rank-pill rpd-rank-pill--${tone}`}>
      <span className="rpd-rank-pill__icon"><Icon size={13} strokeWidth={2.3} aria-hidden /></span>
      <span className="rpd-rank-pill__text">#{rank}</span>
    </Pill>
  )
}

function MetricValue({
  field,
  record,
  bests,
}: {
  field: InfluencerMetricBestField
  record: InfluencerContractRow
  bests: InfluencerMetricBests | null
}) {
  const text = formatMetric(field, record[field])
  const mod = winnerPillMod(field, record, bests)
  if (!mod) return <>{text}</>
  return <Pill className={`rpd-winner-pill rpd-winner-pill--${mod}`}>{text}</Pill>
}

function TotalsBadge({
  metric,
  label,
  value,
  icon,
}: {
  metric: string
  label: string
  value: string
  icon: ReactNode
}) {
  return (
    <td className="rpd-totals__cell">
      <div className="rpd-badge" data-metric={metric}>
        <span className="rpd-badge__icon"><span className="rpd-badge__glyph">{icon}</span></span>
        <div className="rpd-badge__copy">
          <div className="rpd-badge__label">{label}</div>
          <div className="rpd-badge__value">{value}</div>
        </div>
      </div>
    </td>
  )
}

export const InfluencerRankingPdfDocument = forwardRef<HTMLDivElement, InfluencerRankingPdfDocumentProps>(
  function InfluencerRankingPdfDocument(
    { records, influencersById, rankingsByContractId = EMPTY_RANK_MAP, showNetProfitColumn },
    ref,
  ) {
    const bests = useMetricBests(records, showNetProfitColumn)
    const totals = useMemo(() => sumPerformanceRankingTotals(records), [records])
    const columns = useMemo(
      () => METRIC_COLUMNS.filter((c) => showNetProfitColumn || c.field !== 'netProfitAed'),
      [showNetProfitColumn],
    )
    const badgeIcon = { size: 16, strokeWidth: 2.1, 'aria-hidden': true as const }

    return (
      <div ref={ref} className="rpd-root" style={{ width: RANKING_PDF_DOC_WIDTH }}>
        <table className="rpd-totals">
          <tbody>
            <tr>
              <TotalsBadge metric="views" label="Total Views" value={formatNumber(totals.views)} icon={<Eye {...badgeIcon} />} />
              <TotalsBadge metric="likes" label="Total Likes" value={formatNumber(totals.likes)} icon={<Heart {...badgeIcon} />} />
              <TotalsBadge metric="comments" label="Total Comments" value={formatNumber(totals.comments)} icon={<MessageSquare {...badgeIcon} />} />
              <TotalsBadge metric="shares" label="Total Shares" value={formatNumber(totals.shares)} icon={<Send {...badgeIcon} />} />
              <TotalsBadge metric="cost" label="Total Influencer Cost" value={formatNumber(totals.cost, { currency: 'AED' })} icon={<BadgeDollarSign {...badgeIcon} />} />
              <TotalsBadge metric="sales" label="Total Sales" value={formatNumber(totals.salesAed, { currency: 'AED' })} icon={<ShoppingBag {...badgeIcon} />} />
              {showNetProfitColumn ? (
                <TotalsBadge metric="profit" label="Total Net Profit" value={formatNumber(totals.netProfitAed, { currency: 'AED' })} icon={<TrendingUp {...badgeIcon} />} />
              ) : null}
            </tr>
          </tbody>
        </table>

        <div className="rpd-table-wrap">
          <table className="rpd-table">
            <colgroup>
              <col className="rpd-col-rank" />
              <col className="rpd-col-dates" />
              <col className="rpd-col-influencer" />
              {columns.map((c) => <col key={c.field} className={c.className} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="rpd-th">#</th>
                <th className="rpd-th rpd-th--left">
                  <CalendarDays {...ICON} className="rpd-th__icon" />
                  <span className="rpd-th__label">Contract Dates</span>
                </th>
                <th className="rpd-th rpd-th--left">
                  <Camera {...ICON} className="rpd-th__icon" />
                  <span className="rpd-th__label">Influencer</span>
                </th>
                {columns.map((c) => (
                  <th key={c.field} className={`rpd-th ${c.amount ? 'rpd-th--right' : ''}`}>
                    <span className="rpd-th__icon">{c.icon}</span>
                    <span className="rpd-th__label">{c.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const influencer = influencersById.get(String(record.influencerId || ''))
                const name = influencer?.name || 'Unknown'
                const username = influencer?.username?.trim() || '—'
                const { dateText, dayText } = contractDatesCellText(record)
                return (
                  <tr key={record.id}>
                    <td className="rpd-td rpd-td--rank"><RankPill rankInfo={rankingsByContractId.get(record.id)} /></td>
                    <td className="rpd-td rpd-td--left">
                      <div className="rpd-dates__range">{dateText}</div>
                      <div className="rpd-dates__days">{dayText}</div>
                    </td>
                    <td className="rpd-td rpd-td--left">
                      <span className="rpd-avatar">
                        <span className="rpd-avatar__initials">{influencerInitials(name)}</span>
                        {influencer?.profileImage ? (
                          <img
                            className="rpd-avatar__img"
                            src={influencer.profileImage}
                            alt=""
                            onError={(event) => { event.currentTarget.remove() }}
                          />
                        ) : null}
                      </span>
                      <span className="rpd-identity">
                        <div className="rpd-identity__name">{truncate(name, MAX_NAME_CHARS)}</div>
                        <div className="rpd-identity__handle">{truncate(username, MAX_USERNAME_CHARS)}</div>
                      </span>
                    </td>
                    {columns.map((c) => (
                      <td key={c.field} className={`rpd-td ${c.amount ? 'rpd-td--right' : ''}`}>
                        <MetricValue field={c.field} record={record} bests={bests} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="rpd-total-row">
                <td className="rpd-td rpd-td--total-label">TOTAL</td>
                <td className="rpd-td" />
                <td className="rpd-td" />
                {columns.map((c) => (
                  <td key={c.field} className={`rpd-td rpd-td--total ${c.amount ? 'rpd-td--right' : ''}`}>
                    {formatMetric(c.field, totals[c.field])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  },
)
