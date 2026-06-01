import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { fmtMoney, fmtPct } from './allPricesEcommerceUtils'
import {
  buildCostLookup,
  buildPurchaseCostLookup,
  computeCogs,
  type AllPricesCostRow,
  type CogsResult,
  type PurchaseCost,
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
    customer_id?: string | null
    truncated?: boolean
    fallback_used?: boolean
  }
}

interface CogsCustomer {
  contact_id: string
  contact_name: string
}

interface CustomersResponse {
  contacts?: CogsCustomer[]
}

interface PurchaseCostsResponse {
  costs?: PurchaseCost[]
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
  const [customers, setCustomers] = useState<CogsCustomer[]>([])
  const [customerId, setCustomerId] = useState('')
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customersError, setCustomersError] = useState('')

  useEffect(() => {
    let cancelled = false
    setCustomersLoading(true)
    setCustomersError('')
    api
      .get('/api/prices/cogs/customers')
      .then((data) => {
        if (cancelled) return
        const list = (data as CustomersResponse)?.contacts
        setCustomers(Array.isArray(list) ? list : [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCustomersError(err instanceof Error ? err.message : 'Failed to load customers.')
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCustomerName = useMemo(
    () => customers.find((c) => c.contact_id === customerId)?.contact_name || '',
    [customers, customerId]
  )

  const [purchaseCosts, setPurchaseCosts] = useState<PurchaseCost[]>([])

  const costLookup = useMemo(() => buildCostLookup(rows), [rows])
  const purchaseCostLookup = useMemo(() => buildPurchaseCostLookup(purchaseCosts), [purchaseCosts])

  const result = useMemo<CogsResult | null>(() => {
    if (!salesRows) return null
    return computeCogs(salesRows, costLookup, purchaseCostLookup)
  }, [salesRows, costLookup, purchaseCostLookup])

  const datesInvalid = !fromDate || !toDate || fromDate > toDate

  const handleCalculate = useCallback(async () => {
    if (datesInvalid) {
      setError('Pick a valid date range (from date must be on or before to date).')
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate })
      if (customerId) params.set('customer_id', customerId)
      // Fetch sales and the purchase-order cost fallback in parallel. PO costs are
      // best-effort: if they fail we still compute COGS from All Prices alone.
      const [data, poData] = await Promise.all([
        api.get(`/api/prices/cogs/sales-by-item?${params.toString()}`) as Promise<SalesByItemResponse>,
        (api.get('/api/prices/cogs/purchase-costs') as Promise<PurchaseCostsResponse>).catch(
          () => ({ costs: [] } as PurchaseCostsResponse)
        ),
      ])
      setSalesRows(Array.isArray(data?.rows) ? data.rows : [])
      setMeta(data?.meta || null)
      setPurchaseCosts(Array.isArray(poData?.costs) ? poData.costs : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sales data.'
      setError(message)
      setSalesRows(null)
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [datesInvalid, fromDate, toDate, customerId])

  const money = (n: number) => fmtMoney(n, 2)

  return (
    <section className="page-section ap-cogs" aria-label="COGS calculation">
      <div className="ap-cogs-note" role="note">
        Cost of goods sold for a date range. The unit cost is your <strong>purchase price</strong> from
        the current All Prices list, matched by <strong>item number</strong> (Zoho item names with a
        color suffix match All Prices rows without color, same as purchase planning). When an item is
        not in All Prices, the latest <strong>purchase-order</strong> cost is used as a fallback.{' '}
        <strong>COGS = quantity x unit cost</strong>.
        Leave the customer blank to use the fast all-customers report; pick a customer to compute COGS
        from that customer's invoices (slower, more API calls).
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
        <label className="ap-cogs-customer">
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={customersLoading}>
            <option value="">{customersLoading ? 'Loading customers…' : 'All customers'}</option>
            {customers.map((c) => (
              <option key={c.contact_id} value={c.contact_id}>
                {c.contact_name || c.contact_id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--primary" onClick={handleCalculate} disabled={loading || datesInvalid}>
          {loading ? 'Calculating…' : 'Calculate COGS'}
        </button>
      </div>

      {customersError ? (
        <p className="ap-cogs-meta__warn" role="alert">
          Could not load customers: {customersError}
        </p>
      ) : null}

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
            {meta?.customer_id ? (
              <span>
                Customer: <strong>{selectedCustomerName || meta.customer_id}</strong>.{' '}
              </span>
            ) : (
              <span>All customers. </span>
            )}
            Matched <strong>{result.totals.matchedCount}</strong> item(s)
            {result.totals.matchedFromPurchaseOrders > 0 ? (
              <span>
                {' '}({result.totals.matchedFromAllPrices} from All Prices,{' '}
                {result.totals.matchedFromPurchaseOrders} from purchase orders)
              </span>
            ) : null}
            .{' '}
            {result.totals.unmatchedCount > 0 ? (
              <span>
                <strong>{result.totals.unmatchedCount}</strong> sold item(s) have no matching item
                number in All Prices (see below).
              </span>
            ) : (
              <span>All sold items were priced.</span>
            )}
            {meta?.truncated ? (
              <span className="ap-cogs-meta__warn"> Sales data was truncated by Zoho pagination; totals may be partial.</span>
            ) : null}
          </div>

          <div className="ap-cogs-table-wrap">
            <table className="ap-cogs-table">
              <thead>
                <tr>
                  <th>Item No</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit sales price</th>
                  <th className="num">Cost price</th>
                  <th>Cost source</th>
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
                    <tr key={r.itemId || r.itemName}>
                      <td>{r.itemName || '—'}</td>
                      <td className="num">{money(r.qty)}</td>
                      <td className="num">{money(r.unitPrice)}</td>
                      <td className="num">{money(r.costPrice)}</td>
                      <td>{r.costSource === 'purchase_order' ? 'Purchase order' : 'All Prices'}</td>
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
                    <td>Total</td>
                    <td className="num">{money(result.totals.totalQty)}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td>—</td>
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
              <h3>Unmatched items (no matching item number in All Prices)</h3>
              <p className="ap-cogs-unmatched__hint">
                Add these item numbers (with a purchase price) to the All Prices list so they are
                included in COGS.
              </p>
              <div className="ap-cogs-table-wrap">
                <table className="ap-cogs-table">
                  <thead>
                    <tr>
                      <th>Item No</th>
                      <th className="num">Qty</th>
                      <th className="num">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatched.map((r) => (
                      <tr key={r.item_id || r.item_name || r.sku}>
                        <td>{r.item_name || r.sku || '—'}</td>
                        <td className="num">{money(r.qty)}</td>
                        <td className="num">{money(r.sales_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="ap-cogs-totals-footer">
            <h3>Totals</h3>
            <table className="ap-cogs-table ap-cogs-totals-table">
              <tbody>
                <tr>
                  <th scope="row">Total COGS</th>
                  <td className="num">{money(result.totals.totalCogs)} {currencyLabel}</td>
                </tr>
                <tr>
                  <th scope="row">Total revenue</th>
                  <td className="num">{money(result.totals.totalRevenue)} {currencyLabel}</td>
                </tr>
                <tr>
                  <th scope="row">Gross profit</th>
                  <td className="num">{money(result.totals.grossProfit)} {currencyLabel}</td>
                </tr>
                <tr>
                  <th scope="row">Margin</th>
                  <td className="num">{fmtPct(result.totals.marginPct, 1)}</td>
                </tr>
                <tr>
                  <th scope="row">Units sold</th>
                  <td className="num">{money(result.totals.totalQty)}</td>
                </tr>
                <tr>
                  <th scope="row">Items matched / unmatched</th>
                  <td className="num">
                    {result.totals.matchedCount} / {result.totals.unmatchedCount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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
