/**
 * Daily Ecommerce Report — compact side-by-side channel spreadsheet layout.
 * Route: /#/reports/daily-ecommerce
 */

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, fetchBinary, downloadBlob } from '../../api/client'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import './DailyEcommerceReportPage.css'
import './WeeklyAdsReportPage.css'

const IANA_UAE = 'Asia/Dubai'

function todayUaeYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IANA_UAE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function addDaysYmd(dateYmd: string, delta: number) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const noon = new Date(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+04:00`,
  )
  return todayUaeYmd(new Date(noon.getTime() + delta * 86400000))
}

function formatMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatInt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString('en-US')
}

function formatPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '0%'
  return `${Number(n).toFixed(2)}%`
}

type IntegrationStatus = 'available' | 'not_configured' | 'unavailable' | 'pending'

interface ReportItem {
  sku: string
  quantity: number | null
}

interface ReportOrder {
  orderNumber: string
  items: ReportItem[]
}

interface ChannelReport {
  channel: string
  label: string
  family: string
  country: string
  integrationStatus: IntegrationStatus
  adsStatus?: IntegrationStatus
  dataSource?: string
  orders: ReportOrder[]
  summary: {
    quantity: number | null
    salesAmountAED: number
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number | null
    shippingAED: number | null
    costPercentage: number | null
    balanceAED: number
    tabbyTamaraCommissionAED?: number | null
    smilePointCouponAED?: number | null
  }
  warnings?: string[]
}

interface DailyReport {
  date: string
  timezone: string
  exchangeRate: { rate: number; rateDisplay?: string; source: string }
  channels: ChannelReport[]
  totals: {
    quantity: number | null
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number | null
    shippingAED: number | null
    costPercentage: number | null
    salesAmountAED: number
    balanceAED: number
  }
  incomplete: boolean
  amazonAdsExcluded?: boolean
  warnings: string[]
  generatedAt: string
  sources?: Record<string, unknown>
}

function naNode(text: string) {
  return <span className="der-na">{text}</span>
}

function adsCell(status: IntegrationStatus | undefined, value: number | null | undefined, kind: 'money' | 'int') {
  if (status === 'unavailable') return naNode('Data Error')
  if (status === 'not_configured' || value == null) return naNode('Not Configured')
  return kind === 'int' ? formatInt(value) : formatMoney(value)
}

/** Marketplace has not reported this cost for the day yet. */
function costCell(value: number | null | undefined) {
  if (value == null) return naNode('Pending')
  return formatMoney(value)
}

function qtyCell(value: number | null | undefined) {
  if (value == null) return naNode('N/A')
  return formatInt(value)
}

function statusPlaceholder(channel: ChannelReport) {
  if (channel.integrationStatus === 'not_configured') return 'Not Configured'
  if (channel.integrationStatus === 'unavailable') return 'Data Error'
  if (channel.integrationStatus === 'pending') return 'Pending'
  return null
}

type OrderLine = { order: string; sku: string; qty: number | null | '' }

function flattenOrders(channel: ChannelReport): OrderLine[] {
  const placeholder = statusPlaceholder(channel)
  if (placeholder) return [{ order: placeholder, sku: '', qty: '' }]
  const lines: OrderLine[] = []
  for (const order of channel.orders || []) {
    const items = order.items?.length ? order.items : [{ sku: '', quantity: 0 }]
    items.forEach((item, i) => {
      lines.push({
        order: i === 0 ? order.orderNumber : '',
        sku: item.sku || '',
        qty: item.quantity ?? null,
      })
    })
  }
  if (!lines.length) lines.push({ order: 'No orders', sku: '', qty: '' })
  return lines
}

type SummaryRow = { label: string; node: ReactNode; neg?: boolean; title?: string }

function summaryRows(ch: ChannelReport): SummaryRow[] {
  const s = ch.summary
  const ads = ch.adsStatus
  const placeholder = statusPlaceholder(ch)
  if (placeholder) {
    // A channel with no data must not print zeros for money or quantity
    const p = ch.family === 'amazon' ? 'Amazon' : ch.family === 'noon' ? 'Noon' : 'Website'
    return ['Qty', 'Ads', 'Clicks', 'Commission', 'Shipping', 'Cost %', 'Amount', 'Balance'].map(
      (metric) => ({ label: `${p} ${metric}`, node: naNode(placeholder) }),
    )
  }
  if (ch.family === 'life_smile') {
    return [
      { label: 'Website Qty', node: qtyCell(s.quantity) },
      { label: 'FB/Instagram Ads', node: adsCell(ads, s.adSpendAED, 'money') },
      { label: 'Website Clicks', node: adsCell(ads, s.clicks, 'int') },
      { label: 'Tabby & Tamara Commission', node: costCell(s.tabbyTamaraCommissionAED ?? null) },
      { label: 'Smile Point & Coupon', node: formatMoney(s.smilePointCouponAED || 0) },
      { label: 'Website Shipping', node: costCell(s.shippingAED) },
      { label: 'Website Cost %', node: formatPct(s.costPercentage) },
      { label: 'Website Amount', node: formatMoney(s.salesAmountAED) },
      { label: 'Website Balance', node: formatMoney(s.balanceAED), neg: (s.balanceAED || 0) < 0 },
    ]
  }
  const p = ch.family === 'amazon' ? 'Amazon' : 'Noon'
  return [
    { label: `${p} Qty`, node: qtyCell(s.quantity) },
    { label: `${p} Ads`, node: adsCell(ads, s.adSpendAED, 'money') },
    { label: `${p} Clicks`, node: adsCell(ads, s.clicks, 'int') },
    { label: `${p} Commission`, node: costCell(s.commissionAED) },
    { label: `${p} Shipping`, node: costCell(s.shippingAED) },
    { label: `${p} Cost %`, node: formatPct(s.costPercentage) },
    { label: `${p} Amount`, node: formatMoney(s.salesAmountAED) },
    { label: `${p} Balance`, node: formatMoney(s.balanceAED), neg: (s.balanceAED || 0) < 0 },
  ]
}

export function DailyEcommerceReportPage() {
  const { user } = useAuth()
  const canExport = hasPermission(user, 'weekly_reports', 'export')
  const [date, setDate] = useState(() => todayUaeYmd())
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)

  const load = useCallback(async (ymd: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get(`/api/reports/daily-ecommerce?date=${encodeURIComponent(ymd)}`)
      setReport(data as DailyReport)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load report')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Reads stored marketplace-synced data only; never triggers external syncs on render
  useEffect(() => {
    void load(date)
  }, [date, load])

  const onRefresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const data = await api.post('/api/reports/daily-ecommerce/refresh', { date })
      const payload = data as { report?: DailyReport }
      if (payload.report) setReport(payload.report)
      else await load(date)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const onExport = async () => {
    if (!canExport) return
    setExporting(true)
    setError(null)
    try {
      const { blob, filename } = await fetchBinary(
        `/api/reports/daily-ecommerce/export.xlsx?date=${encodeURIComponent(date)}`,
      )
      downloadBlob(blob, filename || `daily-ecommerce-report-${date}.xlsx`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const channels = report?.channels || []
  const lineSets = channels.map(flattenOrders)
  const maxLines = Math.max(1, ...lineSets.map((l) => l.length))
  const summarySets = channels.map(summaryRows)
  const maxSummary = Math.max(0, ...summarySets.map((s) => s.length))
  const totalCols = Math.max(3, channels.length * 3)
  const rateDisplay =
    report?.exchangeRate?.rateDisplay ||
    (report?.exchangeRate?.rate != null ? Number(report.exchangeRate.rate).toFixed(4) : null)

  return (
    <div className="der-page">
      <div className="der-top">
        <div>
          <h1 className="der-title">Daily Ecommerce Report</h1>
          <p className="der-date-banner">{report?.date || date}</p>
          <p className="der-sub">
            {report?.timezone || IANA_UAE}
            {rateDisplay ? (
              <>
                {' · '}
                <span title={report?.exchangeRate?.source || 'SAR conversion'}>
                  SAR to AED: {rateDisplay}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="der-controls">
          <button type="button" className="war-btn war-btn--ghost war-btn--sm" onClick={() => setDate((d) => addDaysYmd(d, -1))}>
            Prev
          </button>
          <input
            type="date"
            className="war-input der-date"
            value={date}
            max={todayUaeYmd()}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            type="button"
            className="war-btn war-btn--ghost war-btn--sm"
            disabled={date >= todayUaeYmd()}
            onClick={() => setDate((d) => addDaysYmd(d, 1))}
          >
            Next
          </button>
          <button type="button" className="war-btn war-btn--ghost war-btn--sm" onClick={() => setDate(todayUaeYmd())}>
            Today
          </button>
          <button
            type="button"
            className="war-btn war-btn--ghost war-btn--sm"
            disabled={loading || refreshing}
            onClick={() => void onRefresh()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {canExport && (
            <button type="button" className="war-btn war-btn--primary war-btn--sm" disabled={loading || exporting || !report} onClick={() => void onExport()}>
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="der-banner der-banner--err" role="alert">
          {error}
        </div>
      )}
      {report?.incomplete && (
        <div className="der-banner der-banner--warn" role="status">
          One or more order sources returned a Data Error. Advertising marked Not Configured does not
          make the report incomplete.
        </div>
      )}
      {report && (
        <p className="der-footnote">
          {report.amazonAdsExcluded
            ? 'Amazon advertising is Not Configured and excluded from cost calculations. '
            : ''}
          <button type="button" className="der-link" onClick={() => setShowNotes((v) => !v)}>
            {showNotes ? 'Hide source notes' : `Source notes (${report.warnings.length})`}
          </button>
        </p>
      )}
      {showNotes && report && (
        <ul className="der-notes">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {loading && !report && <div className="der-loading">Loading…</div>}

      {report && (
        <div className="der-sheet-wrap">
          <table className="der-sheet">
            <thead>
              <tr>
                {channels.map((ch) => (
                  <th key={ch.channel} colSpan={3} className={`der-ch-head der-ch-head--${ch.channel}`}>
                    {ch.label}
                  </th>
                ))}
              </tr>
              <tr>
                {channels.map((ch) => (
                  <Fragment key={`${ch.channel}-cols`}>
                    <th className="der-col">Order</th>
                    <th className="der-col">Item Code</th>
                    <th className="der-col der-num">Qty</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxLines }, (_, i) => (
                <tr key={`o-${i}`}>
                  {lineSets.map((lines, ci) => {
                    const line = lines[i] || { order: '', sku: '', qty: '' as const }
                    return (
                      <Fragment key={`${ci}-${i}`}>
                        <td className="der-order">{line.order}</td>
                        <td className="der-sku">{line.sku}</td>
                        <td className="der-num">
                          {line.qty === '' ? '' : line.qty == null ? naNode('N/A') : formatInt(line.qty)}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
              {Array.from({ length: maxSummary }, (_, i) => (
                <tr key={`s-${i}`} className="der-sum-row">
                  {summarySets.map((rows, ci) => {
                    const row = rows[i]
                    if (!row) {
                      return (
                        <Fragment key={`${ci}-empty-${i}`}>
                          <td colSpan={2} />
                          <td />
                        </Fragment>
                      )
                    }
                    return (
                      <Fragment key={`${ci}-sum-${i}`}>
                        <td colSpan={2} className="der-sum-label" title={row.title}>
                          {row.label}
                        </td>
                        <td className={`der-num${row.neg ? ' der-neg' : ''}`}>{row.node}</td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="der-totals-head">
                <td colSpan={totalCols}>Consolidated totals</td>
              </tr>
              {(
                [
                  ['Total Qty', qtyCell(report.totals.quantity)],
                  ['Total Ads', report.totals.adSpendAED == null ? naNode('Not Configured') : formatMoney(report.totals.adSpendAED)],
                  ['Total Clicks', report.totals.clicks == null ? naNode('Not Configured') : formatInt(report.totals.clicks)],
                  ['Total Commission', costCell(report.totals.commissionAED)],
                  ['Total Shipping', costCell(report.totals.shippingAED)],
                  ['Total Cost %', formatPct(report.totals.costPercentage)],
                  ['General Ecommerce', naNode('Not Configured')],
                  ['Total Amount', formatMoney(report.totals.salesAmountAED)],
                  ['Total Balance', formatMoney(report.totals.balanceAED)],
                ] as Array<[string, ReactNode]>
              ).map(([label, value]) => (
                <tr key={label} className="der-totals-row">
                  <td colSpan={2} className="der-sum-label">
                    {label}
                  </td>
                  <td className="der-num">{value}</td>
                  <td colSpan={Math.max(1, totalCols - 3)} />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
