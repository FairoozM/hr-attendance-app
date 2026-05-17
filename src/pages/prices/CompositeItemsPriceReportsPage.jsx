import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import '../Page.css'
import '../management/DocumentExpiryPage.css'
import '../management/AllPricesPage.css'
import './CompositeItemsPricesPage.css'
import {
  fmtMoney,
  fmtPct,
} from '../management/allPricesEcommerceUtils'
import { PREF_ALL_PRICES_EC } from '../../constants/userPreferenceKeys'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import {
  buildPurchasePriceMap,
  resolveCompositeComponentPricing,
} from './compositeComponentPricingResolver'

const DEFAULT_RATES = {
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

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

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

function computeParentPricing(item, shippingValue) {
  const purchase = Number(item?.purchase_price ?? item?.parent?.purchase_price)
  const shipping = Number(shippingValue)
  const components = Array.isArray(item?.components) ? item.components : []
  const hasMissing = components.some((component) => component.match_status !== 'matched')
  const missingShipping = shippingValue === '' || shippingValue == null || !Number.isFinite(shipping)
  const missingPurchase = !Number.isFinite(purchase) || purchase <= 0

  const base = {
    purchase_price: Number.isFinite(purchase) ? purchase : null,
    manual_shipping: missingShipping ? null : shipping,
    missing_shipping: missingShipping,
    missing_component_price: hasMissing || missingPurchase,
  }

  if (missingShipping || hasMissing || missingPurchase) {
    return {
      ...base,
      suggested_sales_price: null,
      vat_5_percent: null,
      commission_15_percent: null,
      advertising_15_percent: null,
      total_cost: null,
      profit: null,
      profit_percent_of_sales: null,
      pricing_status: 'incomplete',
    }
  }

  const divisor = 1 - toDec(DEFAULT_RATES.vatPct) - toDec(DEFAULT_RATES.commissionPct) - toDec(DEFAULT_RATES.advertisingPct) - toDec(DEFAULT_RATES.requiredProfitPct)
  const sales = Math.ceil((purchase + shipping) / divisor)
  const vat = sales * toDec(DEFAULT_RATES.vatPct)
  const commission = sales * toDec(DEFAULT_RATES.commissionPct)
  const advertising = sales * toDec(DEFAULT_RATES.advertisingPct)
  const totalCost = purchase + shipping + vat + commission + advertising
  const profit = sales - totalCost

  return {
    ...base,
    suggested_sales_price: sales,
    vat_5_percent: vat,
    commission_15_percent: commission,
    advertising_15_percent: advertising,
    total_cost: totalCost,
    profit,
    profit_percent_of_sales: sales > 0 ? (profit / sales) * 100 : 0,
    pricing_status: 'complete',
  }
}

function matchStatusLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'matched') return 'MATCHED'
  if (s === 'ambiguous') return 'DUPLICATE / AMBIGUOUS'
  return 'MISSING'
}

