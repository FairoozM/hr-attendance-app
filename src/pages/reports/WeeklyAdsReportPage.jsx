import { useState, useMemo, useCallback } from 'react'
import './WeeklyAdsReportPage.css'

const MARKETPLACES = ['Amazon (UAE)', 'Amazon (KSA)', 'Noon', 'Website']

const ACOS_THRESHOLD = 15 // percent — above this is flagged

function formatNum(val) {
  const n = parseFloat(val)
  if (isNaN(n)) return val
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function calcAcos(spend, sales) {
  const s = parseFloat(spend)
  const r = parseFloat(sales)
  if (!r || isNaN(s) || isNaN(r)) return null
  return ((s / r) * 100).toFixed(2)
}

function getWeekLabel(start, end) {
  const fmt = (d) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${fmt(new Date(start))} – ${fmt(new Date(end))}`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const DEFAULT_ROW = () => ({ spend: '', clicks: '', sales: '' })

const DEFAULT_ROWS = () =>
  Object.fromEntries(MARKETPLACES.map((m) => [m, DEFAULT_ROW()]))

function EmptyState() {
  return (
    <div className="war-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 21V9" />
      </svg>
      <p>No weekly reports yet.</p>
      <p className="war-empty__sub">Fill in the form above and save to build history.</p>
    </div>
  )
}

function ReportTable({ rows, title, dateLabel }) {
  const totals = useMemo(() => {
    let spend = 0, clicks = 0, sales = 0
    MARKETPLACES.forEach((m) => {
      spend += parseFloat(rows[m]?.spend) || 0
      clicks += parseFloat(rows[m]?.clicks) || 0
      sales += parseFloat(rows[m]?.sales) || 0
    })
    return { spend, clicks, sales }
  }, [rows])

  const totalAcos = calcAcos(totals.spend, totals.sales)

  return (
    <div className="war-preview">
      <div className="war-preview__head">
        <span className="war-preview__title">{title || 'Ads Spend Weekly Report'}</span>
        <span className="war-preview__date">{dateLabel}</span>
      </div>
      <div className="war-table-wrap">
        <table className="war-table">
          <thead>
            <tr>
              <th className="war-th war-th--left">Marketplace</th>
              <th className="war-th">Ads Spend (AED)</th>
              <th className="war-th war-th--center">Clicks</th>
              <th className="war-th">Net Sales (AED)</th>
              <th className="war-th war-th--center">ACOS</th>
            </tr>
          </thead>
          <tbody>
            {MARKETPLACES.map((m) => {
              const r = rows[m] || DEFAULT_ROW()
              const acos = calcAcos(r.spend, r.sales)
              const isDanger = acos !== null && parseFloat(acos) > ACOS_THRESHOLD
              return (
                <tr key={m} className="war-tr">
                  <td className="war-td war-td--name">{m}</td>
                  <td className="war-td">{r.spend ? formatNum(r.spend) : '—'}</td>
                  <td className="war-td war-td--center">{r.clicks ? formatNum(r.clicks) : '—'}</td>
                  <td className="war-td">{r.sales ? formatNum(r.sales) : '—'}</td>
                  <td className={`war-td war-td--center${isDanger ? ' war-td--danger' : ''}`}>
                    {acos !== null ? `${acos}%` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="war-tr war-tr--total">
              <td className="war-td war-td--name">TOTAL</td>
              <td className="war-td">{formatNum(totals.spend.toFixed(0))}</td>
              <td className="war-td war-td--center">{formatNum(totals.clicks.toFixed(0))}</td>
              <td className="war-td">{formatNum(totals.sales.toFixed(0))}</td>
              <td className={`war-td war-td--center${totalAcos !== null && parseFloat(totalAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                {totalAcos !== null ? `${totalAcos}%` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function HistoryCard({ entry, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  const totals = useMemo(() => {
    let spend = 0, clicks = 0, sales = 0
    MARKETPLACES.forEach((m) => {
      spend += parseFloat(entry.rows[m]?.spend) || 0
      clicks += parseFloat(entry.rows[m]?.clicks) || 0
      sales += parseFloat(entry.rows[m]?.sales) || 0
    })
    return { spend, clicks, sales }
  }, [entry.rows])

  const totalAcos = calcAcos(totals.spend, totals.sales)
  const acosNum = totalAcos !== null ? parseFloat(totalAcos) : null

  return (
    <div className="war-history-card">
      <div className="war-history-card__summary" onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}>
        <div className="war-history-card__left">
          <span className="war-history-card__week">{getWeekLabel(entry.startDate, entry.endDate)}</span>
          {entry.title && <span className="war-history-card__subtitle">{entry.title}</span>}
        </div>
        <div className="war-history-card__kpis">
          <div className="war-history-card__kpi">
            <span className="war-history-card__kpi-label">Total Spend</span>
            <span className="war-history-card__kpi-val">AED {formatNum(totals.spend.toFixed(0))}</span>
          </div>
          <div className="war-history-card__kpi">
            <span className="war-history-card__kpi-label">Net Sales</span>
            <span className="war-history-card__kpi-val">AED {formatNum(totals.sales.toFixed(0))}</span>
          </div>
          <div className="war-history-card__kpi">
            <span className="war-history-card__kpi-label">ACOS</span>
            <span className={`war-history-card__kpi-val${acosNum !== null && acosNum > ACOS_THRESHOLD ? ' war-history-card__kpi-val--danger' : ' war-history-card__kpi-val--ok'}`}>
              {totalAcos !== null ? `${totalAcos}%` : '—'}
            </span>
          </div>
          <div className="war-history-card__kpi">
            <span className="war-history-card__kpi-label">Clicks</span>
            <span className="war-history-card__kpi-val">{formatNum(totals.clicks.toFixed(0))}</span>
          </div>
        </div>
        <div className="war-history-card__actions">
          <button
            type="button"
            className="war-history-card__delete"
            title="Delete this report"
            onClick={(e) => { e.stopPropagation(); onDelete(entry.id) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
          <svg
            className={`war-history-card__chevron${expanded ? ' war-history-card__chevron--open' : ''}`}
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      {expanded && (
        <div className="war-history-card__detail">
          <ReportTable rows={entry.rows} title={entry.title} dateLabel={getWeekLabel(entry.startDate, entry.endDate)} />
          {entry.notes && <p className="war-history-card__notes">{entry.notes}</p>}
        </div>
      )}
    </div>
  )
}

const STORAGE_KEY = 'war_history_v1'

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore quota errors
  }
}

export function WeeklyAdsReportPage() {
  const [history, setHistory] = useState(loadHistory)

  // Form state
  const [title, setTitle] = useState('Ads Spend Weekly Report')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? 0 : 7)
    d.setDate(diff)
    return d.toISOString().slice(0, 10)
  })
  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)

  const updateRow = useCallback((marketplace, field, value) => {
    setRows((prev) => ({
      ...prev,
      [marketplace]: { ...prev[marketplace], [field]: value },
    }))
    setSaved(false)
  }, [])

  const totals = useMemo(() => {
    let spend = 0, clicks = 0, sales = 0
    MARKETPLACES.forEach((m) => {
      spend += parseFloat(rows[m]?.spend) || 0
      clicks += parseFloat(rows[m]?.clicks) || 0
      sales += parseFloat(rows[m]?.sales) || 0
    })
    return { spend, clicks, sales }
  }, [rows])

  const totalAcos = calcAcos(totals.spend, totals.sales)

  const handleSave = () => {
    const entry = {
      id: Date.now().toString(),
      title,
      startDate,
      endDate,
      rows: JSON.parse(JSON.stringify(rows)),
      notes,
      savedAt: new Date().toISOString(),
    }
    const updated = [entry, ...history]
    setHistory(updated)
    saveHistory(updated)
    setSaved(true)
    // Reset form to next week
    const nextStart = addDays(endDate, 1)
    const nextEnd = addDays(endDate, 7)
    setStartDate(nextStart)
    setEndDate(nextEnd)
    setRows(DEFAULT_ROWS())
    setNotes('')
    setTimeout(() => setSaved(false), 3000)
  }

  const handleDelete = useCallback((id) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id)
      saveHistory(updated)
      return updated
    })
  }, [])

  const handleClearForm = () => {
    setRows(DEFAULT_ROWS())
    setNotes('')
    setSaved(false)
  }

  const dateLabel = startDate && endDate ? getWeekLabel(startDate, endDate) : ''

  return (
    <div className="war-page">
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">Weekly Ads Report</h1>
          <p className="war-page__sub">Enter this week's performance data across all marketplaces</p>
        </div>
        {saved && (
          <div className="war-saved-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Report saved
          </div>
        )}
      </div>

      {/* ─── Input Form ─── */}
      <section className="war-section">
        <h2 className="war-section__title">New Weekly Report</h2>

        <div className="war-form-meta">
          <div className="war-form-field">
            <label className="war-label" htmlFor="war-title">Report Title</label>
            <input
              id="war-title"
              type="text"
              className="war-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ads Spend Weekly Report"
            />
          </div>
          <div className="war-form-field">
            <label className="war-label" htmlFor="war-start">Week Start</label>
            <input
              id="war-start"
              type="date"
              className="war-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="war-form-field">
            <label className="war-label" htmlFor="war-end">Week End</label>
            <input
              id="war-end"
              type="date"
              className="war-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="war-table-wrap war-input-table-wrap">
          <table className="war-table">
            <thead>
              <tr>
                <th className="war-th war-th--left">Marketplace</th>
                <th className="war-th">Ads Spend (AED)</th>
                <th className="war-th war-th--center">Clicks</th>
                <th className="war-th">Net Sales (AED)</th>
                <th className="war-th war-th--center">ACOS</th>
              </tr>
            </thead>
            <tbody>
              {MARKETPLACES.map((m) => {
                const r = rows[m]
                const acos = calcAcos(r.spend, r.sales)
                const isDanger = acos !== null && parseFloat(acos) > ACOS_THRESHOLD
                return (
                  <tr key={m} className="war-tr war-tr--input">
                    <td className="war-td war-td--name">{m}</td>
                    <td className="war-td">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="war-cell-input"
                        value={r.spend}
                        onChange={(e) => updateRow(m, 'spend', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} ads spend`}
                      />
                    </td>
                    <td className="war-td war-td--center">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="war-cell-input war-cell-input--center"
                        value={r.clicks}
                        onChange={(e) => updateRow(m, 'clicks', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} clicks`}
                      />
                    </td>
                    <td className="war-td">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="war-cell-input"
                        value={r.sales}
                        onChange={(e) => updateRow(m, 'sales', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} net sales`}
                      />
                    </td>
                    <td className={`war-td war-td--center war-td--acos-calc${isDanger ? ' war-td--danger' : ''}`}>
                      {acos !== null ? `${acos}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="war-tr war-tr--total">
                <td className="war-td war-td--name">TOTAL</td>
                <td className="war-td">{totals.spend > 0 ? formatNum(totals.spend.toFixed(0)) : '—'}</td>
                <td className="war-td war-td--center">{totals.clicks > 0 ? formatNum(totals.clicks.toFixed(0)) : '—'}</td>
                <td className="war-td">{totals.sales > 0 ? formatNum(totals.sales.toFixed(0)) : '—'}</td>
                <td className={`war-td war-td--center${totalAcos !== null && parseFloat(totalAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                  {totalAcos !== null ? `${totalAcos}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="war-form-notes">
          <label className="war-label" htmlFor="war-notes">Notes (optional)</label>
          <textarea
            id="war-notes"
            className="war-textarea"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any observations, campaign notes, or context for this week…"
          />
        </div>

        <div className="war-form-actions">
          <button type="button" className="war-btn war-btn--ghost" onClick={handleClearForm}>
            Clear
          </button>
          <button
            type="button"
            className="war-btn war-btn--primary"
            onClick={handleSave}
            disabled={!startDate || !endDate}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Report
          </button>
        </div>
      </section>

      {/* ─── Live Preview ─── */}
      {totals.spend > 0 && (
        <section className="war-section">
          <h2 className="war-section__title">Live Preview</h2>
          <ReportTable rows={rows} title={title} dateLabel={dateLabel} />
        </section>
      )}

      {/* ─── History ─── */}
      <section className="war-section">
        <div className="war-section__row">
          <h2 className="war-section__title">Report History</h2>
          <span className="war-history-count">{history.length} {history.length === 1 ? 'report' : 'reports'}</span>
        </div>
        {history.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="war-history-list">
            {history.map((entry) => (
              <HistoryCard key={entry.id} entry={entry} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
