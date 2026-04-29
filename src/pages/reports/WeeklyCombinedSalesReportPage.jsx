import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import {
  WeeklySalesReportSection,
  WeeklyNoActivityReportSection,
  defaultWeekRange,
  formatDateLabel,
  SOURCE_GROUP_LABELS,
  WEEKLY_REPORT_QUERY,
  ZohoUsageInline,
  buildWeeklyReportFilterSearchParams,
  parseWeeklyReportFiltersFromSearchParams,
} from './WeeklySalesReportPage'
import { useWarehouses } from '../../hooks/useWarehouses'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'

/**
 * Combined page that shows both the Slow Moving and Other Family weekly
 * sales reports side-by-side under one shared date range picker + warehouse filter.
 * Sections load **one after another** (Slow Moving → Other Family → Damaged Slow → Damaged Other)
 * so concurrent Zoho calls do not blow the per-minute guard (default 70/min).
 */
export function WeeklyCombinedSalesReportPage() {
  const def = useMemo(() => defaultWeekRange(), [])
  const [searchParams, setSearchParams] = useSearchParams()
  const parsed = useMemo(
    () => parseWeeklyReportFiltersFromSearchParams(searchParams, def, { includeWarehouse: true }),
    [searchParams, def],
  )
  const [fromDate, setFromDate]       = useState(parsed.from)
  const [toDate, setToDate]           = useState(parsed.to)
  const [warehouseId, setWarehouseId] = useState(parsed.warehouse)
  const [loadToken, setLoadToken]     = useState(0)
  /** Sequential gates so only one weekly report fetch runs at a time across this page. */
  const [allowOtherFamilyMain, setAllowOtherFamilyMain] = useState(false)
  const [allowDamagedSlow, setAllowDamagedSlow] = useState(false)
  const [allowDamagedOther, setAllowDamagedOther] = useState(false)
  const [noValueByGroup, setNoValueByGroup] = useState({
    slow_moving: [],
    other_family: [],
  })
  /** Quota snapshot for filters bar (GET /weekly-reports/zoho-api-usage) — visible as soon as user clicks Load report. */
  const [filtersUsageZoho, setFiltersUsageZoho] = useState(null)

  const { warehouses, loading: whLoading } = useWarehouses()

  // Automatically detect the "Damaged" warehouse so it can be:
  //   1. Excluded from the main sections (subtracted by the backend)
  //   2. Shown in its own dedicated 4th section at the bottom
  const damagedWh = useMemo(
    () => warehouses.find((w) => /damaged/i.test(w.warehouse_name || '')),
    [warehouses],
  )

  // Non-damaged warehouses shown in the dropdown — Damaged has its own section
  const mainWarehouses = useMemo(
    () => warehouses.filter((w) => !(/damaged/i.test(w.warehouse_name || ''))),
    [warehouses],
  )

  const writeUrl = useCallback(
    (from, to, wh) => {
      setSearchParams(buildWeeklyReportFilterSearchParams({ from, to, warehouse: wh }), { replace: true })
    },
    [setSearchParams],
  )

  // Legacy ?load=1 meant "already loaded" and caused auto-fetch on refresh — remove it.
  useEffect(() => {
    if (searchParams.get(WEEKLY_REPORT_QUERY.load) == null) return
    const p = new URLSearchParams(searchParams)
    p.delete(WEEKLY_REPORT_QUERY.load)
    setSearchParams(p, { replace: true })
  }, [searchParams, setSearchParams])

  const handleFromChange = useCallback(
    (e) => {
      const v = e.target.value
      setFromDate(v)
      setLoadToken(0)
      writeUrl(v, toDate, warehouseId)
    },
    [toDate, warehouseId, writeUrl],
  )
  const handleToChange = useCallback(
    (e) => {
      const v = e.target.value
      setToDate(v)
      setLoadToken(0)
      writeUrl(fromDate, v, warehouseId)
    },
    [fromDate, warehouseId, writeUrl],
  )
  const handleWarehouseChange = useCallback(
    (e) => {
      const v = e.target.value
      setWarehouseId(v)
      setLoadToken(0)
      writeUrl(fromDate, toDate, v)
    },
    [fromDate, toDate, writeUrl],
  )

  const handleLoadReport = useCallback(() => {
    if (!fromDate || !toDate) return
    setAllowOtherFamilyMain(false)
    setAllowDamagedSlow(false)
    setAllowDamagedOther(false)
    setLoadToken((n) => n + 1)
    writeUrl(fromDate, toDate, warehouseId)
  }, [fromDate, toDate, warehouseId, writeUrl])

  const datesValid    = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate
  const dateLabel     = formatDateLabel(fromDate, toDate)
  const activeWhId    = warehouseId || null   // null = all warehouses (no filter)

  // When "All Warehouses" is selected and a Damaged warehouse exists, pass its id
  // as exclude_warehouse_id so the backend subtracts it from the main sections.
  const mainExcludeWhId = !activeWhId && damagedWh ? damagedWh.warehouse_id : null

  useEffect(() => {
    if (loadToken === 0) {
      setNoValueByGroup({ slow_moving: [], other_family: [] })
      setAllowOtherFamilyMain(false)
      setAllowDamagedSlow(false)
      setAllowDamagedOther(false)
    }
  }, [loadToken])

  useEffect(() => {
    if (loadToken <= 0) {
      setFiltersUsageZoho(null)
      return
    }
    let cancelled = false
    api
      .get('/api/weekly-reports/zoho-api-usage')
      .then((d) => {
        if (!cancelled && d?.zoho) setFiltersUsageZoho(d.zoho)
      })
      .catch(() => {
        if (!cancelled) setFiltersUsageZoho(null)
      })
    return () => {
      cancelled = true
    }
  }, [loadToken])

  const onNoValueRows = useCallback((group, rows) => {
    const next = Array.isArray(rows) ? rows : []
    setNoValueByGroup((prev) => ({ ...prev, [group]: next }))
  }, [])

  const noActivityMerged = useMemo(() => {
    const out = []
    for (const g of ['slow_moving', 'other_family']) {
      const list = noValueByGroup[g] || []
      const label = SOURCE_GROUP_LABELS[g] || g
      for (let i = 0; i < list.length; i++) {
        const it = list[i]
        out.push({
          ...it,
          _sourceGroup: g,
          _sourceLabel: label,
          _rowKey: `${g}::${it.family || 'u'}::${i}`,
        })
      }
    }
    return out.sort((a, b) => {
      const fa = (a.family || '').toLowerCase()
      const fb = (b.family || '').toLowerCase()
      if (fa !== fb) return fa.localeCompare(fb)
      return (a._sourceLabel || '').localeCompare(b._sourceLabel || '')
    })
  }, [noValueByGroup])

  // Label for the currently-selected warehouse (used in section context)
  const selectedWarehouse = warehouses.find((w) => w.warehouse_id === warehouseId)

  return (
    <div className="war-page">
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">Weekly Sales Reports</h1>
          <p className="war-page__sub">
            Live Zoho-sourced family summaries — Slow moving, other family, and no-period-activity families
          </p>
        </div>
      </div>

      {/* Shared filters: date range + warehouse */}
      <section className="war-section">
        <h2 className="war-section__title">Filters</h2>
        <div className="wsr-toolbar wsr-toolbar--filters">
          <div className="wsr-toolbar__dates">
            <div className="war-form-field">
              <label className="war-label" htmlFor="wcsr-from">From</label>
              <input
                id="wcsr-from"
                type="date"
                className="war-input"
                value={fromDate}
                max={toDate || undefined}
                onChange={handleFromChange}
              />
            </div>
            <div className="war-form-field">
              <label className="war-label" htmlFor="wcsr-to">To</label>
              <input
                id="wcsr-to"
                type="date"
                className="war-input"
                value={toDate}
                min={fromDate || undefined}
                onChange={handleToChange}
              />
            </div>
          </div>

          {/* Warehouse filter */}
          <div className="war-form-field wsr-warehouse-field">
            <label className="war-label" htmlFor="wcsr-warehouse">Warehouse</label>
            <div className="wsr-warehouse-select-wrap">
              <select
                id="wcsr-warehouse"
                className="war-input wsr-warehouse-select"
                value={warehouseId}
                onChange={handleWarehouseChange}
                disabled={whLoading}
              >
                <option value="">All Warehouses</option>
                {mainWarehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}{w.is_primary ? ' ★' : ''}
                  </option>
                ))}
              </select>
              {whLoading && <span className="wsr-warehouse-loading">Loading…</span>}
            </div>
          </div>

          <div className="wsr-filters__actions">
            <button
              type="button"
              className="war-btn war-btn--primary"
              onClick={handleLoadReport}
              disabled={!datesValid}
            >
              Load report
            </button>
          </div>

          {dateLabel && <span className="wsr-date-badge">{dateLabel}</span>}
        </div>

        {!datesValid && (
          <div className="wsr-callout wsr-callout--warn" style={{ marginTop: 12 }}>
            <span className="wsr-callout__title">Invalid date range</span>
            <div className="wsr-callout__body">Pick a From date that is before or equal to the To date.</div>
          </div>
        )}

        {selectedWarehouse && (
          <div className="wsr-warehouse-badge">
            Filtered to: <strong>{selectedWarehouse.warehouse_name}</strong>
          </div>
        )}

        {loadToken > 0 && filtersUsageZoho && (
          <div className="wsr-zoho-usage-banner" role="status">
            <div className="wsr-meta wsr-meta--banner">
              <ZohoUsageInline zoho={filtersUsageZoho} />
            </div>
          </div>
        )}
      </section>

      {/* Slow Moving section */}
      <WeeklySalesReportSection
        reportGroup="slow_moving"
        title="Slow Moving"
        fromDate={fromDate}
        toDate={toDate}
        datesValid={datesValid}
        warehouseId={activeWhId}
        excludeWarehouseId={mainExcludeWhId}
        enableSalesSort
        loadToken={loadToken}
        onReportFetchSettled={() => setAllowOtherFamilyMain(true)}
        onNoValueRows={onNoValueRows}
      />

      {/* Divider */}
      <div className="wsr-section-divider" aria-hidden />

      {/* Other Family section */}
      <WeeklySalesReportSection
        reportGroup="other_family"
        title="Other Family"
        fromDate={fromDate}
        toDate={toDate}
        datesValid={datesValid}
        warehouseId={activeWhId}
        excludeWarehouseId={mainExcludeWhId}
        enableSalesSort
        loadToken={allowOtherFamilyMain ? loadToken : 0}
        onReportFetchSettled={() => setAllowDamagedSlow(true)}
        onNoValueRows={onNoValueRows}
      />

      <WeeklyNoActivityReportSection dateLabel={dateLabel} mergedRows={noActivityMerged} />

      {/* ── Damaged Warehouse section ───────────────────────────────────
           Always shown at the bottom (independent of the warehouse filter).
           Data is fetched filtered to damagedWh.warehouse_id so only movements
           recorded against that warehouse are shown here.
      ─────────────────────────────────────────────────────────────── */}
      {damagedWh && (
        <>
          <div className="wsr-section-divider" aria-hidden />
          <div className="wsr-damaged-group">
            <div className="war-page__header wsr-damaged-group__header">
              <div>
                <h2 className="war-page__title wsr-damaged-group__title">
                  {damagedWh.warehouse_name}
                </h2>
                <p className="war-page__sub">
                  Entries recorded against the Damaged warehouse — excluded from the main sections above.
                </p>
              </div>
            </div>
            <WeeklySalesReportSection
              reportGroup="slow_moving"
              title="Slow Moving (Damaged)"
              fromDate={fromDate}
              toDate={toDate}
              datesValid={datesValid}
              warehouseId={damagedWh.warehouse_id}
              loadToken={allowDamagedSlow ? loadToken : 0}
              onReportFetchSettled={() => setAllowDamagedOther(true)}
            />
            <div className="wsr-section-divider" aria-hidden />
            <WeeklySalesReportSection
              reportGroup="other_family"
              title="Other Family (Damaged)"
              fromDate={fromDate}
              toDate={toDate}
              datesValid={datesValid}
              warehouseId={damagedWh.warehouse_id}
              loadToken={allowDamagedOther ? loadToken : 0}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default WeeklyCombinedSalesReportPage
