import { useState, useMemo, useCallback } from 'react'
import { useWeeklySalesReport } from '../../hooks/useWeeklySalesReport'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'

function formatNum(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatDateLabel(start, end) {
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
function defaultWeekRange() {
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

function NotConfiguredCallout({ message }) {
  return (
    <div className="wsr-callout wsr-callout--warn" role="status">
      <span className="wsr-callout__title">Zoho source not configured</span>
      <div className="wsr-callout__body">
        {message ||
          'This report needs a Zoho-side webhook (Deluge function) that returns the per-item weekly totals.'}
        <div style={{ marginTop: 6 }}>
          Set <code>ZOHO_REPORT_WEBHOOK_URL</code> and{' '}
          <code>ZOHO_REPORT_WEBHOOK_AUTH_HEADER</code> in the backend
          environment, then restart the API.
        </div>
      </div>
    </div>
  )
}

function ErrorCallout({ message, onRetry, validationErrors }) {
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
            Fix the Deluge function on the Zoho side so each item row has a
            non-empty <code>sku</code> and only JSON numbers (never strings)
            for the stock fields.
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
 * Generic, read-only Zoho-sourced weekly sales report. The component is
 * driven entirely by props + the backend response — every numeric column
 * (Opening Stock, Purchases, Returned to Wholesale, Closing Stock, SOLD)
 * comes verbatim from the Zoho-source webhook. The Grand Total row sums
 * those Zoho-provided values for display only.
 *
 * Props:
 *   reportGroup – the report_group key (e.g. 'slow_moving', 'other_family')
 *   title       – display title shown in the page header
 *   subtitle    – optional one-line description
 */
export function WeeklySalesReportPage({ reportGroup, title, subtitle }) {
  const initial = useMemo(defaultWeekRange, [])
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate]     = useState(initial.to)

  const { items, totals, loading, error, notConfigured, validationErrors, refetch } =
    useWeeklySalesReport({ reportGroup, fromDate, toDate })

  const dateLabel = formatDateLabel(fromDate, toDate)

  const handleFromChange = useCallback((e) => setFromDate(e.target.value), [])
  const handleToChange   = useCallback((e) => setToDate(e.target.value),   [])

  const grandTotal = totals || {
    opening_stock: 0,
    purchases: 0,
    returned_to_wholesale: 0,
    closing_stock: 0,
    sold: 0,
  }

  const datesValid = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate
  const showTable = !loading && !error && !notConfigured && datesValid

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
              <input
                id="wsr-from"
                type="date"
                className="war-input"
                value={fromDate}
                max={toDate || undefined}
                onChange={handleFromChange}
              />
            </div>
            <div className="war-form-field">
              <label className="war-label" htmlFor="wsr-to">To</label>
              <input
                id="wsr-to"
                type="date"
                className="war-input"
                value={toDate}
                min={fromDate || undefined}
                onChange={handleToChange}
              />
            </div>
          </div>
          <div className="wsr-toolbar__actions">
            <button
              type="button"
              className="war-btn war-btn--ghost"
              onClick={refetch}
              disabled={loading || !datesValid}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {!datesValid && (
          <div className="wsr-callout wsr-callout--warn">
            <span className="wsr-callout__title">Invalid date range</span>
            <div className="wsr-callout__body">
              Pick a From date that's before or equal to the To date.
            </div>
          </div>
        )}
      </section>

      {notConfigured && <NotConfiguredCallout message={error} />}

      {error && !notConfigured && (
        <ErrorCallout
          message={error}
          onRetry={refetch}
          validationErrors={validationErrors}
        />
      )}

      {showTable && (
        <section className="war-section">
          <div className="war-preview__head" style={{ marginBottom: 12 }}>
            <span className="war-preview__title">{title}</span>
            <div className="war-preview__divider" aria-hidden />
            <span className="war-preview__date">{dateLabel}</span>
          </div>

          <div className="war-table-wrap">
            <table className="war-table">
              <thead>
                <tr>
                  <th className="war-th wsr-th--sr">SR. NO</th>
                  <th className="war-th wsr-th--item">ITEM</th>
                  <th className="war-th">Opening Stock</th>
                  <th className="war-th">Purchases</th>
                  <th className="war-th">Returned to Wholesale</th>
                  <th className="war-th">Closing Stock</th>
                  <th className="war-th">SOLD</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr className="war-tr">
                    <td className="war-td" colSpan={7}>
                      <div className="wsr-empty">
                        <strong>No items returned by Zoho for this date range.</strong>
                        <span className="wsr-empty__sub">
                          The report group has members in the database, but the
                          Zoho webhook returned no matching rows for{' '}
                          {dateLabel || 'the selected period'}.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {items.map((it, idx) => {
                  const key = it.sku || it.item_id || it.item_name || idx
                  return (
                    <tr key={key} className="war-tr">
                      <td className="war-td wsr-td--sr">{idx + 1}</td>
                      <td className="war-td wsr-td--item">
                        {it.item_name || it.sku || it.item_id || '—'}
                      </td>
                      <td className="war-td">{formatNum(it.opening_stock)}</td>
                      <td className="war-td">{formatNum(it.purchases)}</td>
                      <td className="war-td">{formatNum(it.returned_to_wholesale)}</td>
                      <td className="war-td">{formatNum(it.closing_stock)}</td>
                      <td className="war-td">{formatNum(it.sold)}</td>
                    </tr>
                  )
                })}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="war-tr war-tr--total">
                    <td className="war-td wsr-td--sr"></td>
                    <td className="war-td wsr-td--item">Grand Total</td>
                    <td className="war-td">{formatNum(grandTotal.opening_stock)}</td>
                    <td className="war-td">{formatNum(grandTotal.purchases)}</td>
                    <td className="war-td">{formatNum(grandTotal.returned_to_wholesale)}</td>
                    <td className="war-td">{formatNum(grandTotal.closing_stock)}</td>
                    <td className="war-td">{formatNum(grandTotal.sold)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="wsr-meta">
            <div className="wsr-meta__item">
              Group:<strong>{reportGroup}</strong>
            </div>
            <div className="wsr-meta__item">
              Items returned:<strong>{items.length}</strong>
            </div>
            <div className="wsr-meta__item">
              Source:<strong>Zoho (live)</strong>
            </div>
          </div>
        </section>
      )}

      {loading && (
        <section className="war-section">
          <div className="wsr-loading">Loading report from Zoho…</div>
        </section>
      )}
    </div>
  )
}

export default WeeklySalesReportPage
