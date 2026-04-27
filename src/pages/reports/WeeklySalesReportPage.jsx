import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fetchBinary, downloadBlob } from '../../api/client'
import { useWeeklySalesReport } from '../../hooks/useWeeklySalesReport'
import { ZOHO_REP_IMAGE_QUERY_VERSION } from '../../config/zohoRepImageVersion'
import {
  getCachedZohoItemBlob,
  setCachedZohoItemBlob,
  ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED,
} from '../../utils/zohoWeeklyItemImageCache'
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

function sumBy(rows, key) {
  return (rows || []).reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0)
}

/**
 * Splits Zoho item-detail API rows into drawer table buckets
 * (same non-zero filter rules as the legacy single-list drawer).
 */
function itemDetailsToDrawerSections(list) {
  const rows = Array.isArray(list) ? list : []
  return {
    opening:  rows.filter((r) => (Number(r.opening_qty)  || 0) > 0),
    purchase: rows.filter((r) => (Number(r.purchase_qty) || 0) > 0),
    returned: rows.filter((r) => (Number(r.returned_qty) || 0) > 0),
    closing:  rows.filter((r) => (Number(r.closing_qty)  || 0) > 0),
    sales:    rows.filter((r) => (Number(r.sold_qty)     || 0) > 0),
  }
}

function normalizeWarehouseId(v) {
  return v == null || String(v).trim() === '' ? '' : String(v).trim()
}

function fallbackWarehouseLabel(warehouseId) {
  const id = normalizeWarehouseId(warehouseId)
  return id || 'All'
}

function parseFamilyDetailsWarehouses(data, fallbackWarehouse) {
  if (Array.isArray(data?.warehouses) && data.warehouses.length > 0) {
    return data.warehouses.map((w) => ({
      warehouse_id: normalizeWarehouseId(w?.warehouse_id || fallbackWarehouse?.warehouse_id),
      warehouse_name: w?.warehouse_name || fallbackWarehouse?.warehouse_name || fallbackWarehouseLabel(w?.warehouse_id),
      items: Array.isArray(w?.items) ? w.items : [],
    }))
  }
  return [{
    warehouse_id: normalizeWarehouseId(fallbackWarehouse?.warehouse_id),
    warehouse_name: fallbackWarehouse?.warehouse_name || fallbackWarehouseLabel(fallbackWarehouse?.warehouse_id),
    items: Array.isArray(data?.items) ? data.items : [],
  }]
}

