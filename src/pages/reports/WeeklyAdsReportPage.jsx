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

const DEFAULT_ROW = (overrides = {}) => ({ spend: '', clicks: '', sales: '', ...overrides })

const DEFAULT_ROWS = () =>
  Object.fromEntries(MARKETPLACES.map((m) => [m, DEFAULT_ROW()]))

function getMarketplaceNames(rows = {}) {
  return Object.keys(rows).filter(Boolean)
}

function isSalesOnlyRow(row = {}) {
  return row.salesOnly === true
}

function splitMarketplaceNames(rows = {}) {
  const names = getMarketplaceNames(rows)
  return {
    adMarketplaces: names.filter((name) => !isSalesOnlyRow(rows[name])),
    salesOnlyMarketplaces: names.filter((name) => isSalesOnlyRow(rows[name])),
  }
}

function calculateTotals(rows = {}, names = []) {
  return names.reduce((totals, name) => {
    const row = rows[name] || DEFAULT_ROW()
    return {
      spend: totals.spend + (parseFloat(row.spend) || 0),
      clicks: totals.clicks + (parseFloat(row.clicks) || 0),
      sales: totals.sales + (parseFloat(row.sales) || 0),
    }
  }, { spend: 0, clicks: 0, sales: 0 })
}

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

function EmptyDash() {
  return <span className="war-empty-dash">—</span>
}

