import { useState, useMemo, useCallback } from 'react'
import { fetchBinary, downloadBlob } from '../../api/client'
import { useWeeklySalesReport } from '../../hooks/useWeeklySalesReport'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'

export function formatNum(val) {
  if (val == null) return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatCurrency(val) {
  if (val == null) return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '-'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDateLabel(start, end) {
  if (!start || !end) return ''
  const fmt = (d) =>
    new Date(d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Default to the current ISO-week (Mon–Sun). */
export function defaultWeekRange() {
  const d = new Date()
  const day = d.getDay()
  const monOffset = day === 0 ? -6 : 1 - day
  const start = new Date(d)
  start.setDate(d.getDate() + monOffset)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { from: iso(start), to: iso(end) }
}

export function defaultExportXlsxName(reportGroup, fromDate, toDate) {
  const slug =
    {
      slow_moving: 'slow-moving',
      other_family: 'other-family',
    }[reportGroup] || String(reportGroup).replace(/_/g, '-')
  return `weekly-${slug}-report-${fromDate}-to-${toDate}.xlsx`
}

export function NotConfiguredCallout({ message }) {
  return (
    <div className="wsr-callout wsr-callout--warn" role="status">
      <span className="wsr-callout__title">Zoho not configured</span>
      <div className="wsr-callout__body">
        {message ||
          'Set Zoho Inventory OAuth and organization variables on the backend (see .env.example).'}
        <div style={{ marginTop: 6 }}>
          Required: <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code>,{' '}
          <code>ZOHO_REFRESH_TOKEN</code>, <code>ZOHO_INVENTORY_ORGANIZATION_ID</code>. Optional:{' '}
          <code>ZOHO_FAMILY_CUSTOMFIELD_ID</code> for the Family field.
        </div>
      </div>
    </div>
  )
}

export function ErrorCallout({ message, onRetry, validationErrors }) {
  const hasValidation = Array.isArray(validationErrors) && validationErrors.length > 0
  return (
    <div className="wsr-callout wsr-callout--error" role="alert">
      <span className="wsr-callout__title">
        {hasValidation ? 'Zoho returned an invalid response' : 'Failed to load report'}
      </span>
      <div className="wsr-callout__body">{message || 'Unknown error'}</div>
      {hasValidation && (
        <details className="wsr-callout__details" open>
          <summary>
            {validationErrors.length} validation issue
            {validationErrors.length === 1 ? '' : 's'} from the Zoho webhook
          </summary>
          <ul className="wsr-callout__list">
            {validationErrors.slice(0, 20).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
            {validationErrors.length > 20 && (
              <li>…and {validationErrors.length - 20} more.</li>
            )}
          </ul>
          <p className="wsr-callout__hint">
            Fix the Zoho data so each row has a non-empty <code>sku</code>, a string{' '}
            <code>family</code> (use <code>""</code> if none), and only JSON numbers
            (or <code>null</code> for unavailable) for the stock fields.
          </p>
        </details>
      )}
      {onRetry && (
        <div>
          <button
            type="button"
            className="war-btn war-btn--ghost"
            onClick={onRetry}
            style={{ marginTop: 8 }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * One report group's data + table. Receives `fromDate` / `toDate` from a parent
 * so multiple sections can share a single date picker.
 *
 * Props:
 *   reportGroup  – e.g. 'slow_moving'
 *   title        – section heading
 *   fromDate     – YYYY-MM-DD (controlled by parent)
 *   toDate       – YYYY-MM-DD (controlled by parent)
 *   datesValid   – boolean from parent so the section doesn't double-validate
 *   warehouseId  – optional Zoho warehouse_id to filter by
 */
export function WeeklySalesReportSection({ reportGroup, title, fromDate, toDate, datesValid, warehouseId = null }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const { items, totals, zoho, loading, error, notConfigured, validationErrors, refetch } =
    useWeeklySalesReport({ reportGroup, fromDate, toDate, warehouseId })

  const dateLabel = formatDateLabel(fromDate, toDate)

  const handleExport = useCallback(async () => {
    if (!datesValid || notConfigured) return
    setExporting(true)
    setExportError('')
    const qsParams = { from_date: fromDate, to_date: toDate }
    if (warehouseId && String(warehouseId).trim() !== '') qsParams.warehouse_id = String(warehouseId).trim()
    const qs = new URLSearchParams(qsParams).toString()
    const path = `/api/weekly-reports/by-group/${encodeURIComponent(reportGroup)}/export.xlsx?${qs}`
    try {
      const { blob, filename } = await fetchBinary(path)
      downloadBlob(blob, filename || defaultExportXlsxName(reportGroup, fromDate, toDate))
    } catch (err) {
      setExportError(err?.message || 'Export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }, [datesValid, notConfigured, fromDate, toDate, reportGroup])

  const grandTotal = totals || {
    item_count: 0, closing_stock: 0, purchases: 0, purchase_amount: 0,
    returned_to_wholesale: 0, sold: 0, sales_amount: 0,
  }

  const showTable = !loading && !error && !notConfigured && datesValid

  return (
    <section className="war-section wsr-report-section">
      {/* Section header with title + per-group export/refresh */}
      <div className="wsr-section-header">
        <div className="wsr-section-header__title-wrap">
          <h2 className="wsr-section-heading">{title}</h2>
          {dateLabel && <span className="wsr-section-header__date">{dateLabel}</span>}
        </div>
        <div className="wsr-section-header__actions">
          <button
            type="button"
            className="war-btn war-btn--primary war-btn--sm"
            onClick={handleExport}
            disabled={exporting || !datesValid || notConfigured}
            aria-busy={exporting}
          >
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            type="button"
            className="war-btn war-btn--ghost war-btn--sm"
            onClick={refetch}
            disabled={loading || !datesValid}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="wsr-callout wsr-callout--error wsr-callout--inline" role="alert" style={{ marginBottom: 12 }}>
          <span className="wsr-callout__body">{exportError}</span>
        </div>
      )}

      {notConfigured && <NotConfiguredCallout message={error} />}

      {error && !notConfigured && (
        <ErrorCallout message={error} onRetry={refetch} validationErrors={validationErrors} />
      )}

      {loading && <div className="wsr-loading">Loading from Zoho…</div>}

      {showTable && (
        <>
          <div className="war-table-wrap">
            <table className="war-table">
              <thead>
                <tr>
                  <th className="war-th wsr-th--sr">SR. NO</th>
                  <th className="war-th wsr-th--item">FAMILY</th>
                  <th className="war-th">Active Items</th>
                  <th className="war-th">Closing Stock</th>
                  <th className="war-th">Purchases Qty</th>
                  <th className="war-th">Purchase Amount</th>
                  <th className="war-th">Returned to Wholesale</th>
                  <th className="war-th">SOLD Qty</th>
                  <th className="war-th">Sales Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr className="war-tr">
                    <td className="war-td" colSpan={9}>
                      <div className="wsr-empty">
                        <strong>No families found for this date range.</strong>
                        <span className="wsr-empty__sub">
                          No active Zoho items matched the Family field for{' '}
                          {dateLabel || 'the selected period'}.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {items.map((it, idx) => (
                  <tr key={it.family || idx} className="war-tr">
                    <td className="war-td wsr-td--sr">{idx + 1}</td>
                    <td className="war-td wsr-td--item">{it.family || '—'}</td>
                    <td className="war-td">{formatNum(it.item_count)}</td>
                    <td className="war-td">{formatNum(it.closing_stock)}</td>
                    <td className="war-td">{formatNum(it.purchases)}</td>
                    <td className="war-td">{formatCurrency(it.purchase_amount)}</td>
                    <td className="war-td">{formatNum(it.returned_to_wholesale)}</td>
                    <td className="war-td">{formatNum(it.sold)}</td>
                    <td className="war-td">{formatCurrency(it.sales_amount)}</td>
                  </tr>
                ))}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="war-tr war-tr--total">
                    <td className="war-td wsr-td--sr" />
                    <td className="war-td wsr-td--item">Grand Total</td>
                    <td className="war-td">{formatNum(grandTotal.item_count)}</td>
                    <td className="war-td">{formatNum(grandTotal.closing_stock)}</td>
                    <td className="war-td">{formatNum(grandTotal.purchases)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.purchase_amount)}</td>
                    <td className="war-td">{formatNum(grandTotal.returned_to_wholesale)}</td>
                    <td className="war-td">{formatNum(grandTotal.sold)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.sales_amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="wsr-meta">
            <div className="wsr-meta__item">Group:<strong>{reportGroup}</strong></div>
            <div className="wsr-meta__item">Families:<strong>{items.length}</strong></div>
            <div className="wsr-meta__item">Source:<strong>Zoho (live)</strong></div>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Stand-alone page for a single report group (keeps backward compat for
 * direct links to /slow-moving or /other-family if needed).
 */
export function WeeklySalesReportPage({ reportGroup, title, subtitle }) {
  const initial = useMemo(defaultWeekRange, [])
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate]     = useState(initial.to)

  const handleFromChange = useCallback((e) => setFromDate(e.target.value), [])
  const handleToChange   = useCallback((e) => setToDate(e.target.value), [])

  const datesValid = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate

  return (
    <div className="war-page">
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">{title}</h1>
          {subtitle && <p className="war-page__sub">{subtitle}</p>}
        </div>
      </div>

      <section className="war-section">
        <h2 className="war-section__title">Date Range</h2>
        <div className="wsr-toolbar">
          <div className="wsr-toolbar__dates">
            <div className="war-form-field">
              <label className="war-label" htmlFor="wsr-from">From</label>
              <input id="wsr-from" type="date" className="war-input"
                value={fromDate} max={toDate || undefined} onChange={handleFromChange} />
            </div>
            <div className="war-form-field">
              <label className="war-label" htmlFor="wsr-to">To</label>
              <input id="wsr-to" type="date" className="war-input"
                value={toDate} min={fromDate || undefined} onChange={handleToChange} />
            </div>
          </div>
        </div>
        {!datesValid && (
          <div className="wsr-callout wsr-callout--warn">
            <span className="wsr-callout__title">Invalid date range</span>
            <div className="wsr-callout__body">Pick a From date ≤ To date.</div>
          </div>
        )}
      </section>

      <WeeklySalesReportSection
        reportGroup={reportGroup}
        title={title}
        fromDate={fromDate}
        toDate={toDate}
        datesValid={datesValid}
      />
    </div>
  )
}

export default WeeklySalesReportPage