function FamilyDetailsSection({ title, qtyLabel, priceLabel, amountLabel, rows, qtyKey, priceKey, amountKey, emptyText }) {
  const totalQty = sumBy(rows, qtyKey)
  const totalAmount = sumBy(rows, amountKey)
  return (
    <section className="wsr-drawer-card">
      <h4 className="wsr-drawer-card__title">{title}</h4>
      {rows.length === 0 ? (
        <div className="wsr-drawer-empty">{emptyText}</div>
      ) : (
        <>
          <div className="wsr-drawer-table-wrap">
            <table className="wsr-drawer-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Product</th>
                  <th>{qtyLabel}</th>
                  <th>{priceLabel}</th>
                  <th>{amountLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.item_id || r.sku || 'p'}-${i}`}>
                    <td><ZohoItemThumb itemId={r.item_id} /></td>
                    <td className="wsr-drawer-product-cell">
                      <div className="wsr-drawer-product-name">{r.item_name || '—'}</div>
                      <div className="wsr-drawer-product-sku">{r.sku || '—'}</div>
                    </td>
                    <td>{formatCurrency(r[qtyKey])}</td>
                    <td>{formatCurrency(r[priceKey])}</td>
                    <td>{formatCurrency(r[amountKey])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="wsr-drawer-totals">
            <span>Total quantity: <strong>{formatCurrency(totalQty)}</strong></span>
            <span>Total amount: <strong>{formatCurrency(totalAmount)}</strong></span>
          </div>
        </>
      )}
    </section>
  )
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

/**
 * A family row is treated as "no values for this period" when every $ metric
 * is null, non-finite, or 0 (matches the table showing only "—" / "-").
 */
function isNoPeriodValueField(v) {
  if (v == null) return true
  if (typeof v === 'number' && !Number.isFinite(v)) return true
  if (Number(v) === 0) return true
  return false
}

const FAMILY_NUM_KEYS = [
  'opening_stock',
  'closing_stock',
  'purchase_amount',
  'returned_to_wholesale',
  'sales_amount',
]

/**
 * Splits Zoho family rows into those with at least one non-zero/defined amount
 * and those with nothing to show for the period.
 */
export function partitionWeeklyFamilyItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { withValues: [], noValues: [] }
  }
  const withValues = []
  const noValues = []
  for (const it of items) {
    const allEmpty = FAMILY_NUM_KEYS.every((k) => isNoPeriodValueField(it[k]))
    if (allEmpty) noValues.push(it)
    else withValues.push(it)
  }
  return { withValues, noValues }
}

/**
 * Grand totals for a list of family rows (same rules as the backend for weekly reports).
 */
export function sumWeeklyFamilyRowTotals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      opening_stock: 0,
      closing_stock: 0,
      purchase_amount: 0,
      returned_to_wholesale: 0,
      sales_amount: 0,
    }
  }
  const acc = {
    opening_stock: 0,
    closing_stock: 0,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    sales_amount: 0,
  }
  const hasNumeric = { ...Object.fromEntries(FAMILY_NUM_KEYS.map((k) => [k, false])) }
  for (const it of items) {
    for (const f of FAMILY_NUM_KEYS) {
      const v = it[f]
      if (typeof v === 'number' && Number.isFinite(v)) {
        hasNumeric[f] = true
        acc[f] += v
      }
    }
  }
  for (const f of FAMILY_NUM_KEYS) {
    if (!hasNumeric[f]) acc[f] = null
  }
  return acc
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

/** URL query keys for persisting filters across refresh (shared weekly report pages). */
export const WEEKLY_REPORT_QUERY = {
  from: 'from',
  to: 'to',
  load: 'load',
  warehouse: 'warehouse',
}

/**
 * Read date range, optional warehouse, and "already loaded" flag from the current URL.
 * When params are missing or invalid, returns `defaultRange` for dates and `loadToken: 0`.
 */
export function parseWeeklyReportFiltersFromSearchParams(searchParams, defaultRange, options = {}) {
  const { includeWarehouse = false } = options
  const def = defaultRange
  const f = searchParams.get(WEEKLY_REPORT_QUERY.from)
  const t = searchParams.get(WEEKLY_REPORT_QUERY.to)
  const base = { from: def.from, to: def.to, loadToken: 0 }
  if (includeWarehouse) {
    base.warehouse = searchParams.get(WEEKLY_REPORT_QUERY.warehouse) || ''
  }
  if (!f || !t || f > t) {
    return base
  }
  const out = {
    from: f,
    to: t,
    loadToken: searchParams.get(WEEKLY_REPORT_QUERY.load) === '1' ? 1 : 0,
  }
  if (includeWarehouse) {
    out.warehouse = searchParams.get(WEEKLY_REPORT_QUERY.warehouse) || ''
  }
  return out
}

/**
 * @param {{ from: string, to: string, warehouse?: string, loaded: boolean }} opts
 * @returns {URLSearchParams}
 */
export function buildWeeklyReportFilterSearchParams({ from, to, warehouse, loaded }) {
  const p = new URLSearchParams()
  p.set(WEEKLY_REPORT_QUERY.from, from)
  p.set(WEEKLY_REPORT_QUERY.to, to)
  if (warehouse && String(warehouse).trim() !== '') {
    p.set(WEEKLY_REPORT_QUERY.warehouse, String(warehouse).trim())
  }
  if (loaded) {
    p.set(WEEKLY_REPORT_QUERY.load, '1')
  }
  return p
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

const ZOHO_ITEM_IMAGE_PATH = '/api/weekly-reports/zoho-item-images'

/**
 * One Zoho catalog image per family (`zoho_representative_item_id`); fetches with Bearer auth
 * and lazy-loads when the cell scrolls into view.
 */
export function ZohoItemThumb({ itemId }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const objRef = useRef(null)
  const cellRef = useRef(null)

  useLayoutEffect(() => {
    if (objRef.current) {
      URL.revokeObjectURL(objRef.current)
      objRef.current = null
    }
    setSrc(null)
    setFailed(false)
    if (!itemId) return undefined

    let cancelled = false
    const go = async () => {
      try {
        const fromMem = getCachedZohoItemBlob(itemId)
        const q = new URLSearchParams()
        q.set('r', String(ZOHO_REP_IMAGE_QUERY_VERSION))
        const url = `${ZOHO_ITEM_IMAGE_PATH}/${encodeURIComponent(String(itemId))}?${q.toString()}`
        const blob = fromMem
          ? fromMem
          : (await fetchBinary(url, { cache: ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED ? 'default' : 'no-store' }))
            .blob
        if (cancelled) return
        if (!fromMem) {
          setCachedZohoItemBlob(itemId, blob)
        }
        const u = URL.createObjectURL(blob)
        if (objRef.current) URL.revokeObjectURL(objRef.current)
        objRef.current = u
        setSrc(u)
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    const node = cellRef.current
    if (!node) {
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        io.disconnect()
        go()
      },
      { rootMargin: '120px', threshold: 0.01 }
    )
    io.observe(node)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [itemId])

  useEffect(
    () => () => {
      if (objRef.current) {
        URL.revokeObjectURL(objRef.current)
        objRef.current = null
      }
    },
    []
  )

  if (!itemId) {
    return <span className="wsr-td--dash">—</span>
  }
  return (
    <div className="wsr-item-thumb-wrap" ref={cellRef}>
      {src && !failed ? <img src={src} alt="" className="wsr-item-thumb" width={48} height={48} /> : null}
      {failed ? <span className="wsr-td--dash">—</span> : null}
      {!src && !failed ? <span className="wsr-item-thumb__ph" aria-hidden /> : null}
    </div>
  )
}

/**
 * Renders a read-only sub-table of families with no amounts for the period
 * (same money columns, filled with "—" for all metrics).
 */
export const SOURCE_GROUP_LABELS = {
  slow_moving: 'Slow moving',
  other_family: 'Other family',
}

export function WeeklyNoActivityFamilyTable({ rows, showSourceColumn }) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  return (
    <div className="war-table-wrap wsr-no-activity-table-wrap">
      <table className="war-table">
        <thead>
          <tr>
            <th className="war-th wsr-th--sr">SR. NO</th>
            {showSourceColumn && <th className="war-th">Source</th>}
            <th className="war-th wsr-th--item">FAMILY</th>
            <th className="war-th wsr-th--photo">Photo</th>
            <th className="war-th">Opening Stock</th>
            <th className="war-th">Purchase Amount</th>
            <th className="war-th">Returned to Wholesale</th>
            <th className="war-th">Closing Stock</th>
            <th className="war-th">Sales Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, idx) => {
            const k =
              it._rowKey
              || (showSourceColumn
                ? `${it._sourceGroup || 'g'}:${it.family || ''}:${idx}`
                : `no-act-embed-${idx}`)
            return (
              <tr key={k} className="war-tr wsr-tr--no-activity">
                <td className="war-td wsr-td--sr">{idx + 1}</td>
                {showSourceColumn && (
                  <td className="war-td">
                    {it._sourceLabel
                      || (it._sourceGroup && SOURCE_GROUP_LABELS[it._sourceGroup])
                      || '—'}
                  </td>
                )}
                <td className="war-td wsr-td--item">{it.family || '—'}</td>
                <td className="war-td wsr-td--photo">
                  <ZohoItemThumb itemId={it.zoho_representative_item_id} />
                </td>
                <td className="war-td wsr-td--dash">—</td>
                <td className="war-td wsr-td--dash">—</td>
                <td className="war-td wsr-td--dash">—</td>
                <td className="war-td wsr-td--dash">—</td>
                <td className="war-td wsr-td--dash">—</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Full-width section for the combined weekly page: families with no period amounts,
 * merged from slow_moving and other_family (source column).
 */
export function WeeklyNoActivityReportSection({ dateLabel, mergedRows }) {
  if (!Array.isArray(mergedRows) || mergedRows.length === 0) return null
  return (
    <>
      <div className="wsr-section-divider" aria-hidden />
      <section className="war-section wsr-report-section wsr-no-activity-section">
        <div className="wsr-section-header">
          <div className="wsr-section-header__title-wrap">
            <h2 className="wsr-section-heading">No period activity</h2>
            {dateLabel && <span className="wsr-section-header__date">{dateLabel}</span>}
          </div>
        </div>
        <p className="wsr-no-activity__intro">
          Zoho families that are included in your Slow moving or Other family groups but have no opening, purchase,
          return, closing, or sales values for the selected range.
        </p>
        <WeeklyNoActivityFamilyTable rows={mergedRows} showSourceColumn />
        <div className="wsr-meta">
          <div className="wsr-meta__item">Families:<strong>{mergedRows.length}</strong></div>
          <div className="wsr-meta__item">Source:<strong>Zoho (live)</strong></div>
        </div>
      </section>
    </>
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
 *   loadToken      – parent increments when user runs "Load report" (positive value triggers fetch)
 *   onNoValueRows  – if set, families with all-zero period metrics are omitted from the main
 *                    table and the callback receives `(reportGroup, rows[])`; when omitted, those
 *                    rows are shown in a second table inside this section.
 */
export function WeeklySalesReportSection({
  reportGroup,
  title,
  fromDate,
  toDate,
  datesValid,
  warehouseId = null,
  excludeWarehouseId = null,
  enableSalesSort = false,
  loadToken = 0,
  onNoValueRows = null,
}) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [selectedFamily, setSelectedFamily] = useState('')
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState('')
  const [drawerWarnings, setDrawerWarnings] = useState([])
  const [drawerProgress, setDrawerProgress] = useState({ loaded: 0, total: 0, current: '' })
  /** @type {Array<{ warehouse_id: string, warehouse_name: string, items: object[] }>} */
  const [drawerWarehouses, setDrawerWarehouses] = useState([])
  const [salesSort, setSalesSort] = useState('desc')

  const { items, loading, error, notConfigured, validationErrors, refetch } =
    useWeeklySalesReport({ reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId, loadToken })

  const dateLabel = formatDateLabel(fromDate, toDate)

  const { withValues, noValues } = useMemo(
    () => partitionWeeklyFamilyItems(items),
    [items]
  )

  const grandTotal = useMemo(
    () => sumWeeklyFamilyRowTotals(withValues),
    [withValues]
  )
  const displayRows = useMemo(() => {
    if (!enableSalesSort) return withValues
    const rows = [...withValues]
    rows.sort((a, b) => {
      const av = Number(a?.sales_amount) || 0
      const bv = Number(b?.sales_amount) || 0
      return salesSort === 'asc' ? av - bv : bv - av
    })
    return rows
  }, [withValues, enableSalesSort, salesSort])

  const selectedFamilySet = useMemo(
    () => new Set(withValues.map((r) => String(r.family || '').trim())),
    [withValues]
  )

  useEffect(() => {
    if (typeof onNoValueRows !== 'function') return
    if (loadToken <= 0 || !datesValid) {
      onNoValueRows(reportGroup, [])
    } else {
      onNoValueRows(reportGroup, noValues)
    }
  }, [onNoValueRows, reportGroup, noValues, loadToken, datesValid])

  useEffect(() => {
    if (typeof onNoValueRows !== 'function') return undefined
    return () => {
      onNoValueRows(reportGroup, [])
    }
  }, [onNoValueRows, reportGroup])

  useEffect(() => {
    if (!selectedFamily) return
    if (!selectedFamilySet.has(selectedFamily)) {
      setSelectedFamily('')
      setDrawerWarehouses([])
      setDrawerError('')
      setDrawerWarnings([])
      setDrawerProgress({ loaded: 0, total: 0, current: '' })
      setDrawerLoading(false)
    }
  }, [selectedFamily, selectedFamilySet])

  useEffect(() => {
    if (!selectedFamily || !loadToken || !datesValid) return
    let cancelled = false
    const controller = new AbortController()
    const run = async () => {
      setDrawerLoading(true)
      setDrawerError('')
      setDrawerWarnings([])
      setDrawerProgress({ loaded: 0, total: 0, current: '' })
      setDrawerWarehouses([])
      try {
        const selectedWarehouseId = normalizeWarehouseId(warehouseId)
        const excludedWarehouseId = normalizeWarehouseId(excludeWarehouseId)
        let targets = []
        try {
          const whData = await api.get('/api/weekly-reports/warehouses', { signal: controller.signal })
          const allWarehouses = Array.isArray(whData?.warehouses) ? whData.warehouses : []
          if (selectedWarehouseId) {
            const found = allWarehouses.find((w) => normalizeWarehouseId(w?.warehouse_id) === selectedWarehouseId)
            targets = [{
              warehouse_id: selectedWarehouseId,
              warehouse_name: found?.warehouse_name || fallbackWarehouseLabel(selectedWarehouseId),
            }]
          } else {
            targets = allWarehouses
              .filter((w) => normalizeWarehouseId(w?.warehouse_id))
              .filter((w) => normalizeWarehouseId(w?.warehouse_id) !== excludedWarehouseId)
              .map((w) => ({
                warehouse_id: normalizeWarehouseId(w.warehouse_id),
                warehouse_name: w.warehouse_name || fallbackWarehouseLabel(w.warehouse_id),
              }))
          }
        } catch (err) {
          if (err?.name === 'AbortError') return
          if (!selectedWarehouseId) throw err
          targets = [{ warehouse_id: selectedWarehouseId, warehouse_name: fallbackWarehouseLabel(selectedWarehouseId) }]
          setDrawerWarnings([`Warehouse list could not be loaded; using selected warehouse ${selectedWarehouseId}.`])
        }

        if (cancelled) return
        if (targets.length === 0) {
          setDrawerProgress({ loaded: 0, total: 0, current: '' })
          setDrawerWarehouses([])
          return
        }

        setDrawerProgress({ loaded: 0, total: targets.length, current: targets[0].warehouse_name })

        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i]
          if (cancelled) return
          setDrawerProgress({ loaded: i, total: targets.length, current: target.warehouse_name })
          try {
            const qsParams = {
              from_date: fromDate,
              to_date: toDate,
              family: selectedFamily,
              warehouse_id: target.warehouse_id,
            }
            const qs = new URLSearchParams(qsParams).toString()
            const data = await api.get(
              `/api/weekly-reports/by-group/${encodeURIComponent(reportGroup)}/family-details?${qs}`,
              { signal: controller.signal }
            )
            if (cancelled) return
            const whs = parseFamilyDetailsWarehouses(data, target)
            setDrawerWarehouses((prev) => {
              const existing = new Set(prev.map((w) => normalizeWarehouseId(w.warehouse_id)))
              const next = whs.filter((w) => !existing.has(normalizeWarehouseId(w.warehouse_id)))
              return [...prev, ...next]
            })
          } catch (err) {
            if (err?.name === 'AbortError') return
            if (cancelled) return
            setDrawerWarnings((prev) => [
              ...prev,
              `${target.warehouse_name || target.warehouse_id}: ${err?.message || 'Failed to load warehouse details'}`,
            ])
          } finally {
            if (!cancelled) {
              setDrawerProgress({
                loaded: i + 1,
                total: targets.length,
                current: targets[i + 1]?.warehouse_name || '',
              })
            }
          }
        }
        if (cancelled) return
      } catch (err) {
        if (cancelled) return
        setDrawerWarehouses([])
        setDrawerWarnings([])
        setDrawerProgress({ loaded: 0, total: 0, current: '' })
        setDrawerError(err?.message || 'Failed to load family details')
      } finally {
        if (!cancelled) setDrawerLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedFamily, reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId, loadToken, datesValid])

  const handleExport = useCallback(async () => {
    if (!datesValid || notConfigured || !loadToken) return
    setExporting(true)
    setExportError('')
    const qsParams = { from_date: fromDate, to_date: toDate }
    if (warehouseId && String(warehouseId).trim() !== '') qsParams.warehouse_id = String(warehouseId).trim()
    if (excludeWarehouseId && String(excludeWarehouseId).trim() !== '') qsParams.exclude_warehouse_id = String(excludeWarehouseId).trim()
    if (enableSalesSort) qsParams.sales_sort = salesSort === 'asc' ? 'asc' : 'desc'
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
  }, [datesValid, notConfigured, fromDate, toDate, reportGroup, loadToken, warehouseId, excludeWarehouseId, enableSalesSort, salesSort])

  const hasRequestedReport = loadToken > 0
  const showTable = hasRequestedReport && !loading && !error && !notConfigured && datesValid

  return (
    <section className="war-section wsr-report-section">
      {/* Section header with title + per-group export/refresh */}
      <div className="wsr-section-header">
        <div className="wsr-section-header__title-wrap">
          <h2 className="wsr-section-heading">{title}</h2>
          {dateLabel && <span className="wsr-section-header__date">{dateLabel}</span>}
        </div>
        <div className="wsr-section-header__actions">
          {enableSalesSort && withValues.length > 1 && (
            <select
              className="war-input wsr-sales-sort-select"
              value={salesSort}
              onChange={(e) => setSalesSort(e.target.value === 'asc' ? 'asc' : 'desc')}
              title="Sort by Sales Amount"
            >
              <option value="desc">Sales High → Low</option>
              <option value="asc">Sales Low → High</option>
            </select>
          )}
          <button
            type="button"
            className="war-btn war-btn--primary war-btn--sm"
            onClick={handleExport}
            disabled={exporting || !datesValid || notConfigured || !loadToken}
            aria-busy={exporting}
          >
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            type="button"
            className="war-btn war-btn--ghost war-btn--sm"
            onClick={refetch}
            disabled={loading || !datesValid || !loadToken}
            title={!loadToken ? 'Run Load report in the filters bar first' : 'Reload this table from Zoho'}
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
        <ErrorCallout
          message={error}
          onRetry={loadToken > 0 ? refetch : undefined}
          validationErrors={validationErrors}
        />
      )}

      {loading && hasRequestedReport && (
        <div className="wsr-processing" role="status" aria-live="polite">
          <div className="wsr-processing__spinner" aria-hidden />
          <div className="wsr-processing__text">
            <span className="wsr-processing__title">Loading report</span>
            <span className="wsr-processing__sub">Fetching from Zoho and building family rows…</span>
          </div>
        </div>
      )}

      {!hasRequestedReport && !loading && !error && !notConfigured && datesValid && (
        <div className="wsr-idle" role="status">
          <p className="wsr-idle__line">
            <strong>Ready to load</strong> — set the date range (and warehouse if the page includes one), then click{' '}
            <strong>Load report</strong> to fetch this section from Zoho.
          </p>
        </div>
      )}

      {showTable && (
        <>
          <div className="war-table-wrap">
            <table className="war-table">
              <thead>
                <tr>
                  <th className="war-th wsr-th--sr">SR. NO</th>
                  <th className="war-th wsr-th--item">FAMILY</th>
                  <th className="war-th wsr-th--photo">Photo</th>
                  <th className="war-th">Opening Stock</th>
                  <th className="war-th">Purchase Amount</th>
                  <th className="war-th">Returned to Wholesale</th>
                  <th className="war-th">Closing Stock</th>
                  <th className="war-th">Sales Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr className="war-tr">
                    <td className="war-td" colSpan={8}>
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
                {items.length > 0 && withValues.length === 0 && noValues.length > 0 && (
                  <tr className="war-tr">
                    <td className="war-td" colSpan={8}>
                      <div className="wsr-callout wsr-callout--info" style={{ margin: 0, border: 'none' }} role="status">
                        <span className="wsr-callout__body">
                          All families in this list have <strong>no</strong> opening, purchase, return, closing, or
                          sales amounts for {dateLabel || 'this range'}. They are listed under{' '}
                          <strong>No period activity</strong> {onNoValueRows ? 'in the section below' : 'below'}.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {displayRows.map((it, idx) => (
                  <tr
                    key={`${it.family || 'row'}-${idx}`}
                    className={`war-tr ${selectedFamily && selectedFamily === (it.family || '') ? 'wsr-tr--selected' : ''}`}
                  >
                    <td className="war-td wsr-td--sr">{idx + 1}</td>
                    <td className="war-td wsr-td--item">
                      {it.family ? (
                        <button
                          type="button"
                          className="wsr-family-link"
                          onClick={() => setSelectedFamily(String(it.family))}
                        >
                          {it.family}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="war-td wsr-td--photo">
                      <ZohoItemThumb itemId={it.zoho_representative_item_id} />
                    </td>
                    <td className="war-td">{formatCurrency(it.opening_stock)}</td>
                    <td className="war-td">{formatCurrency(it.purchase_amount)}</td>
                    <td className="war-td">{formatCurrency(it.returned_to_wholesale)}</td>
                    <td className="war-td">{formatCurrency(it.closing_stock)}</td>
                    <td className="war-td">{formatCurrency(it.sales_amount)}</td>
                  </tr>
                ))}
              </tbody>
              {withValues.length > 0 && (
                <tfoot>
                  <tr className="war-tr war-tr--total">
                    <td className="war-td wsr-td--sr" />
                    <td className="war-td wsr-td--item">Grand Total</td>
                    <td className="war-td wsr-td--photo" />
                    <td className="war-td">{formatCurrency(grandTotal.opening_stock)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.purchase_amount)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.returned_to_wholesale)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.closing_stock)}</td>
                    <td className="war-td">{formatCurrency(grandTotal.sales_amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="wsr-meta">
            <div className="wsr-meta__item">Group:<strong>{reportGroup}</strong></div>
            <div className="wsr-meta__item">Families (total):<strong>{items.length}</strong></div>
            {noValues.length > 0 && (
              <div className="wsr-meta__item">With amounts:<strong>{withValues.length}</strong></div>
            )}
            {noValues.length > 0 && (
              <div className="wsr-meta__item">No period activity:<strong>{noValues.length}</strong></div>
            )}
            <div className="wsr-meta__item">Source:<strong>Zoho (live)</strong></div>
          </div>
          {onNoValueRows == null && noValues.length > 0 && (
            <div className="wsr-no-activity-embed">
              <h3 className="wsr-subsection-heading">No period activity</h3>
              <p className="wsr-no-activity__intro">
                Zoho families that appear in this group but have no opening, purchase, return, closing, or sales
                values for the selected range.
              </p>
              <WeeklyNoActivityFamilyTable rows={noValues} showSourceColumn={false} />
            </div>
          )}
        </>
      )}
      <div
        className={`wsr-drawer-backdrop ${selectedFamily ? 'is-open' : ''}`}
        onClick={() => setSelectedFamily('')}
      />
      <aside className={`wsr-drawer ${selectedFamily ? 'is-open' : ''}`} aria-hidden={!selectedFamily}>
        <div className="wsr-drawer__header">
          <h3>Family Details: {selectedFamily || '—'}</h3>
          <button type="button" className="war-btn war-btn--ghost war-btn--sm" onClick={() => setSelectedFamily('')}>
            Close
          </button>
        </div>
        <div className="wsr-drawer__body">
          {drawerLoading && (
            <div className="wsr-drawer-loading">
              Loading per-warehouse family details from Zoho…
              {drawerProgress.total > 0 && (
                <span className="wsr-drawer-loading__sub">
                  Loaded {drawerProgress.loaded} of {drawerProgress.total}
                  {drawerProgress.current ? ` — now loading ${drawerProgress.current}` : ''}.
                </span>
              )}
              {drawerProgress.total === 0 && (
                <span className="wsr-drawer-loading__sub">Resolving warehouses…</span>
              )}
            </div>
          )}
          {!drawerLoading && drawerError && <div className="wsr-drawer-error">{drawerError}</div>}
          {!drawerError && drawerWarnings.length > 0 && (
            <div className="wsr-drawer-warning" role="status">
              <strong>Some warehouses could not be loaded.</strong>
              {drawerWarnings.map((w, i) => (
                <span key={`${w}-${i}`}>{w}</span>
              ))}
            </div>
          )}
          {!drawerError && selectedFamily && (
            drawerWarehouses.length === 0 && !drawerLoading ? (
              <div className="wsr-drawer-empty wsr-drawer-empty--soft">
                <strong>No warehouses returned for this view.</strong>
                <span className="wsr-empty__sub">No Zoho locations matched, or the response was empty.</span>
              </div>
            ) : drawerWarehouses.length > 0 ? (
              drawerWarehouses.map((wh) => {
                const wkey = wh.warehouse_id != null && String(wh.warehouse_id) !== '' ? wh.warehouse_id : wh.warehouse_name
                const d = itemDetailsToDrawerSections(wh.items)
                return (
                  <details key={wkey} className="wsr-drawer-warehouse" open>
                    <summary className="wsr-drawer-warehouse__summary">
                      <span className="wsr-drawer-warehouse__name">{wh.warehouse_name || wh.warehouse_id || 'Warehouse'}</span>
                    </summary>
                    <div className="wsr-drawer-warehouse__inner">
                      <FamilyDetailsSection
                        title="Opening Stock"
                        qtyLabel="Quantity"
                        priceLabel="Sales Price"
                        amountLabel="Total Amount"
                        rows={d.opening}
                        qtyKey="opening_qty"
                        priceKey="opening_price"
                        amountKey="opening_amount"
                        emptyText="No opening stock for this family in this period."
                      />
                      <FamilyDetailsSection
                        title="Purchase"
                        qtyLabel="Quantity"
                        priceLabel="Purchase Price"
                        amountLabel="Total Amount"
                        rows={d.purchase}
                        qtyKey="purchase_qty"
                        priceKey="purchase_price"
                        amountKey="purchase_amount"
                        emptyText="No purchase activity for this family in this period."
                      />
                      <FamilyDetailsSection
                        title="Vendor Credits / Returned to Wholesale"
                        qtyLabel="Quantity Returned"
                        priceLabel="Price"
                        amountLabel="Total Amount"
                        rows={d.returned}
                        qtyKey="returned_qty"
                        priceKey="returned_price"
                        amountKey="returned_amount"
                        emptyText="No returned-to-wholesale activity for this family in this period."
                      />
                      <FamilyDetailsSection
                        title="Closing Stock"
                        qtyLabel="Quantity"
                        priceLabel="Sales Price"
                        amountLabel="Total Amount"
                        rows={d.closing}
                        qtyKey="closing_qty"
                        priceKey="closing_price"
                        amountKey="closing_amount"
                        emptyText="No closing stock for this family in this period."
                      />
                      <FamilyDetailsSection
                        title="Sales"
                        qtyLabel="Quantity Sold"
                        priceLabel="Sales Price"
                        amountLabel="Total Amount"
                        rows={d.sales}
                        qtyKey="sold_qty"
                        priceKey="sold_price"
                        amountKey="sales_amount"
                        emptyText="No sales activity for this family in this period."
                      />
                    </div>
                  </details>
                )
              })
            ) : null
          )}
        </div>
      </aside>
    </section>
  )
}

/**
 * Stand-alone page for a single report group (keeps backward compat for
 * direct links to /slow-moving or /other-family if needed).
 */
export function WeeklySalesReportPage({ reportGroup, title, subtitle }) {
  const def = useMemo(() => defaultWeekRange(), [])
  const [searchParams, setSearchParams] = useSearchParams()
  const parsed = useMemo(
    () => parseWeeklyReportFiltersFromSearchParams(searchParams, def, { includeWarehouse: false }),
    [searchParams, def],
  )
  const [fromDate, setFromDate] = useState(parsed.from)
  const [toDate, setToDate]     = useState(parsed.to)
  const [loadToken, setLoadToken] = useState(parsed.loadToken)

  const writeUrl = useCallback(
    (from, to, { loaded = false } = {}) => {
      setSearchParams(buildWeeklyReportFilterSearchParams({ from, to, warehouse: '', loaded }), {
        replace: true,
      })
    },
    [setSearchParams],
  )

  const handleFromChange = useCallback(
    (e) => {
      const v = e.target.value
      setFromDate(v)
      setLoadToken(0)
      writeUrl(v, toDate, { loaded: false })
    },
    [toDate, writeUrl],
  )
  const handleToChange   = useCallback(
    (e) => {
      const v = e.target.value
      setToDate(v)
      setLoadToken(0)
      writeUrl(fromDate, v, { loaded: false })
    },
    [fromDate, writeUrl],
  )

  const datesValid = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate

  const handleLoadReport = useCallback(() => {
    if (!fromDate || !toDate) return
    setLoadToken((n) => n + 1)
    writeUrl(fromDate, toDate, { loaded: true })
  }, [fromDate, toDate, writeUrl])

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
          <div className="wsr-toolbar__actions">
            <button
              type="button"
              className="war-btn war-btn--primary"
              onClick={handleLoadReport}
              disabled={!datesValid}
            >
              Load report
            </button>
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
        loadToken={loadToken}
      />
    </div>
  )
}

export default WeeklySalesReportPage
