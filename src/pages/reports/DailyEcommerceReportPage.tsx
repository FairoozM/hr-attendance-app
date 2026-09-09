/**
 * Daily Ecommerce Report — channel order tables + financial summaries.
 * Route: /#/reports/daily-ecommerce
 */

import { useCallback, useEffect, useState } from 'react'
import { api, fetchBinary, downloadBlob } from '../../api/client'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import './DailyEcommerceReportPage.css'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'

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
  const noon = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+04:00`)
  const shifted = new Date(noon.getTime() + delta * 86400000)
  return todayUaeYmd(shifted)
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
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  return `${Number(n).toFixed(2)}%`
}

function formatSyncTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    timeZone: IANA_UAE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type IntegrationStatus = 'available' | 'not_configured' | 'unavailable' | 'pending'

interface ReportItem {
  sku: string
  quantity: number
  unitAmount?: number
  lineAmount?: number
}

interface ReportOrder {
  orderId: string
  orderNumber: string
  orderDate: string | null
  status: string
  items: ReportItem[]
  originalAmount?: number
  originalCurrency?: string
  amountAED: number
  commissionAED?: number
  shippingAED?: number
  discountAED?: number
  smilePointsAED?: number
  paymentMethod?: string
}

interface ChannelReport {
  channel: string
  label: string
  country: 'AE' | 'SA'
  currency: string
  integrationStatus: IntegrationStatus
  lastSyncedAt: string | null
  orders: ReportOrder[]
  summary: {
    orderCount: number
    quantity: number
    salesAmountAED: number
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number
    shippingAED: number
    paymentFeesAED: number
    otherIncludedCostsAED: number
    couponDiscountAED: number
    smilePointsAED: number
    totalIncludedCostsAED: number
    costPercentage: number | null
    balanceAED: number
  }
  adsStatus?: IntegrationStatus
  adsProvider?: string | null
  adsMetricLabel?: string | null
  warnings?: string[]
}

interface DailyReport {
  date: string
  timezone: string
  exchangeRate: {
    rate: number
    source: string
    configured: boolean
  }
  channels: ChannelReport[]
  totals: {
    quantity: number
    adSpendAED: number | null
    clicks: number | null
    commissionAED: number
    shippingAED: number
    paymentFeesAED: number
    otherIncludedCostsAED: number
    generalEcommerceCostsAED: number | null
    generalEcommerceCostsStatus?: string
    costPercentage: number | null
    salesAmountAED: number
    balanceAED: number
    couponDiscountAED: number
    smilePointsAED: number
  }
  incomplete: boolean
  warnings: string[]
  sources: Record<string, unknown>
  generatedAt: string
}

function statusBadgeClass(status: IntegrationStatus) {
  if (status === 'available') return 'der-badge der-badge--ok'
  if (status === 'not_configured') return 'der-badge der-badge--muted'
  if (status === 'pending') return 'der-badge der-badge--pending'
  return 'der-badge der-badge--err'
}

function statusLabel(status: IntegrationStatus) {
  if (status === 'available') return 'Available'
  if (status === 'not_configured') return 'Not Configured'
  if (status === 'pending') return 'Pending'
  return 'Unavailable'
}

function MetricValue({
  value,
  status,
  kind = 'money',
}: {
  value: number | null | undefined
  status?: IntegrationStatus
  kind?: 'money' | 'int' | 'pct'
}) {
  if (status === 'not_configured') return <span className="der-muted">Not Configured</span>
  if (status === 'unavailable') return <span className="der-muted">Unavailable</span>
  if (status === 'pending') return <span className="der-muted">Pending</span>
  if (value == null && (kind === 'money' || kind === 'int')) {
    return <span className="der-muted">—</span>
  }
  if (kind === 'pct') return <span>{formatPct(value)}</span>
  if (kind === 'int') return <span>{formatInt(value)}</span>
  const n = Number(value)
  const neg = Number.isFinite(n) && n < 0
  return <span className={neg ? 'der-neg' : undefined}>{formatMoney(value)}</span>
}

function ChannelCard({ channel }: { channel: ChannelReport }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const adsStatus = (channel.adsStatus || 'not_configured') as IntegrationStatus
  const clickLabel = channel.adsMetricLabel ? `Ads (${channel.adsMetricLabel})` : 'Ads Clicks'

  return (
    <section className={`der-channel der-channel--${channel.channel}`}>
      <header className="der-channel__head">
        <div className="der-channel__title-row">
          <h2 className="der-channel__title">{channel.label}</h2>
          <span className={`der-country der-country--${channel.country}`}>{channel.country}</span>
          <span className={statusBadgeClass(channel.integrationStatus)}>
            {statusLabel(channel.integrationStatus)}
          </span>
        </div>
        <p className="der-channel__sync">
          Last synced: {formatSyncTime(channel.lastSyncedAt)}
          {channel.currency ? ` · ${channel.currency}` : ''}
        </p>
      </header>

      {channel.integrationStatus === 'not_configured' ? (
        <div className="der-empty">Not Configured — no order integration for this channel yet.</div>
      ) : channel.integrationStatus === 'unavailable' ? (
        <div className="der-empty der-empty--err">Unavailable — could not load this channel.</div>
      ) : channel.orders.length === 0 ? (
        <div className="der-empty">No orders for this date.</div>
      ) : (
        <div className="der-table-wrap">
          <table className="der-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Item code</th>
                <th className="der-num">Qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {channel.orders.flatMap((order) => {
                const isOpen = expanded === order.orderId
                const items = order.items?.length ? order.items : [{ sku: '—', quantity: 0 }]
                const rows = items.map((item, idx) => (
                  <tr key={`${order.orderId}-${idx}`} className={isOpen ? 'der-tr--open' : undefined}>
                    <td>{idx === 0 ? order.orderNumber : ''}</td>
                    <td className="der-sku">{item.sku}</td>
                    <td className="der-num">{formatInt(item.quantity)}</td>
                    <td className="der-num">
                      {idx === 0 ? (
                        <button
                          type="button"
                          className="war-btn war-btn--ghost war-btn--sm"
                          onClick={() => setExpanded(isOpen ? null : order.orderId)}
                        >
                          {isOpen ? 'Hide' : 'Details'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
                if (!isOpen) return rows
                return [
                  ...rows,
                  <tr key={`${order.orderId}-detail`} className="der-detail-row">
                    <td colSpan={4}>
                      <div className="der-detail">
                        <span>Date: {order.orderDate ? formatSyncTime(order.orderDate) : '—'}</span>
                        <span>Status: {order.status || '—'}</span>
                        <span>
                          Amount: {formatMoney(order.originalAmount)} {order.originalCurrency || ''}
                          {' → '}
                          AED {formatMoney(order.amountAED)}
                        </span>
                        {order.commissionAED != null && (
                          <span>Commission: AED {formatMoney(order.commissionAED)}</span>
                        )}
                        {order.shippingAED != null && (
                          <span>Fulfillment: AED {formatMoney(order.shippingAED)}</span>
                        )}
                        {order.discountAED != null && (
                          <span>Discount (info): AED {formatMoney(order.discountAED)}</span>
                        )}
                        {order.smilePointsAED != null && (
                          <span>Smile Points (info): AED {formatMoney(order.smilePointsAED)}</span>
                        )}
                        {order.paymentMethod && <span>Payment: {order.paymentMethod}</span>}
                      </div>
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="der-summary">
        <div className="der-summary__grid">
          <div>
            <span className="der-summary__label">Qty</span>
            <span className="der-summary__value">{formatInt(channel.summary.quantity)}</span>
          </div>
          <div>
            <span className="der-summary__label">Ad spend</span>
            <span className="der-summary__value">
              <MetricValue value={channel.summary.adSpendAED} status={adsStatus} />
            </span>
          </div>
          <div title={channel.adsMetricLabel ? `Metric: ${channel.adsMetricLabel}` : undefined}>
            <span className="der-summary__label">{clickLabel}</span>
            <span className="der-summary__value">
              <MetricValue value={channel.summary.clicks} status={adsStatus} kind="int" />
            </span>
          </div>
          <div>
            <span className="der-summary__label">Commission</span>
            <span className="der-summary__value">{formatMoney(channel.summary.commissionAED)}</span>
          </div>
          <div>
            <span className="der-summary__label">Shipping</span>
            <span className="der-summary__value">{formatMoney(channel.summary.shippingAED)}</span>
          </div>
          <div>
            <span className="der-summary__label">Payment fees</span>
            <span className="der-summary__value">{formatMoney(channel.summary.paymentFeesAED)}</span>
          </div>
          <div>
            <span className="der-summary__label">Other costs</span>
            <span className="der-summary__value">{formatMoney(channel.summary.otherIncludedCostsAED)}</span>
          </div>
          <div>
            <span className="der-summary__label">Cost %</span>
            <span className="der-summary__value">{formatPct(channel.summary.costPercentage)}</span>
          </div>
          <div>
            <span className="der-summary__label">Sales (AED)</span>
            <span className="der-summary__value">{formatMoney(channel.summary.salesAmountAED)}</span>
          </div>
          <div>
            <span className="der-summary__label">Balance</span>
            <span className={`der-summary__value${channel.summary.balanceAED < 0 ? ' der-neg' : ''}`}>
              {formatMoney(channel.summary.balanceAED)}
            </span>
          </div>
        </div>
        {(channel.summary.couponDiscountAED > 0 || channel.summary.smilePointsAED > 0) && (
          <p className="der-summary__info">
            Info only (not deducted again): coupons {formatMoney(channel.summary.couponDiscountAED)} · Smile
            Points {formatMoney(channel.summary.smilePointsAED)}
          </p>
        )}
      </div>
    </section>
  )
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
      const message = err instanceof Error ? err.message : 'Failed to load report'
      setError(message)
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
      const data = await api.post('/api/reports/daily-ecommerce/refresh', { date })
      const payload = data as { report?: DailyReport }
      if (payload.report) setReport(payload.report)
      else await load(date)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Refresh failed'
      setError(message)
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
      const message = err instanceof Error ? err.message : 'Export failed'
      setError(message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="war-page der-page">
      <header className="war-page__header">
        <div>
          <h1 className="war-page__title">Daily Ecommerce Report</h1>
          <p className="war-page__sub">
            Orders and channel P&amp;L by sales channel · UAE calendar day ({IANA_UAE})
          </p>
        </div>
      </header>

      <section className="war-section der-toolbar-section">
        <div className="der-toolbar">
          <div className="der-date-nav">
            <button
              type="button"
              className="war-btn war-btn--ghost"
              onClick={() => setDate((d) => addDaysYmd(d, -1))}
              aria-label="Previous day"
            >
              ← Prev
            </button>
            <label className="war-label der-date-label">
              Date
              <input
                type="date"
                className="war-input"
                value={date}
                max={todayUaeYmd()}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="war-btn war-btn--ghost"
              disabled={date >= todayUaeYmd()}
              onClick={() => setDate((d) => addDaysYmd(d, 1))}
              aria-label="Next day"
            >
              Next →
            </button>
            <button type="button" className="war-btn war-btn--ghost war-btn--sm" onClick={() => setDate(todayUaeYmd())}>
              Today
            </button>
          </div>
          <div className="der-actions">
            <button
              type="button"
              className="war-btn war-btn--ghost"
              disabled={loading || refreshing}
              onClick={() => void onRefresh()}
            >
              {refreshing ? 'Syncing…' : 'Refresh / Sync'}
            </button>
            {canExport && (
              <button
                type="button"
                className="war-btn war-btn--primary"
                disabled={loading || exporting || !report}
                onClick={() => void onExport()}
              >
                {exporting ? 'Exporting…' : 'Export Excel'}
              </button>
            )}
          </div>
        </div>
        {report && (
          <p className="der-meta">
            Generated {formatSyncTime(report.generatedAt)}
            {report.exchangeRate
              ? ` · SAR→AED ${report.exchangeRate.rate} (${report.exchangeRate.source})`
              : ''}
          </p>
        )}
      </section>

      {report?.incomplete && (
        <div className="der-banner der-banner--warn" role="status">
          Report incomplete — some channels or advertising sources are Not Configured or Unavailable.
          Totals use available values only.
        </div>
      )}

      {error && (
        <div className="der-banner der-banner--err" role="alert">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="wsr-processing der-loading" role="status" aria-live="polite">
          <div className="wsr-processing__spinner" aria-hidden />
          <div className="wsr-processing__text">
            <span className="wsr-processing__title">Loading report</span>
            <span className="wsr-processing__sub">Building daily ecommerce channels…</span>
          </div>
        </div>
      )}

      {report && (
        <>
          <div className="der-channels">
            {report.channels.map((ch) => (
              <ChannelCard key={ch.channel} channel={ch} />
            ))}
          </div>

          <section className="der-totals war-section">
            <h2 className="war-section__title">Consolidated totals</h2>
            <div className="der-summary__grid der-totals__grid">
              <div>
                <span className="der-summary__label">Total qty</span>
                <span className="der-summary__value">{formatInt(report.totals.quantity)}</span>
              </div>
              <div>
                <span className="der-summary__label">Total ads</span>
                <span className="der-summary__value">
                  <MetricValue
                    value={report.totals.adSpendAED}
                    status={report.totals.adSpendAED == null ? 'not_configured' : 'available'}
                  />
                </span>
              </div>
              <div>
                <span className="der-summary__label">Total clicks</span>
                <span className="der-summary__value">
                  <MetricValue
                    value={report.totals.clicks}
                    status={report.totals.clicks == null ? 'not_configured' : 'available'}
                    kind="int"
                  />
                </span>
              </div>
              <div>
                <span className="der-summary__label">Commission</span>
                <span className="der-summary__value">{formatMoney(report.totals.commissionAED)}</span>
              </div>
              <div>
                <span className="der-summary__label">Shipping</span>
                <span className="der-summary__value">{formatMoney(report.totals.shippingAED)}</span>
              </div>
              <div>
                <span className="der-summary__label">Payment fees</span>
                <span className="der-summary__value">{formatMoney(report.totals.paymentFeesAED)}</span>
              </div>
              <div>
                <span className="der-summary__label">Other costs</span>
                <span className="der-summary__value">{formatMoney(report.totals.otherIncludedCostsAED)}</span>
              </div>
              <div>
                <span className="der-summary__label">General ecommerce</span>
                <span className="der-summary__value">
                  <MetricValue value={report.totals.generalEcommerceCostsAED} status="not_configured" />
                </span>
              </div>
              <div>
                <span className="der-summary__label">Cost %</span>
                <span className="der-summary__value">{formatPct(report.totals.costPercentage)}</span>
              </div>
              <div>
                <span className="der-summary__label">Sales (AED)</span>
                <span className="der-summary__value">{formatMoney(report.totals.salesAmountAED)}</span>
              </div>
              <div>
                <span className="der-summary__label">Balance</span>
                <span className={`der-summary__value${report.totals.balanceAED < 0 ? ' der-neg' : ''}`}>
                  {formatMoney(report.totals.balanceAED)}
                </span>
              </div>
            </div>
          </section>

          {report.warnings?.length > 0 && (
            <section className="war-section der-warnings">
              <h2 className="war-section__title">Data quality</h2>
              <ul className="der-warnings__list">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