function mergeResolvedComponentPricing(component, allPricesMap, rates) {
  const resolved = resolveCompositeComponentPricing(component, allPricesMap, rates)
  if (!resolved.matchedAllPricesRecordFound) {
    return {
      ...component,
      match_status: resolved.matchStatus,
      possible_matches: resolved.possibleMatches,
      resolved_pricing: resolved,
    }
  }
  return {
    ...component,
    matched_all_prices_item_no: resolved.matchedAllPricesItemNo,
    matched_all_prices_sku: resolved.matchedAllPricesSku,
    matched_purchase_price: resolved.purchasePrice,
    line_total: resolved.linePurchaseTotal,
    match_status: resolved.matchStatus,
    match_key_used: resolved.matchKeyUsed,
    match_kind: resolved.matchKind,
    date_of_prices: resolved.dateOfPrice,
    all_prices: {
      item_no: resolved.matchedAllPricesItemNo,
      sku: resolved.matchedAllPricesSku,
      sales_price: resolved.salesPriceAed,
      vat_5_percent: resolved.vat5,
      commission_15_percent: resolved.commission15,
      advertising_15_percent: resolved.advertising15,
      shipping: resolved.shipping,
      purchase_price: resolved.purchasePrice,
      total_cost: resolved.totalCost,
      profit: resolved.profitAed,
      profit_percent_of_sales: resolved.profitPercent,
      pricing_status: resolved.pricingStatus,
      date_of_price: resolved.dateOfPrice,
      source_record: resolved.matchedAllPricesRecord,
    },
    resolved_pricing: resolved,
  }
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
            <th scope="col">Matched All Prices SKU</th>
            <th scope="col">Sales Price AED</th>
            <th scope="col">5% VAT</th>
            <th scope="col">15% Commission</th>
            <th scope="col">15% Advertising</th>
            <th scope="col">Shipping</th>
            <th scope="col">Purchase Price</th>
            <th scope="col">Line Purchase Total</th>
            <th scope="col">Total Cost</th>
            <th scope="col">Profit AED</th>
            <th scope="col">Profit %</th>
            <th scope="col">Pricing Status</th>
            <th scope="col">Date of Price</th>
            <th scope="col">Match Status</th>
            <th scope="col">Zoho Purchase Rate Reference</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={19} className="cb-report-empty-cell">No component details were saved for this row.</td>
            </tr>
          ) : rows.map((row, idx) => (
            <tr key={`${item.composite_item_id}-${row.item_id || row.sku || idx}`} className={row.match_status !== 'matched' ? 'cb-report-row--warning' : ''}>
              {(() => {
                const allPrices = row.all_prices || {}
                return (
                  <>
              <td>{row.sku || '—'}</td>
              <td>{row.name || '—'}</td>
              <td>{Number.isFinite(Number(row.quantity)) ? String(row.quantity) : '—'}</td>
              <td>{row.matched_all_prices_item_no || '—'}</td>
              <td>{row.matched_all_prices_sku || allPrices.sku || '—'}</td>
              <td className="cb-sales-price-cell">{allPrices.sales_price != null ? fmtMoney(allPrices.sales_price, 0) : '—'}</td>
              <td>{allPrices.vat_5_percent != null ? fmtMoney(allPrices.vat_5_percent, 2) : '—'}</td>
              <td>{allPrices.commission_15_percent != null ? fmtMoney(allPrices.commission_15_percent, 2) : '—'}</td>
              <td>{allPrices.advertising_15_percent != null ? fmtMoney(allPrices.advertising_15_percent, 2) : '—'}</td>
              <td>{allPrices.shipping != null ? fmtMoney(allPrices.shipping, 2) : '—'}</td>
              <td>{allPrices.purchase_price != null ? fmtMoney(allPrices.purchase_price, 2) : '—'}</td>
              <td>{row.line_total != null ? fmtMoney(row.line_total, 2) : '—'}</td>
              <td>{allPrices.total_cost != null ? fmtMoney(allPrices.total_cost, 2) : '—'}</td>
              <td>{allPrices.profit != null ? fmtMoney(allPrices.profit, 2) : '—'}</td>
              <td className="cb-profit-percent-cell">{allPrices.profit_percent_of_sales != null ? fmtPct(allPrices.profit_percent_of_sales, 2) : '—'}</td>
              <td>
                <span className={allPrices.pricing_status === 'complete' ? 'cb-report-pill cb-report-pill--ok' : 'cb-report-pill cb-report-pill--warn'}>
                  {allPrices.pricing_status || 'incomplete'}
                </span>
              </td>
              <td>{allPrices.date_of_price || row.date_of_prices || '—'}</td>
              <td>
                <span className={row.match_status === 'matched' ? 'cb-report-pill cb-report-pill--ok' : 'cb-report-pill cb-report-pill--warn'}>
                  {matchStatusLabel(row.match_status)}
                </span>
              </td>
              <td>{row.zoho_purchase_rate != null ? fmtMoney(row.zoho_purchase_rate, 2) : '—'}</td>
                  </>
                )
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CompositeItemsPriceReportsPage() {
  const { ready: prefsReady, getPref, prefsVersion } = useUserPreferences()
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [loadingReports, setLoadingReports] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const [shippingByItemId, setShippingByItemId] = useState({})
  const [savingByItemId, setSavingByItemId] = useState({})
  const [filters, setFilters] = useState({
    family: '',
    composite: '',
    component: '',
    status: 'all',
  })

  const allPricesBundle = useMemo(() => {
    void prefsVersion
    const bundle = getPref(PREF_ALL_PRICES_EC, null)
    return bundle && typeof bundle === 'object' ? bundle : {}
  }, [getPref, prefsVersion])

  const allPricesRows = useMemo(() => (
    Array.isArray(allPricesBundle.rows) ? allPricesBundle.rows : []
  ), [allPricesBundle])

  const allPricesRates = useMemo(() => (
    allPricesBundle.rates && typeof allPricesBundle.rates === 'object'
      ? { ...DEFAULT_RATES, ...allPricesBundle.rates }
      : { ...DEFAULT_RATES }
  ), [allPricesBundle])

  const allPricesMap = useMemo(() => buildPurchasePriceMap(allPricesRows), [allPricesRows])

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
      const initialShipping = {}
      for (const item of Array.isArray(data?.items) ? data.items : []) {
        const key = String(item.id || item.composite_item_id)
        const shipping = item.parent?.manual_shipping ?? item.shipping
        initialShipping[key] = shipping != null ? String(shipping) : ''
      }
      setShippingByItemId(initialShipping)
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
        const components = Array.isArray(item.components)
          ? item.components.map((component) => mergeResolvedComponentPricing(component, allPricesMap, allPricesRates))
          : []
        const purchasePrice = components.reduce((sum, component) => (
          sum + (Number.isFinite(Number(component.line_total)) ? Number(component.line_total) : 0)
        ), 0)
        const rowId = String(item.id || item.composite_item_id)
        const shippingValue = shippingByItemId[rowId] ?? ''
        const enrichedItem = {
          ...item,
          purchase_price: purchasePrice,
          components,
        }
        const parent = computeParentPricing(enrichedItem, shippingValue)
        return {
          ...enrichedItem,
          workspaceParent: parent,
          shippingValue,
        }
      })
      .sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')))
  }, [selectedReport, shippingByItemId, allPricesMap, allPricesRates])

  const familyOptions = useMemo(() => {
    const set = new Set()
    for (const item of detailItems) {
      const family = String(item.family || '').trim()
      if (family) set.add(family)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [detailItems])

  const filteredItems = useMemo(() => {
    const compositeQ = filters.composite.trim().toLowerCase()
    const componentQ = filters.component.trim().toLowerCase()
    const familyQ = filters.family.trim().toLowerCase()
    return detailItems.filter((item) => {
      const parent = item.workspaceParent || {}
      const components = Array.isArray(item.components) ? item.components : []
      if (familyQ && String(item.family || '').trim().toLowerCase() !== familyQ) return false
      if (compositeQ) {
        const haystack = `${item.sku || ''} ${item.name || ''}`.toLowerCase()
        if (!haystack.includes(compositeQ)) return false
      }
      if (componentQ) {
        const hasComponent = components.some((component) => (
          `${component.sku || ''} ${component.name || ''} ${component.matched_all_prices_item_no || ''}`
            .toLowerCase()
            .includes(componentQ)
        ))
        if (!hasComponent) return false
      }
      if (filters.status === 'complete') return parent.pricing_status === 'complete'
      if (filters.status === 'incomplete') return parent.pricing_status !== 'complete'
      if (filters.status === 'missing_component_price') return parent.missing_component_price
      if (filters.status === 'missing_shipping') return parent.missing_shipping
      return true
    })
  }, [detailItems, filters])

  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount])

  const remainingItems = Math.max(filteredItems.length - visibleCount, 0)

  const saveParentPrice = useCallback(async (item) => {
    const rowId = String(item.id || item.composite_item_id)
    const shippingValue = shippingByItemId[rowId]
    setError('')
    setMessage('')
    setSavingByItemId((prev) => ({ ...prev, [rowId]: true }))
    try {
      const data = await api.post(
        `/api/prices/composite-items/reports/${encodeURIComponent(String(selectedReport.report.id))}/items/${encodeURIComponent(String(item.id))}/save-parent-price`,
        {
          manualShipping: Number(shippingValue),
          dateOfPrice: new Date().toISOString().slice(0, 10),
        }
      )
      setSelectedReport((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((current) => {
            if (String(current.id) !== String(item.id)) return current
            return {
              ...current,
              parent: data.parent,
              saved_parent_price: data.saved_parent_price,
              sales_price: data.parent?.suggested_sales_price ?? current.sales_price,
              vat_5_percent: data.parent?.vat_5_percent ?? current.vat_5_percent,
              commission_15_percent: data.parent?.commission_15_percent ?? current.commission_15_percent,
              advertising_15_percent: data.parent?.advertising_15_percent ?? current.advertising_15_percent,
              shipping: data.parent?.manual_shipping ?? current.shipping,
              total_cost: data.parent?.total_cost ?? current.total_cost,
              profit: data.parent?.profit ?? current.profit,
              profit_percent_of_sales: data.parent?.profit_percent_of_sales ?? current.profit_percent_of_sales,
              pricing_status: data.parent?.pricing_status ?? current.pricing_status,
            }
          }),
        }
      })
      setMessage(`Saved parent composite price for ${item.sku || item.name}.`)
    } catch (err) {
      setError(err?.message || 'Could not save parent composite price.')
    } finally {
      setSavingByItemId((prev) => ({ ...prev, [rowId]: false }))
    }
  }, [selectedReport, shippingByItemId])

  return (
    <div className="page composite-prices-page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Composite Items Price Reports</h1>
          <p className="doc-page-subtitle">
            Bulk composite pricing workspace: active Zoho bundles, component All Prices audit, and manual parent shipping.
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
        {selectedReport && !prefsReady ? (
          <p className="cb-bundle-warn" role="status">
            Loading All Prices list…
          </p>
        ) : null}
        {selectedReport && prefsReady && allPricesRows.length === 0 ? (
          <p className="cb-bundle-warn" role="status">
            All Prices list not loaded. Component pricing cannot be resolved.
          </p>
        ) : null}
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
                Report generated {formatReportDate(selectedReport.report?.generated_at)}. Showing {filteredItems.length} of {detailItems.length} composites.
              </p>
            </div>
          </div>
          <div className="cb-workspace-filters">
            <label>
              <span>Family</span>
              <select
                value={filters.family}
                onChange={(e) => {
                  setVisibleCount(50)
                  setFilters((prev) => ({ ...prev, family: e.target.value }))
                }}
              >
                <option value="">All families</option>
                {familyOptions.map((family) => (
                  <option key={family} value={family}>{family}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Composite search</span>
              <input
                type="search"
                value={filters.composite}
                onChange={(e) => {
                  setVisibleCount(50)
                  setFilters((prev) => ({ ...prev, composite: e.target.value }))
                }}
                placeholder="SKU or name"
              />
            </label>
            <label>
              <span>Component search</span>
              <input
                type="search"
                value={filters.component}
                onChange={(e) => {
                  setVisibleCount(50)
                  setFilters((prev) => ({ ...prev, component: e.target.value }))
                }}
                placeholder="Component SKU"
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(e) => {
                  setVisibleCount(50)
                  setFilters((prev) => ({ ...prev, status: e.target.value }))
                }}
              >
                <option value="all">All</option>
                <option value="complete">Complete</option>
                <option value="incomplete">Incomplete</option>
                <option value="missing_component_price">Missing component price</option>
                <option value="missing_shipping">Missing shipping</option>
              </select>
            </label>
          </div>
          <div className="ap-table-scroll cb-table-scroll">
            <table className="ap-ec-table cb-bundle-table cb-report-detail-table">
              <thead>
                <tr>
                  <th scope="col">Components</th>
                  <th scope="col">Composite Item No. / SKU</th>
                  <th scope="col">Composite Name</th>
                  <th scope="col">Family</th>
                  <th scope="col">Suggested Sales Price AED</th>
                  <th scope="col">5% VAT</th>
                  <th scope="col">15% Commission</th>
                  <th scope="col">15% Advertising</th>
                  <th scope="col">Manual Shipping</th>
                  <th scope="col">Purchase Price</th>
                  <th scope="col">Purchase + VAT + Comm. + Adv. + Shipping</th>
                  <th scope="col">Sales - Costs (Profit)</th>
                  <th scope="col">Profit % of Sales</th>
                  <th scope="col">Pricing Status</th>
                  <th scope="col">Date of Price</th>
                  <th scope="col">Save</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="cb-report-empty-cell">This report has no matching composite items.</td>
                  </tr>
                ) : visibleItems.map((item) => {
                  const rowId = String(item.id || item.composite_item_id)
                  const isOpen = expanded.has(rowId)
                  const parent = item.workspaceParent || {}
                  const canSave = parent.pricing_status === 'complete'
                  return (
                    <Fragment key={rowId}>
                      <tr className={parent.pricing_status !== 'complete' ? 'cb-report-row--warning' : ''}>
                        <td className="cb-saved-table__toggle">
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleExpanded(rowId)}>
                            {isOpen ? 'Hide' : 'Show'}
                          </button>
                        </td>
                        <td>{item.sku || '—'}</td>
                        <td>{item.name || '—'}</td>
                        <td>{item.family || '—'}</td>
                        <td className="cb-sales-price-cell">{parent.suggested_sales_price != null ? fmtMoney(parent.suggested_sales_price, 0) : '—'}</td>
                        <td>{parent.vat_5_percent != null ? fmtMoney(parent.vat_5_percent, 2) : '—'}</td>
                        <td>{parent.commission_15_percent != null ? fmtMoney(parent.commission_15_percent, 2) : '—'}</td>
                        <td>{parent.advertising_15_percent != null ? fmtMoney(parent.advertising_15_percent, 2) : '—'}</td>
                        <td>
                          <input
                            className="cb-bundle-summary__shipping-input"
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.shippingValue}
                            onChange={(e) => setShippingByItemId((prev) => ({ ...prev, [rowId]: e.target.value }))}
                            placeholder="0.00"
                            aria-label={`Manual shipping for ${item.sku || item.name}`}
                          />
                        </td>
                        <td>{parent.purchase_price != null ? fmtMoney(parent.purchase_price, 2) : '—'}</td>
                        <td>{parent.total_cost != null ? fmtMoney(parent.total_cost, 2) : '—'}</td>
                        <td>{parent.profit != null ? fmtMoney(parent.profit, 2) : '—'}</td>
                        <td className="cb-profit-percent-cell">{parent.profit_percent_of_sales != null ? fmtPct(parent.profit_percent_of_sales, 2) : '—'}</td>
                        <td>
                          <span className={parent.pricing_status === 'complete' ? 'cb-report-pill cb-report-pill--ok' : 'cb-report-pill cb-report-pill--warn'}>
                            {parent.pricing_status}{parent.missing_shipping ? ' (shipping)' : parent.missing_component_price ? ' (component)' : ''}
                          </span>
                        </td>
                        <td>{item.saved_parent_price?.date_of_price || parent.date_of_price || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={!canSave || savingByItemId[rowId]}
                            onClick={() => saveParentPrice(item)}
                          >
                            {savingByItemId[rowId] ? 'Saving…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="cb-report-components-row">
                          <td colSpan={16}>
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

          {filteredItems.length > visibleCount ? (
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