function ReportTable({ rows, title, dateLabel }) {
  const { adMarketplaces, salesOnlyMarketplaces } = useMemo(() => splitMarketplaceNames(rows), [rows])
  const adTotals = useMemo(() => calculateTotals(rows, adMarketplaces), [adMarketplaces, rows])
  const salesOnlyTotals = useMemo(() => calculateTotals(rows, salesOnlyMarketplaces), [rows, salesOnlyMarketplaces])
  const grandTotals = useMemo(() => ({
    spend: adTotals.spend,
    clicks: adTotals.clicks,
    sales: adTotals.sales + salesOnlyTotals.sales,
  }), [adTotals, salesOnlyTotals])

  const adAcos = calcAcos(adTotals.spend, adTotals.sales)
  const totalAcos = calcAcos(grandTotals.spend, grandTotals.sales)
  const hasSalesOnlyRows = salesOnlyMarketplaces.length > 0

  return (
    <div className="war-preview">
      <div className="war-preview__head">
        <span className="war-preview__title">{title || 'Ads Spend Weekly Report'}</span>
        <div className="war-preview__divider" aria-hidden />
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
            {adMarketplaces.map((m) => {
              const r = rows[m] || DEFAULT_ROW()
              const acos = calcAcos(r.spend, r.sales)
              const isDanger = acos !== null && parseFloat(acos) > ACOS_THRESHOLD
              return (
                <tr key={m} className="war-tr">
                  <td className="war-td war-td--name">{m}</td>
                  <td className="war-td">{r.spend ? formatNum(r.spend) : <EmptyDash />}</td>
                  <td className="war-td war-td--center">{r.clicks ? formatNum(r.clicks) : <EmptyDash />}</td>
                  <td className="war-td">{r.sales ? formatNum(r.sales) : <EmptyDash />}</td>
                  <td className={`war-td war-td--center${isDanger ? ' war-td--danger' : ''}`}>
                    {acos !== null ? `${acos}%` : <EmptyDash />}
                  </td>
                </tr>
              )
            })}
            {hasSalesOnlyRows ? (
              <tr className="war-tr war-tr--subtotal">
                <td className="war-td war-td--name">SUBTOTAL</td>
                <td className="war-td">{formatNum(adTotals.spend.toFixed(0))}</td>
                <td className="war-td war-td--center">{formatNum(adTotals.clicks.toFixed(0))}</td>
                <td className="war-td">{formatNum(adTotals.sales.toFixed(0))}</td>
                <td className={`war-td war-td--center${adAcos !== null && parseFloat(adAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                  {adAcos !== null ? `${adAcos}%` : <EmptyDash />}
                </td>
              </tr>
            ) : null}
            {salesOnlyMarketplaces.map((m) => {
              const r = rows[m] || DEFAULT_ROW({ salesOnly: true })
              return (
                <tr key={m} className="war-tr war-tr--sales-only">
                  <td className="war-td war-td--name">{m}</td>
                  <td className="war-td"><EmptyDash /></td>
                  <td className="war-td war-td--center"><EmptyDash /></td>
                  <td className="war-td">{r.sales ? formatNum(r.sales) : <EmptyDash />}</td>
                  <td className="war-td war-td--center"><EmptyDash /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="war-tr war-tr--total">
              <td className="war-td war-td--name">{hasSalesOnlyRows ? 'GRAND TOTAL' : 'TOTAL'}</td>
              <td className="war-td">{hasSalesOnlyRows ? <EmptyDash /> : formatNum(grandTotals.spend.toFixed(0))}</td>
              <td className="war-td war-td--center">{hasSalesOnlyRows ? <EmptyDash /> : formatNum(grandTotals.clicks.toFixed(0))}</td>
              <td className="war-td">{formatNum(grandTotals.sales.toFixed(0))}</td>
              <td className={`war-td war-td--center${totalAcos !== null && parseFloat(totalAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                {hasSalesOnlyRows ? <EmptyDash /> : totalAcos !== null ? `${totalAcos}%` : <EmptyDash />}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function HistoryCard({ entry, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const { adMarketplaces, salesOnlyMarketplaces } = useMemo(() => splitMarketplaceNames(entry.rows), [entry.rows])

  const adTotals = useMemo(() => calculateTotals(entry.rows, adMarketplaces), [adMarketplaces, entry.rows])
  const salesOnlyTotals = useMemo(() => calculateTotals(entry.rows, salesOnlyMarketplaces), [entry.rows, salesOnlyMarketplaces])
  const totals = useMemo(() => ({
    spend: adTotals.spend,
    clicks: adTotals.clicks,
    sales: adTotals.sales + salesOnlyTotals.sales,
  }), [adTotals, salesOnlyTotals])

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
            className="war-history-card__edit"
            title="Edit this report"
            onClick={(e) => { e.stopPropagation(); onEdit(entry) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
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
  const [editingId, setEditingId] = useState(null)

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
  const [newMarketplace, setNewMarketplace] = useState('')
  const [marketplaceError, setMarketplaceError] = useState('')
  const [newSalesOnlyMarketplace, setNewSalesOnlyMarketplace] = useState('')
  const [salesOnlyMarketplaceError, setSalesOnlyMarketplaceError] = useState('')

  const updateRow = useCallback((marketplace, field, value) => {
    setRows((prev) => {
      const existingRow = prev[marketplace] || DEFAULT_ROW()
      return {
        ...prev,
        [marketplace]: { ...existingRow, [field]: value },
      }
    })
    setSaved(false)
  }, [])

  const removeMarketplace = useCallback((marketplace) => {
    setRows((prev) => {
      const next = { ...prev }
      delete next[marketplace]
      return next
    })
    setSaved(false)
  }, [])

  const { adMarketplaces, salesOnlyMarketplaces } = useMemo(() => splitMarketplaceNames(rows), [rows])
  const marketplaceNames = useMemo(() => [...adMarketplaces, ...salesOnlyMarketplaces], [adMarketplaces, salesOnlyMarketplaces])

  const handleAddMarketplace = useCallback(() => {
    const name = newMarketplace.trim().replace(/\s+/g, ' ')
    if (!name) {
      setMarketplaceError('Enter marketplace name')
      return
    }
    if (marketplaceNames.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setMarketplaceError('Marketplace already exists')
      return
    }
    setRows((prev) => ({ ...prev, [name]: DEFAULT_ROW() }))
    setNewMarketplace('')
    setMarketplaceError('')
    setSaved(false)
  }, [marketplaceNames, newMarketplace])

  const handleAddSalesOnlyMarketplace = useCallback(() => {
    const name = newSalesOnlyMarketplace.trim().replace(/\s+/g, ' ')
    if (!name) {
      setSalesOnlyMarketplaceError('Enter marketplace name')
      return
    }
    if (marketplaceNames.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setSalesOnlyMarketplaceError('Marketplace already exists')
      return
    }
    setRows((prev) => ({ ...prev, [name]: DEFAULT_ROW({ salesOnly: true }) }))
    setNewSalesOnlyMarketplace('')
    setSalesOnlyMarketplaceError('')
    setSaved(false)
  }, [marketplaceNames, newSalesOnlyMarketplace])

  const adTotals = useMemo(() => calculateTotals(rows, adMarketplaces), [adMarketplaces, rows])
  const salesOnlyTotals = useMemo(() => calculateTotals(rows, salesOnlyMarketplaces), [rows, salesOnlyMarketplaces])
  const totals = useMemo(() => ({
    spend: adTotals.spend,
    clicks: adTotals.clicks,
    sales: adTotals.sales + salesOnlyTotals.sales,
  }), [adTotals, salesOnlyTotals])

  const adAcos = calcAcos(adTotals.spend, adTotals.sales)
  const totalAcos = calcAcos(totals.spend, totals.sales)

  const beginCreateNew = useCallback(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    const newStart = d.toISOString().slice(0, 10)
    const d2 = new Date(d)
    d2.setDate(d.getDate() + 6)
    const newEnd = d2.toISOString().slice(0, 10)

    setEditingId(null)
    setTitle('Ads Spend Weekly Report')
    setStartDate(newStart)
    setEndDate(newEnd)
    setRows(DEFAULT_ROWS())
    setNotes('')
    setSaved(false)
    setNewMarketplace('')
    setMarketplaceError('')
    setNewSalesOnlyMarketplace('')
    setSalesOnlyMarketplaceError('')
  }, [])

  const handleEdit = useCallback((entry) => {
    setEditingId(entry.id)
    setTitle(entry.title || 'Ads Spend Weekly Report')
    setStartDate(entry.startDate || todayStr())
    setEndDate(entry.endDate || todayStr())
    setRows(JSON.parse(JSON.stringify(entry.rows || DEFAULT_ROWS())))
    setNotes(entry.notes || '')
    setSaved(false)
    setNewMarketplace('')
    setMarketplaceError('')
    setNewSalesOnlyMarketplace('')
    setSalesOnlyMarketplaceError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handleSave = () => {
    const entryId = editingId || Date.now().toString()
    const entry = {
      id: entryId,
      title,
      startDate,
      endDate,
      rows: JSON.parse(JSON.stringify(rows)),
      notes,
      savedAt: new Date().toISOString(),
    }
    const updated = editingId
      ? history.map((h) => (h.id === editingId ? entry : h))
      : [entry, ...history]
    setHistory(updated)
    saveHistory(updated)
    setEditingId(null)
    setSaved(true)
    // Reset form to next week only for new entries
    if (!editingId) {
      const nextStart = addDays(endDate, 1)
      const nextEnd = addDays(endDate, 7)
      setStartDate(nextStart)
      setEndDate(nextEnd)
      setRows(DEFAULT_ROWS())
      setNotes('')
      setNewMarketplace('')
      setMarketplaceError('')
      setNewSalesOnlyMarketplace('')
      setSalesOnlyMarketplaceError('')
    }
    setTimeout(() => setSaved(false), 3000)
  }

  const handleDelete = useCallback((id) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id)
      saveHistory(updated)
      return updated
    })
    if (editingId === id) {
      beginCreateNew()
    }
  }, [editingId, beginCreateNew])

  const handleClearForm = () => {
    setRows(DEFAULT_ROWS())
    setNotes('')
    setEditingId(null)
    setSaved(false)
    setNewMarketplace('')
    setMarketplaceError('')
    setNewSalesOnlyMarketplace('')
    setSalesOnlyMarketplaceError('')
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
        <h2 className="war-section__title">{editingId ? 'Edit Weekly Report' : 'New Weekly Report'}</h2>

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
              {adMarketplaces.map((m) => {
                const r = rows[m] || DEFAULT_ROW()
                const acos = calcAcos(r.spend, r.sales)
                const isDanger = acos !== null && parseFloat(acos) > ACOS_THRESHOLD
                return (
                  <tr key={m} className="war-tr war-tr--input">
                    <td className="war-td war-td--name">
                      <span className="war-marketplace-name">
                        <span>{m}</span>
                        <button
                          type="button"
                          className="war-marketplace-remove"
                          onClick={() => removeMarketplace(m)}
                          aria-label={`Remove ${m}`}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                    <td className="war-td">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="war-cell-input"
                        value={r.spend ?? ''}
                        onChange={(e) => updateRow(m, 'spend', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} ads spend`}
                      />
                    </td>
                    <td className="war-td war-td--center">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="war-cell-input war-cell-input--center"
                        value={r.clicks ?? ''}
                        onChange={(e) => updateRow(m, 'clicks', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} clicks`}
                      />
                    </td>
                    <td className="war-td">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="war-cell-input"
                        value={r.sales ?? ''}
                        onChange={(e) => updateRow(m, 'sales', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} net sales`}
                      />
                    </td>
                    <td className={`war-td war-td--center war-td--acos-calc${isDanger ? ' war-td--danger' : ''}`}>
                      {acos !== null ? `${acos}%` : <EmptyDash />}
                    </td>
                  </tr>
                )
              })}
              {salesOnlyMarketplaces.length > 0 ? (
                <tr className="war-tr war-tr--subtotal">
                  <td className="war-td war-td--name">SUBTOTAL</td>
                  <td className="war-td">{adTotals.spend > 0 ? formatNum(adTotals.spend.toFixed(0)) : <EmptyDash />}</td>
                  <td className="war-td war-td--center">{adTotals.clicks > 0 ? formatNum(adTotals.clicks.toFixed(0)) : <EmptyDash />}</td>
                  <td className="war-td">{adTotals.sales > 0 ? formatNum(adTotals.sales.toFixed(0)) : <EmptyDash />}</td>
                  <td className={`war-td war-td--center${adAcos !== null && parseFloat(adAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                    {adAcos !== null ? `${adAcos}%` : <EmptyDash />}
                  </td>
                </tr>
              ) : null}
              {salesOnlyMarketplaces.map((m) => {
                const r = rows[m] || DEFAULT_ROW({ salesOnly: true })
                return (
                  <tr key={m} className="war-tr war-tr--input war-tr--sales-only">
                    <td className="war-td war-td--name">
                      <span className="war-marketplace-name">
                        <span>{m}</span>
                        <button
                          type="button"
                          className="war-marketplace-remove"
                          onClick={() => removeMarketplace(m)}
                          aria-label={`Remove ${m}`}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                    <td className="war-td"><EmptyDash /></td>
                    <td className="war-td war-td--center"><EmptyDash /></td>
                    <td className="war-td">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="war-cell-input"
                        value={r.sales ?? ''}
                        onChange={(e) => updateRow(m, 'sales', e.target.value)}
                        placeholder="0"
                        aria-label={`${m} net sales`}
                      />
                    </td>
                    <td className="war-td war-td--center war-td--acos-calc"><EmptyDash /></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="war-tr war-tr--total">
                <td className="war-td war-td--name">{salesOnlyMarketplaces.length > 0 ? 'GRAND TOTAL' : 'TOTAL'}</td>
                <td className="war-td">{salesOnlyMarketplaces.length > 0 ? <EmptyDash /> : totals.spend > 0 ? formatNum(totals.spend.toFixed(0)) : <EmptyDash />}</td>
                <td className="war-td war-td--center">{salesOnlyMarketplaces.length > 0 ? <EmptyDash /> : totals.clicks > 0 ? formatNum(totals.clicks.toFixed(0)) : <EmptyDash />}</td>
                <td className="war-td">{totals.sales > 0 ? formatNum(totals.sales.toFixed(0)) : <EmptyDash />}</td>
                <td className={`war-td war-td--center${totalAcos !== null && parseFloat(totalAcos) > ACOS_THRESHOLD ? ' war-td--danger' : ''}`}>
                  {salesOnlyMarketplaces.length > 0 ? <EmptyDash /> : totalAcos !== null ? `${totalAcos}%` : <EmptyDash />}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="war-marketplace-add">
          <div className="war-form-field">
            <label className="war-label" htmlFor="war-new-marketplace">Add marketplace</label>
            <input
              id="war-new-marketplace"
              type="text"
              className="war-input"
              value={newMarketplace}
              onChange={(e) => {
                setNewMarketplace(e.target.value)
                if (marketplaceError) setMarketplaceError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddMarketplace()
                }
              }}
              placeholder="e.g. Meta Ads, Google Ads, Carrefour"
            />
            {marketplaceError && <span className="war-marketplace-add__error">{marketplaceError}</span>}
          </div>
          <button type="button" className="war-btn war-btn--ghost" onClick={handleAddMarketplace}>
            Add marketplace
          </button>
        </div>

        <div className="war-marketplace-add war-marketplace-add--sales-only">
          <div className="war-form-field">
            <label className="war-label" htmlFor="war-new-sales-only-marketplace">Add marketplace without ad spend</label>
            <input
              id="war-new-sales-only-marketplace"
              type="text"
              className="war-input"
              value={newSalesOnlyMarketplace}
              onChange={(e) => {
                setNewSalesOnlyMarketplace(e.target.value)
                if (salesOnlyMarketplaceError) setSalesOnlyMarketplaceError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddSalesOnlyMarketplace()
                }
              }}
              placeholder="e.g. Website organic, Retail sales, POS"
            />
            {salesOnlyMarketplaceError && <span className="war-marketplace-add__error">{salesOnlyMarketplaceError}</span>}
          </div>
          <button type="button" className="war-btn war-btn--ghost" onClick={handleAddSalesOnlyMarketplace}>
            Add after subtotal
          </button>
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
          {editingId && (
            <button type="button" className="war-btn war-btn--ghost" onClick={beginCreateNew}>
              Cancel Edit
            </button>
          )}
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
            {editingId ? 'Update Report' : 'Save Report'}
          </button>
        </div>
      </section>

      {/* ─── Live Preview ─── */}
      {(totals.spend > 0 || totals.sales > 0) && (
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
              <HistoryCard key={entry.id} entry={entry} onDelete={handleDelete} onEdit={handleEdit} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
