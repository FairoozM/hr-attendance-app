import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../../api/client'
import '../Page.css'
import '../management/DocumentExpiryPage.css'
import '../management/AllPricesPage.css'
import './CompositeItemsPricesPage.css'
import {
  DEFAULT_RATES,
  fmtMoney,
  fmtPct,
  loadRates,
  loadRows,
  makeRowId,
  STORAGE_KEY_RATES,
  STORAGE_KEY_ROWS,
} from '../management/allPricesEcommerceUtils'
import { buildPurchasePriceMap, computeBundleEconomics } from './compositeBundlePricingUtils'

export function CompositeItemsPricesPage() {
  const [priceTick, setPriceTick] = useState(0)
  const [skuInput, setSkuInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [bundle, setBundle] = useState(null)

  const [bundleShipping, setBundleShipping] = useState('')
  const [dateOfPrice, setDateOfPrice] = useState('')
  const [extras, setExtras] = useState(() => [{ id: makeRowId(), label: '', amount: '' }])

  useEffect(() => {
    const bump = (e) => {
      if (e.key === STORAGE_KEY_ROWS || e.key === STORAGE_KEY_RATES) {
        setPriceTick((t) => t + 1)
      }
    }
    window.addEventListener('storage', bump)
    return () => window.removeEventListener('storage', bump)
  }, [])

  useEffect(() => {
    const onFocus = () => setPriceTick((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const ecommerceRows = useMemo(() => {
    void priceTick
    return loadRows() || []
  }, [priceTick])

  const rates = useMemo(() => {
    void priceTick
    const r = loadRates()
    return {
      vatPct: Number.isFinite(Number(r.vatPct)) ? Number(r.vatPct) : DEFAULT_RATES.vatPct,
      commissionPct: Number.isFinite(Number(r.commissionPct)) ? Number(r.commissionPct) : DEFAULT_RATES.commissionPct,
      advertisingPct: Number.isFinite(Number(r.advertisingPct)) ? Number(r.advertisingPct) : DEFAULT_RATES.advertisingPct,
      requiredProfitPct: Number.isFinite(Number(r.requiredProfitPct))
        ? Number(r.requiredProfitPct)
        : DEFAULT_RATES.requiredProfitPct,
    }
  }, [priceTick])

  const purchaseMap = useMemo(() => buildPurchasePriceMap(ecommerceRows), [ecommerceRows])

  const componentRows = useMemo(() => {
    if (!bundle?.components) return []
    return bundle.components.map((c) => {
      const key = String(c.sku || '')
        .trim()
        .toLowerCase()
      const purchase = key && purchaseMap.has(key) ? purchaseMap.get(key) : null
      const qty = Number(c.quantity) || 0
      const lineTotal = purchase != null && Number.isFinite(purchase) ? purchase * qty : null
      return {
        ...c,
        purchaseFromList: purchase,
        lineTotal,
        missing: purchase == null || !Number.isFinite(purchase),
      }
    })
  }, [bundle, purchaseMap])

  const missingCount = useMemo(() => componentRows.filter((r) => r.missing).length, [componentRows])

  const totalPurchaseCost = useMemo(
    () => componentRows.reduce((sum, r) => sum + (Number.isFinite(r.lineTotal) ? r.lineTotal : 0), 0),
    [componentRows]
  )

  const extrasSum = useMemo(
    () =>
      extras.reduce((sum, x) => {
        const n = Number(x.amount)
        return sum + (Number.isFinite(n) ? n : 0)
      }, 0),
    [extras]
  )

  const economics = useMemo(() => {
    const ship = Number(bundleShipping)
    const shipN = Number.isFinite(ship) ? Math.max(0, ship) : 0
    return computeBundleEconomics(totalPurchaseCost, shipN, extrasSum, rates)
  }, [totalPurchaseCost, bundleShipping, extrasSum, rates])

  const handleFetch = useCallback(async () => {
    setFetchError('')
    const sku = skuInput.trim()
    if (!sku) {
      setFetchError('Enter a composite item SKU or item number, then click Fetch.')
      return
    }
    setFetching(true)
    try {
      const data = await api.post('/api/prices/composite-items/lookup', { sku })
      setBundle(data)
      setBundleShipping('')
      setExtras([{ id: makeRowId(), label: '', amount: '' }])
    } catch (e) {
      setBundle(null)
      setFetchError(e.message || 'Could not load composite item from Zoho.')
    } finally {
      setFetching(false)
    }
  }, [skuInput])

  const addExtraRow = useCallback(() => {
    setExtras((prev) => [...prev, { id: makeRowId(), label: '', amount: '' }])
  }, [])

  const removeExtraRow = useCallback((id) => {
    setExtras((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== id)))
  }, [])

  const sumTakePct =
    (Number(rates.vatPct) || 0) +
    (Number(rates.commissionPct) || 0) +
    (Number(rates.advertisingPct) || 0) +
    (Number(rates.requiredProfitPct) || 0)
  const divisorPct = Math.max(0, 100 - sumTakePct)

  return (
    <div className="page composite-prices-page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Composite Items Prices</h1>
          <p className="doc-page-subtitle">
            Fetch a <strong>single</strong> composite bundle from Zoho by SKU (one search + one composite detail + one
            call per component to read real Inventory SKUs). Component purchase prices come from your saved{' '}
            <NavLink to="/prices/all-prices">All Prices (UAE &amp; KSA)</NavLink> list (this browser). Use one bundle
            shipping figure (e.g. FBA) plus optional extras (carton, tools, packaging).
          </p>
        </div>
      </div>

      <section className="page-section cb-bundle-section" aria-label="Composite bundle pricing">
        <div className="cb-bundle-toolbar">
          <label className="cb-bundle-search">
            <span className="cb-bundle-search__label">Composite SKU</span>
            <input
              type="text"
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              placeholder="e.g. bundle SKU from Zoho"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFetch()
              }}
            />
          </label>
          <button type="button" className="btn btn--primary" disabled={fetching} onClick={handleFetch}>
            {fetching ? 'Fetching…' : 'Fetch from Zoho'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPriceTick((t) => t + 1)}>
            Reload price list
          </button>
        </div>

        {fetchError ? (
          <p className="cb-bundle-error" role="alert">
            {fetchError}
          </p>
        ) : null}

        <div className="cb-bundle-rates" role="note">
          Rates (from All Prices): VAT <strong>{fmtMoney(rates.vatPct, 1)}%</strong> · Commission{' '}
          <strong>{fmtMoney(rates.commissionPct, 1)}%</strong> · Advertising{' '}
          <strong>{fmtMoney(rates.advertisingPct, 1)}%</strong> · Required profit{' '}
          <strong>{fmtMoney(rates.requiredProfitPct, 1)}%</strong> · Effective divisor{' '}
          <strong>{fmtMoney(divisorPct, 2)}%</strong>
          {sumTakePct >= 100 ? (
            <span className="cb-bundle-rates--bad"> — rates must sum under 100%.</span>
          ) : null}
        </div>

        {bundle ? (
          <>
            <div className="cb-bundle-meta">
              <strong>{bundle.sku}</strong>
              {bundle.name ? <span className="cb-bundle-meta__name"> — {bundle.name}</span> : null}
              <span className="cb-bundle-meta__id"> · Zoho composite ID {bundle.composite_item_id}</span>
            </div>

            {missingCount > 0 ? (
              <p className="cb-bundle-warn" role="status">
                {missingCount} component SKU(s) are not in your ecommerce price list — purchase columns show “—” and
                do not contribute to the purchase total until you add them under{' '}
                <NavLink to="/prices/all-prices">All Prices</NavLink>.
              </p>
            ) : null}

            <div className="cb-bundle-controls">
              <label className="cb-bundle-field">
                Bundle shipping (AED)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={bundleShipping}
                  onChange={(e) => setBundleShipping(e.target.value)}
                  placeholder="FBA / referral + shipping"
                />
              </label>
              <label className="cb-bundle-field">
                Date of price
                <input type="date" value={dateOfPrice} onChange={(e) => setDateOfPrice(e.target.value)} />
              </label>
            </div>

            <div className="cb-extras">
              <div className="cb-extras__head">
                <h3>Extra manual costs</h3>
                <button type="button" className="btn btn--ghost btn--sm" onClick={addExtraRow}>
                  + Add row
                </button>
              </div>
              <div className="cb-extras__rows">
                {extras.map((row) => (
                  <div key={row.id} className="cb-extras__row">
                    <input
                      type="text"
                      placeholder="Label (carton, tool, …)"
                      value={row.label}
                      onChange={(e) =>
                        setExtras((prev) => prev.map((x) => (x.id === row.id ? { ...x, label: e.target.value } : x)))
                      }
                      aria-label="Extra cost label"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="Amount AED"
                      value={row.amount}
                      onChange={(e) =>
                        setExtras((prev) => prev.map((x) => (x.id === row.id ? { ...x, amount: e.target.value } : x)))
                      }
                      aria-label="Extra cost amount"
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm cb-extras__remove"
                      onClick={() => removeExtraRow(row.id)}
                      disabled={extras.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="ap-table-scroll cb-table-scroll">
              <table className="ap-ec-table cb-bundle-table">
                <thead>
                  <tr>
                    <th scope="col">Composite item no.</th>
                    <th scope="col">Component item no.</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Purchase price ecommerce</th>
                    <th scope="col">Total component purchase</th>
                    <th scope="col">Manual shipping</th>
                    <th scope="col">Extra manual</th>
                    <th scope="col">Suggested sales price</th>
                    <th scope="col">{rates.vatPct}% VAT</th>
                    <th scope="col">{rates.commissionPct}% commission</th>
                    <th scope="col">{rates.advertisingPct}% advertising</th>
                    <th scope="col">Total cost</th>
                    <th scope="col">Profit AED</th>
                    <th scope="col">Profit %</th>
                    <th scope="col">Date of price</th>
                  </tr>
                </thead>
                <tbody>
                  {componentRows.map((row, idx) => (
                    <tr key={`${row.item_id}-${idx}`}>
                      <td>{bundle.sku}</td>
                      <td>{row.sku || '—'}</td>
                      <td>{Number.isFinite(Number(row.quantity)) ? String(row.quantity) : '—'}</td>
                      <td>{row.missing ? <span className="cb-missing">—</span> : fmtMoney(row.purchaseFromList, 2)}</td>
                      <td>{row.lineTotal != null ? fmtMoney(row.lineTotal, 2) : '—'}</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                      <td className="cb-na">—</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="cb-bundle-summary">
                    <td colSpan={4} className="cb-bundle-summary__label">
                      Bundle totals
                    </td>
                    <td>{fmtMoney(totalPurchaseCost, 2)}</td>
                    <td>{fmtMoney(Number(bundleShipping) || 0, 2)}</td>
                    <td>{fmtMoney(extrasSum, 2)}</td>
                    <td>
                      {economics.ok ? (
                        fmtMoney(economics.salesPrice, 0)
                      ) : (
                        <span className="cb-missing">—</span>
                      )}
                    </td>
                    <td>{economics.ok ? fmtMoney(economics.vatAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.commissionAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.advertisingAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.totalCost, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.profit, 2) : '—'}</td>
                    <td>{economics.ok ? fmtPct(economics.profitPct, 2) : '—'}</td>
                    <td>{dateOfPrice || '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {!economics.ok ? (
              <p className="cb-bundle-error" role="alert">
                {economics.error}
              </p>
            ) : null}

            <p className="cb-bundle-footnote">
              Suggested price rounds <strong>up</strong> to the nearest whole AED, then bumps if needed so profit % is
              at least <strong>{fmtMoney(rates.requiredProfitPct, 1)}%</strong> of sales.
            </p>
          </>
        ) : (
          <p className="composite-prices-placeholder">
            Enter a composite SKU and click <strong>Fetch from Zoho</strong>. Only that item is requested (search +
            detail); your full catalog is never synced here.
          </p>
        )}
      </section>
    </div>
  )
}
