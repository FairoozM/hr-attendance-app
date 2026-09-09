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
  quantity: number
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
  orders: ReportOrder[]
  summary: {
    quantity: number
    salesAmountAED: number
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number
    shippingAED: number
    costPercentage: number | null
    balanceAED: number
    tabbyTamaraCommissionAED?: number
    smilePointCouponAED?: number
  }
  warnings?: string[]
}

interface DailyReport {
  date: string
  timezone: string
  exchangeRate: { rate: number; rateDisplay?: string; source: string }
  channels: ChannelReport[]
  totals: {
    quantity: number
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number
    shippingAED: number
    costPercentage: number | null
    salesAmountAED: number
    balanceAED: number
    generalEcommerceCostsStatus?: string
  }
  incomplete: boolean
  amazonAdsExcluded?: boolean
  warnings: string[]
  generatedAt: string
  sources?: Record<string, unknown>
}

function adsCell(status: IntegrationStatus | undefined, value: number | null | undefined, kind: 'money' | 'int') {
  if (status === 'not_configured' || value == null) {
    return <span className="der-na">Not Configured</span>
  }
  if (status === 'unavailable') return <span className="der-na">Unavailable</span>
  return kind === 'int' ? formatInt(value) : formatMoney(value)
}

function flattenOrders(channel: ChannelReport) {
  if (channel.integrationStatus === 'not_configured') {
    return [{ order: 'Not Configured', sku: '', qty: '' as const }]
  }
  if (channel.integrationStatus === 'unavailable') {
    return [{ order: 'Data Error', sku: '', qty: '' as const }]
  }
  const lines: Array<{ order: string; sku: string; qty: number | '' }> = []
  for (const order of channel.orders || []) {
    const items = order.items?.length ? order.items : [{ sku: '', quantity: 0 }]
    items.forEach((item, i) => {
      lines.push({
        order: i === 0 ? order.orderNumber : '',
        sku: item.sku || '',
        qty: item.quantity || 0,
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
  if (ch.family === 'life_smile') {
    return [
      { label: 'Website Qty', node: formatInt(s.quantity) },
      { label: 'FB/Instagram Ads', node: adsCell(ads, s.adSpendAED, 'money') },
      { label: 'Website Clicks', node: adsCell(ads, s.clicks, 'int'), title: 'Metric: link_clicks when Meta is connected' },
      { label: 'Tabby & Tamara Commission', node: formatMoney(s.tabbyTamaraCommissionAED || 0) },
      { label: 'Smile Point & Coupon', node: formatMoney(s.smilePointCouponAED || 0) },
      { label: 'Website Shipping', node: formatMoney(s.shippingAED) },
      { label: 'Website Cost %', node: formatPct(s.costPercentage) },
      { label: 'Website Amount', node: formatMoney(s.salesAmountAED) },
      { label: 'Website Balance', node: formatMoney(s.balanceAED), neg: (s.balanceAED || 0) < 0 },
    ]
  }
  const p = ch.family === 'amazon' ? 'Amazon' : ch.family === 'noon' ? 'Noon' : 'Carrefour'
  return [
    { label: `${p} Qty`, node: formatInt(s.quantity) },
    { label: `${p} Ads`, node: adsCell(ads, s.adSpendAED, 'money') },
    { label: `${p} Clicks`, node: adsCell(ads, s.clicks, 'int') },
    { label: `${p} Commission`, node: formatMoney(s.commissionAED) },
    { label: `${p} Shipping`, node: formatMoney(s.shippingAED) },
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

  useEffect(() => {
    void load(date)
  }, [date, load])

  const onRefresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      // Rebuild from stored Zoho + website data only (no hanging Amazon SP sync)
      const data = await api.post('/api/reports/daily-ecommerce/refresh', {
        date,
        sync_amazon: 0,
      })
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
  const rateDisplay =
    report?.exchangeRate?.rateDisplay ||
    (report?.exchangeRate?.rate != null ? Number(report.exchangeRate.rate).toFixed(4) : null)

  return (
    <div className="der-page">
      <div className="der-top">
        <div>
          <h1 className="der-title">Daily Ecommerce Report</h1>
          <p className="der-date-banner" aria-live="polite">
            {report?.date || date}
          </p>
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
          <button type="button" className="war-btn war-btn--ghost war-btn--sm" disabled={loading || refreshing} onClick={() => void onRefresh()}>
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
          One or more order sources returned a Data Error. Ads marked Not Configured do not make the report incomplete.
        </div>
      )}
      {report?.amazonAdsExcluded && (
        <p className="der-footnote">Amazon advertising is Not Configured and is excluded from cost calculations.</p>
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
                  <FragmentHeads key={`${ch.channel}-cols`} />
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxLines }, (_, i) => (
                <tr key={`o-${i}`}>
                  {lineSets.map((lines, ci) => {
                    const line = lines[i] || { order: '', sku: '', qty: '' as const }
                    return (
                      <FragmentOrder key={`${ci}-${i}`} order={line.order} sku={line.sku} qty={line.qty} />
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
                      <FragmentSum
                        key={`${ci}-sum-${i}`}
                        label={row.label}
                        value={row.node}
                        neg={row.neg}
                        title={row.title}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="der-totals-head">
                <td colSpan={18}>Consolidated totals</td>
              </tr>
              {(
                [
                  ['Total Qty', formatInt(report.totals.quantity)],
                  [
                    'Total Ads',
                    report.totals.adSpendAED == null ? (
                      <span className="der-na">Not Configured</span>
                    ) : (
                      formatMoney(report.totals.adSpendAED)
                    ),
                  ],
                  [
                    'Total Clicks',
                    report.totals.clicks == null ? (
                      <span className="der-na">Not Configured</span>
                    ) : (
                      formatInt(report.totals.clicks)
                    ),
                  ],
                  ['Total Commission', formatMoney(report.totals.commissionAED)],
                  ['Total Shipping', formatMoney(report.totals.shippingAED)],
                  ['Total Cost %', formatPct(report.totals.costPercentage)],
                  ['General Ecommerce', <span className="der-na">Not Configured</span>],
                  ['Total Amount', formatMoney(report.totals.salesAmountAED)],
                  ['Total Balance', formatMoney(report.totals.balanceAED)],
                ] as Array<[string, ReactNode]>
              ).map(([label, value]) => (
                <tr key={label} className="der-totals-row">
                  <td colSpan={2} className="der-sum-label">
                    {label}
                  </td>
                  <td className="der-num">{value}</td>
                  <td colSpan={15} />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function FragmentHeads() {
  return (
    <>
      <th className="der-col">Order</th>
      <th className="der-col">Item Code</th>
      <th className="der-col der-num">Qty</th>
    </>
  )
}

function FragmentOrder({
  order,
  sku,
  qty,
}: {
  order: string
  sku: string
  qty: number | ''
}) {
  return (
    <>
      <td className="der-order">{order}</td>
      <td className="der-sku">{sku}</td>
      <td className="der-num">{qty === '' ? '' : formatInt(qty)}</td>
    </>
  )
}

function FragmentSum({
  label,
  value,
  neg,
  title,
}: {
  label: string
  value: ReactNode
  neg?: boolean
  title?: string
}) {
  return (
    <>
      <td colSpan={2} className="der-sum-label" title={title}>
        {label}
      </td>
      <td className={`der-num${neg ? ' der-neg' : ''}`}>{value}</td>
    </>
  )
}
