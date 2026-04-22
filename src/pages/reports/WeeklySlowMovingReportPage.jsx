import { useState, useMemo, useCallback } from 'react'
import { api } from '../../api/client'
import './WeeklyAdsReportPage.css'
import './WeeklySlowMovingReportPage.css'

// ---------------------------------------------------------------------------
// Date helpers  (same pattern as WeeklyAdsReportPage)
// ---------------------------------------------------------------------------

function getWeekLabel(start, end) {
  const fmt = (d) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${fmt(new Date(start))} – ${fmt(new Date(end))}`
}

function currentWeekBounds() {
  const d   = new Date()
  const day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (dt) => dt.toISOString().slice(0, 10)
  return { start: fmt(mon), end: fmt(sun) }
}

function fmtNum(val) {
  const n = Number(val)
  if (isNaN(n)) return '—'
  if (n === 0)  return '-'
  return n.toLocaleString('en-US')
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReportHeader({ fromDate, toDate }) {
  return (
    <div className="wsmr-preview__head">
      <span className="wsmr-preview__title">ECOMMERCE SLOW MOVING SALES REPORT</span>
      <div className="wsmr-preview__divider" aria-hidden />
      <span className="wsmr-preview__date">{getWeekLabel(fromDate, toDate)}</span>
    </div>
  )
}

function ReportTable({ items, totals, fromDate, toDate }) {
  return (
    <div className="wsmr-preview">
      <ReportHeader fromDate={fromDate} toDate={toDate} />

      <div className="war-table-wrap">
        <table className="war-table wsmr-table">
          <thead>
            <tr>
              <th className="war-th war-th--center wsmr-th--sr">SR. NO</th>
              <th className="war-th war-th--left  wsmr-th--item">ITEM</th>
              <th className="war-th">Opening Stock</th>
              <th className="war-th">Purchases</th>
              <th className="war-th">Returned to Wholesale</th>
              <th className="war-th">Closing Stock</th>
              <th className="war-th">SOLD</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.item_id || item.item_name || idx} className="war-tr">
                <td className="war-td war-td--center">{idx + 1}</td>
                <td className="war-td war-td--name">{item.item_name}</td>
                <td className="war-td">{fmtNum(item.opening_stock)}</td>
                <td className="war-td">{fmtNum(item.purchases)}</td>
                <td className="war-td">{fmtNum(item.returned_to_wholesale)}</td>
                <td className="war-td">{fmtNum(item.closing_stock)}</td>
                <td className="war-td wsmr-td--sold">{fmtNum(item.sold)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="war-tr war-tr--total">
              <td className="war-td war-td--center" />
              <td className="war-td war-td--name">Grand Total</td>
              <td className="war-td">{fmtNum(totals.opening_stock)}</td>
              <td className="war-td">{fmtNum(totals.purchases)}</td>
              <td className="war-td">{fmtNum(totals.returned_to_wholesale)}</td>
              <td className="war-td">{fmtNum(totals.closing_stock)}</td>
              <td className="war-td wsmr-td--sold">{fmtNum(totals.sold)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="wsmr-state">
      <div className="wsmr-spinner" aria-label="Loading" />
      <p>Fetching report from Zoho…</p>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="wsmr-state wsmr-state--error">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="wsmr-state__title">Failed to load report</p>
      <p className="wsmr-state__sub">{message}</p>
      <button type="button" className="war-btn war-btn--primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="war-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 21V9" />
      </svg>
      <p>No slow-moving items found for this period.</p>
      <p className="war-empty__sub">Try a different date range or check your Zoho item classification.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WeeklySlowMovingReportPage() {
  const defaultBounds      = useMemo(currentWeekBounds, [])
  const [fromDate, setFromDate] = useState(defaultBounds.start)
  const [toDate,   setToDate]   = useState(defaultBounds.end)

  const [status, setStatus]   = useState('idle')   // idle | loading | success | error
  const [report, setReport]   = useState(null)      // { items, totals, from_date, to_date }
  const [errorMsg, setErrorMsg] = useState('')

  const fetchReport = useCallback(async () => {
    if (!fromDate || !toDate) return
    setStatus('loading')
    setErrorMsg('')
    try {
      const data = await api.get(
        `/api/weekly-reports/slow-moving?from_date=${fromDate}&to_date=${toDate}`
      )
      setReport(data)
      setStatus('success')
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error')
      setStatus('error')
    }
  }, [fromDate, toDate])

  const dateLabel = fromDate && toDate ? getWeekLabel(fromDate, toDate) : ''

  return (
    <div className="war-page">

      {/* ─── Page Header ─── */}
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">Weekly Slow Moving Sales Report</h1>
          <p className="war-page__sub">Stock movement for slow-moving items, sourced directly from Zoho Inventory</p>
        </div>
      </div>

      {/* ─── Date Range + Fetch ─── */}
      <section className="war-section">
        <h2 className="war-section__title">Select Date Range</h2>

        <div className="war-form-meta">
          <div className="war-form-field">
            <label className="war-label" htmlFor="wsmr-from">Week Start</label>
            <input
              id="wsmr-from"
              type="date"
              className="war-input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="war-form-field">
            <label className="war-label" htmlFor="wsmr-to">Week End</label>
            <input
              id="wsmr-to"
              type="date"
              className="war-input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div className="war-form-field wsmr-fetch-field">
            <span className="war-label" aria-hidden>&nbsp;</span>
            <button
              type="button"
              className="war-btn war-btn--primary"
              onClick={fetchReport}
              disabled={!fromDate || !toDate || status === 'loading'}
            >
              {status === 'loading' ? (
                <>
                  <span className="wsmr-btn-spinner" aria-hidden />
                  Loading…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Fetch from Zoho
                </>
              )}
            </button>
          </div>
        </div>

        {dateLabel && (
          <p className="wsmr-date-hint">
            Reporting period: <strong>{dateLabel}</strong>
          </p>
        )}
      </section>

      {/* ─── Report Output ─── */}
      {status === 'idle' && (
        <section className="war-section">
          <div className="war-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <p>Select a date range and click <strong>Fetch from Zoho</strong> to generate the report.</p>
          </div>
        </section>
      )}

      {status === 'loading' && (
        <section className="war-section">
          <LoadingState />
        </section>
      )}

      {status === 'error' && (
        <section className="war-section">
          <ErrorState message={errorMsg} onRetry={fetchReport} />
        </section>
      )}

      {status === 'success' && report && (
        <section className="war-section">
          {report.items.length === 0 ? (
            <EmptyState />
          ) : (
            <ReportTable
              items={report.items}
              totals={report.totals}
              fromDate={report.from_date}
              toDate={report.to_date}
            />
          )}
        </section>
      )}
    </div>
  )
}
