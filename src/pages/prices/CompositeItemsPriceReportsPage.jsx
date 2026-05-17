import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import '../Page.css'
import '../management/DocumentExpiryPage.css'
import '../management/AllPricesPage.css'
import './CompositeItemsPricesPage.css'
import { fmtMoney, fmtPct } from '../management/allPricesEcommerceUtils'

function formatReportDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function modeLabel(mode) {
  return String(mode || '').toLowerCase() === 'full' ? 'Full' : 'Incremental'
}

function statusClass(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'completed') return 'cb-report-status cb-report-status--complete'
  if (s === 'failed') return 'cb-report-status cb-report-status--failed'
  return 'cb-report-status cb-report-status--running'
}

function ComponentsTable({ item }) {
  const rows = Array.isArray(item.components) ? item.components : []
  return (
    <div className="ap-table-scroll cb-table-scroll cb-report-components">
      <table className="ap-ec-table cb-bundle-table">
        <thead>
          <tr>
            <th scope="col">Component SKU</th>
            <th scope="col">Component Name</th>
            <th scope="col">Quantity</th>
            <th scope="col">Matched All Prices Item No.</th>
            <th scope="col">Matched Purchase Price</th>
            <th scope="col">Line Total</th>
            <th scope="col">Match Status</th>
            <th scope="col">Zoho Purchase Rate Reference</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="cb-report-empty-cell">No component details were saved for this row.</td>
            </tr>
          ) : rows.map((row, idx) => (
            <tr key={`${item.composite_item_id}-${row.item_id || row.sku || idx}`} className={row.match_status !== 'matched' ? 'cb-report-row--warning' : ''}>
              <td>{row.sku || '—'}</td>
              <td>{row.name || '—'}</td>
              <td>{Number.isFinite(Number(row.quantity)) ? String(row.quantity) : '—'}</td>
              <td>{row.matched_all_prices_item_no || '—'}</td>
              <td>{row.matched_purchase_price != null ? fmtMoney(row.matched_purchase_price, 2) : '—'}</td>
              <td>{row.line_total != null ? fmtMoney(row.line_total, 2) : '—'}</td>
              <td>
                <span className={row.match_status === 'matched' ? 'cb-report-pill cb-report-pill--ok' : 'cb-report-pill cb-report-pill--warn'}>
                  {row.match_status || 'unmatched'}
                </span>
              </td>
              <td>{row.zoho_purchase_rate != null ? fmtMoney(row.zoho_purchase_rate, 2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CompositeItemsPriceReportsPage() {
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [loadingReports, setLoadingReports] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)

  const fetchReports = useCallback(async () => {
    setLoadingReports(true)
    setError('')
    try {
      const data = await api.get('/api/prices/composite-items/reports')
      setReports(Array.isArray(data?.reports) ? data.reports : [])
    } catch (err) {
      setError(err?.message || 'Could not load saved composite price reports.')
    } finally {
      setLoadingReports(false)
    }
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const hasRunningReport = useMemo(
    () => reports.some((report) => String(report.status || '').toLowerCase() === 'running'),
    [reports]
  )

  useEffect(() => {
    if (!hasRunningReport) return undefined
    const timer = window.setInterval(() => {
      fetchReports()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [fetchReports, hasRunningReport])

  const openReport = useCallback(async (reportId) => {
    setLoadingDetail(true)
    setError('')
    setExpanded(new Set())
    setVisibleCount(50)
    try {
      const data = await api.get(`/api/prices/composite-items/reports/${encodeURIComponent(String(reportId))}`)
      setSelectedReport(data)
    } catch (err) {
      setError(err?.message || 'Could not load this report.')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  const generateReport = useCallback(async () => {
    setGenerating(true)
    setError('')
    setMessage('')
    try {
      const data = await api.post('/api/prices/composite-items/reports/generate', {
        mode: 'full',
        force: true,
      })
      setMessage(
        data?.message || 'Composite price report generation started. Progress updates automatically while a report is running.'
      )
      await fetchReports()
      if (data?.report_id && String(data?.status || '').toLowerCase() !== 'running') {
        await openReport(data.report_id)
      }
    } catch (err) {
      setError(err?.message || 'Could not generate composite price report.')
    } finally {
      setGenerating(false)
    }
  }, [fetchReports, openReport])

  const deleteReport = useCallback(async (report) => {
    const label = `${modeLabel(report.mode)} report from ${formatReportDate(report.generated_at)}`
    if (!window.confirm(`Delete ${label}?`)) return
    setError('')
    setMessage('')
    try {
      await api.delete(`/api/prices/composite-items/reports/${encodeURIComponent(String(report.id))}`)
      setReports((prev) => prev.filter((item) => String(item.id) !== String(report.id)))
      if (String(selectedReport?.report?.id) === String(report.id)) {
        setSelectedReport(null)
        setExpanded(new Set())
      }
      setMessage('Composite price report deleted.')
    } catch (err) {
      setError(err?.message || 'Could not delete this report.')
    }
  }, [selectedReport])

  const toggleExpanded = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const detailItems = useMemo(() => {
    const rows = Array.isArray(selectedReport?.items) ? selectedReport.items : []
    return [...rows]
      .map((item) => {
        const latestDate = Array.isArray(item.components)
          ? item.components.map((c) => c.date_of_prices).filter(Boolean).sort().at(-1)
          : ''
        return {
          ...item,
          computedDateOfPrices: latestDate || '—',
        }
      })
      .sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')))
  }, [selectedReport])

  const visibleItems = useMemo(() => detailItems.slice(0, visibleCount), [detailItems, visibleCount])

  const remainingItems = Math.max(detailItems.length - visibleCount, 0)

  return (
    <div className="page composite-prices-page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Composite Items Price Reports</h1>
          <p className="doc-page-subtitle">
            Generate timestamped full pricing reports for all active Zoho composite items using All Prices purchase data.
          </p>
        </div>
      </div>

      <section className="page-section cb-bundle-section" aria-label="Composite item price report actions">
        <div className="cb-bundle-toolbar">
          <button type="button" className="btn btn--primary" disabled={generating} onClick={generateReport}>
            {generating ? 'Starting…' : 'Generate Full Report'}
          </button>
          <button type="button" className="btn btn--ghost" disabled={loadingReports} onClick={fetchReports}>
            {loadingReports ? 'Refreshing…' : 'Refresh Saved Reports'}
          </button>
        </div>
        {message ? <p className="cb-bundle-save-row__msg">{message}</p> : null}
        {error ? <p className="cb-bundle-error">{error}</p> : null}
      </section>

      <section className="page-section cb-bundle-section" aria-label="Saved composite item price reports">
        <div className="ap-ec-paste__head">
          <div>
            <h3>Saved Reports</h3>
            <p className="ap-ec-paste__hint">
              Full reports recalculate every active Zoho composite item and save a timestamped pricing snapshot.
            </p>
          </div>
        </div>
        <div className="ap-table-scroll cb-table-scroll">
          <table className="ap-ec-table cb-bundle-table cb-report-list-table">
            <thead>
              <tr>
                <th scope="col">Report Date/Time</th>
                <th scope="col">Mode</th>
                <th scope="col">Total Composite Items Seen</th>
                <th scope="col">Processed</th>
                <th scope="col">Complete</th>
                <th scope="col">Incomplete</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="cb-report-empty-cell">
                    {loadingReports ? 'Loading saved reports…' : 'No saved composite price reports yet. Generate a report to start.'}
                  </td>
                </tr>
              ) : reports.map((report) => (
                <tr key={report.id}>
                  <td>{formatReportDate(report.generated_at)}</td>
                  <td>{modeLabel(report.mode)}</td>
                  <td>{report.total_composites_seen ?? 0}</td>
                  <td>{report.total_items_processed ?? report.total_new_composites_processed ?? 0}</td>
                  <td>{report.total_complete ?? 0}</td>
                  <td>{report.total_incomplete ?? 0}</td>
                  <td><span className={statusClass(report.status)}>{report.status}</span></td>
                  <td>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={loadingDetail} onClick={() => openReport(report.id)}>
                      View
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => deleteReport(report)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedReport ? (
        <section className="page-section cb-bundle-section" aria-label="Composite item price report detail">
          <div className="ap-ec-paste__head">
            <div>
              <h3>{selectedReport.report?.report_name || 'Composite Items Price Report'}</h3>
              <p className="ap-ec-paste__hint">
                Report generated {formatReportDate(selectedReport.report?.generated_at)}.
              </p>
            </div>
          </div>
          <div className="ap-table-scroll cb-table-scroll">
            <table className="ap-ec-table cb-bundle-table cb-report-detail-table">
              <thead>
                <tr>
                  <th scope="col">Components</th>
                  <th scope="col">Item No. / SKU</th>
                  <th scope="col">Composite Name</th>
                  <th scope="col">Sales Price (AED)</th>
                  <th scope="col">5% VAT</th>
                  <th scope="col">15% Commission</th>
                  <th scope="col">15% Advertising</th>
                  <th scope="col">Shipping</th>
                  <th scope="col">Purchase Price</th>
                  <th scope="col">Purchase + VAT + Comm. + Adv. + Shipping</th>
                  <th scope="col">Sales - Costs (Profit)</th>
                  <th scope="col">Profit % of Sales</th>
                  <th scope="col">Pricing Status</th>
                  <th scope="col">Date of Prices</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="cb-report-empty-cell">This report has no processed composite items.</td>
                  </tr>
                ) : visibleItems.map((item) => {
                  const rowId = String(item.id || item.composite_item_id)
                  const isOpen = expanded.has(rowId)
                  return (
                    <Fragment key={rowId}>
                      <tr className={item.pricing_status !== 'complete' ? 'cb-report-row--warning' : ''}>
                        <td className="cb-saved-table__toggle">
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleExpanded(rowId)}>
                            {isOpen ? 'Hide' : 'Show'}
                          </button>
                        </td>
                        <td>{item.sku || '—'}</td>
                        <td>{item.name || '—'}</td>
                        <td className="cb-sales-price-cell">{item.sales_price != null ? fmtMoney(item.sales_price, 0) : '—'}</td>
                        <td>{item.vat_5_percent != null ? fmtMoney(item.vat_5_percent, 2) : '—'}</td>
                        <td>{item.commission_15_percent != null ? fmtMoney(item.commission_15_percent, 2) : '—'}</td>
                        <td>{item.advertising_15_percent != null ? fmtMoney(item.advertising_15_percent, 2) : '—'}</td>
                        <td>{item.shipping != null ? fmtMoney(item.shipping, 2) : '—'}</td>
                        <td>{item.purchase_price != null ? fmtMoney(item.purchase_price, 2) : '—'}</td>
                        <td>{item.total_cost != null ? fmtMoney(item.total_cost, 2) : '—'}</td>
                        <td>{item.profit != null ? fmtMoney(item.profit, 2) : '—'}</td>
                        <td className="cb-profit-percent-cell">{item.profit_percent_of_sales != null ? fmtPct(item.profit_percent_of_sales, 1) : '—'}</td>
                        <td>
                          <span className={item.pricing_status === 'complete' ? 'cb-report-pill cb-report-pill--ok' : 'cb-report-pill cb-report-pill--warn'}>
                            {item.pricing_status}{item.unmatched_components_count ? ` (${item.unmatched_components_count})` : ''}
                          </span>
                        </td>
                        <td>{item.computedDateOfPrices}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="cb-report-components-row">
                          <td colSpan={14}>
                            <ComponentsTable item={item} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {detailItems.length > visibleCount ? (
            <div className="cb-report-show-more">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setVisibleCount((prev) => prev + 100)}
              >
                Show More Items ({remainingItems} remaining)
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
