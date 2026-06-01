import { useCallback, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { fmtMoney, fmtPct } from './allPricesEcommerceUtils'
import {
  buildCostLookup,
  computeCogs,
  type AllPricesCostRow,
  type CogsResult,
  type SalesByItemRow,
} from './allPricesCogs'

interface AllPricesCogsPanelProps {
  rows: AllPricesCostRow[]
  currencyLabel?: string
}

interface SalesByItemResponse {
  rows?: SalesByItemRow[]
  meta?: {
    from_date?: string
    to_date?: string
    source?: string | null
    truncated?: boolean
    fallback_used?: boolean
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function AllPricesCogsPanel({ rows, currencyLabel = 'AED' }: AllPricesCogsPanelProps) {
  const [fromDate, setFromDate] = useState(() => isoDaysAgo(30))
  const [toDate, setToDate] = useState(() => todayIso())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [salesRows, setSalesRows] = useState<SalesByItemRow[] | null>(null)
  const [meta, setMeta] = useState<SalesByItemResponse['meta'] | null>(null)

  const costLookup = useMemo(() => buildCostLookup(rows), [rows])

  const result = useMemo<CogsResult | null>(() => {
    if (!salesRows) return null
    return computeCogs(salesRows, costLookup)
  }, [salesRows, costLookup])

  const datesInvalid = !fromDate || !toDate || fromDate > toDate

  const handleCalculate = useCallback(async () => {
    if (datesInvalid) {
      setError('Pick a valid date range (from date must be on or before to date).')
      return
    }
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ from_date: fromDate, to_date: toDate }).toString()
      const data = (await api.get(`/api/prices/cogs/sales-by-item?${qs}`)) as SalesByItemResponse
      setSalesRows(Array.isArray(data?.rows) ? data.rows : [])
      setMeta(data?.meta || null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sales data.'
      setError(message)
      setSalesRows(null)
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [datesInvalid, fromDate, toDate])

  const money = (n: number) => fmtMoney(n, 2)

  return (
    <section className="page-section ap-cogs" aria-label="COGS calculation">
      <div className="ap-cogs-note" role="note">
        Cost of goods sold for a date range. Sales (SKU, quantity, unit price) come from Zoho
        sales-by-item; the unit cost is your <strong>purchase price</strong> from the current All
        Prices list, matched by SKU. <strong>COGS = quantity x purchase price</strong>.
      </div>

      <div className="ap-cogs-controls">
        <label>
          From
          <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={toDate} min={fromDate} max={todayIso()} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <button type="button" className="btn btn--primary" onClick={handleCalculate} disabled={loading || datesInvalid}>
          {loading ? 'Calculating…' : 'Calculate COGS'}
        </button>
      </div>

      {error ? (
        <p className="ap-ec-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <>
          <div className="ap-cogs-summary">
            <div className="ap-cogs-card">
              <span className="ap-cogs-card__label">Total COGS</span>
              <span className="ap-cogs-card__value">
                {money(result.totals.totalCogs)} {currencyLabel}
              </span>
            </div>
            <div className="ap-cogs-card">
              <span className="ap-cogs-card__label">Revenue</span>
              <span className="ap-cogs-card__value">
                {money(result.totals.totalRevenue)} {currencyLabel}
              </span>
            </div>
            <div className="ap-cogs-card">
              <span className="ap-cogs-card__label">Gross profit</span>
              <span className="ap-cogs-card__value">
                {money(result.totals.grossProfit)} {currencyLabel}
              </span>
            </div>
            <div className="ap-cogs-card">
              <span className="ap-cogs-card__label">Margin</span>
              <span className="ap-cogs-card__value">{fmtPct(result.totals.marginPct, 1)}</span>
            </div>
            <div className="ap-cogs-card">
              <span className="ap-cogs-card__label">Units sold</span>
              <span className="ap-cogs-card__value">{money(result.totals.totalQty)}</span>
            </div>
          </div>

          <div className="ap-cogs-meta">
            Matched <strong>{result.totals.matchedCount}</strong> item(s).{' '}
            {result.totals.unmatchedCount > 0 ? (
              <span>
                <strong>{result.totals.unmatchedCount}</strong> sold SKU(s) have no cost price in All
                Prices (see below).
              </span>
            ) : (
              <span>All sold SKUs were priced.</span>
            )}
            {meta?.truncated ? (
              <span className="ap-cogs-meta__warn"> Sales data was truncated by Zoho pagination; totals may be partial.</span>
            ) : null}
          </div>

          <div className="ap-cogs-table-wrap">
            <table className="ap-cogs-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit sales price</th>
                  <th className="num">Cost price</th>
                  <th className="num">COGS</th>
                  <th className="num">Revenue</th>
                  <th className="num">Profit</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {result.matched.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="ap-cogs-empty">
                      No matched items for this date range.
                    </td>
                  </tr>
                ) : (
                  result.matched.map((r) => (
                    <tr key={r.itemId || r.sku}>
                      <td>{r.sku || '—'}</td>
                      <td>{r.itemName || '—'}</td>
                      <td className="num">{money(r.qty)}</td>
                      <td className="num">{money(r.unitPrice)}</td>
                      <td className="num">{money(r.costPrice)}</td>
                      <td className="num">{money(r.cogs)}</td>
                      <td className="num">{money(r.salesAmount)}</td>
                      <td className="num">{money(r.profit)}</td>
                      <td className="num">{fmtPct(r.marginPct, 1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {result.matched.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="num">{money(result.totals.totalQty)}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">{money(result.totals.totalCogs)}</td>
                    <td className="num">{money(result.totals.totalRevenue)}</td>
                    <td className="num">{money(result.totals.grossProfit)}</td>
                    <td className="num">{fmtPct(result.totals.marginPct, 1)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {result.unmatched.length > 0 ? (
            <div className="ap-cogs-unmatched">
              <h3>Unmatched SKUs (no cost price in All Prices)</h3>
              <p className="ap-cogs-unmatched__hint">
                Add these SKUs (with a purchase price) to the All Prices list so they are included in
                COGS.
              </p>
              <div className="ap-cogs-table-wrap">
                <table className="ap-cogs-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Item</th>
                      <th className="num">Qty</th>
                      <th className="num">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatched.map((r) => (
                      <tr key={r.item_id || r.sku || r.item_name}>
                        <td>{r.sku || '—'}</td>
                        <td>{r.item_name || '—'}</td>
                        <td className="num">{money(r.qty)}</td>
                        <td className="num">{money(r.sales_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        !loading && (
          <p className="ap-cogs-placeholder">
            Choose a date range and select <strong>Calculate COGS</strong> to pull sales from Zoho and
            match them against your current cost prices.
          </p>
        )
      )}
    </section>
  )
}
