import { useState, useMemo, useCallback } from 'react'
import {
  WeeklySalesReportSection,
  defaultWeekRange,
  formatDateLabel,
} from './WeeklySalesReportPage'
import { useWarehouses } from '../../hooks/useWarehouses'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'

/**
 * Combined page that shows both the Slow Moving and Other Family weekly
 * sales reports side-by-side under one shared date range picker + warehouse filter.
 * Each section fetches its own data independently and has its own Export / Refresh controls.
 */
export function WeeklyCombinedSalesReportPage() {
  const initial = useMemo(defaultWeekRange, [])
  const [fromDate, setFromDate]       = useState(initial.from)
  const [toDate, setToDate]           = useState(initial.to)
  const [warehouseId, setWarehouseId] = useState('')

  const { warehouses, loading: whLoading } = useWarehouses()

  const handleFromChange      = useCallback((e) => setFromDate(e.target.value), [])
  const handleToChange        = useCallback((e) => setToDate(e.target.value), [])
  const handleWarehouseChange = useCallback((e) => setWarehouseId(e.target.value), [])

  const datesValid    = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate
  const dateLabel     = formatDateLabel(fromDate, toDate)
  const activeWhId    = warehouseId || null   // null = all warehouses (no filter)

  // Label for the currently-selected warehouse (used in section context)
  const selectedWarehouse = warehouses.find((w) => w.warehouse_id === warehouseId)

  return (
    <div className="war-page">
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">Weekly Sales Reports</h1>
          <p className="war-page__sub">
            Live Zoho-sourced family summaries — Slow Moving &amp; Other Family
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
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}{w.is_primary ? ' ★' : ''}
                  </option>
                ))}
              </select>
              {whLoading && <span className="wsr-warehouse-loading">Loading…</span>}
            </div>
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
      </section>

      {/* Slow Moving section */}
      <WeeklySalesReportSection
        reportGroup="slow_moving"
        title="Slow Moving"
        fromDate={fromDate}
        toDate={toDate}
        datesValid={datesValid}
        warehouseId={activeWhId}
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
      />
    </div>
  )
}

export default WeeklyCombinedSalesReportPage
