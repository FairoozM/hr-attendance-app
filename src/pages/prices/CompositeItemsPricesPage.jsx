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
  loadRatesForMarket,
  loadRowsForMarket,
  STORAGE_KEY_RATES,
  STORAGE_KEY_ROWS,
} from '../management/allPricesEcommerceUtils'
import { buildPurchasePriceMap, computeBundleEconomics } from './compositeBundlePricingUtils'
import { COMPOSITE_PRICES_STANDARD, getCompositePricesVariant } from './compositePricesVariants'
import { resolveCompositeComponentPricing } from './compositeComponentPricingResolver'

/**
 * @param {{ variant?: import('./compositePricesVariants').CompositePricesVariantId }} props
 */
export function CompositeItemsPricesPage({ variant = COMPOSITE_PRICES_STANDARD }) {
  const variantCfg = getCompositePricesVariant(variant)
  const [priceTick, setPriceTick] = useState(0)
  const [skuInput, setSkuInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [bundle, setBundle] = useState(null)

  const [bundleShipping, setBundleShipping] = useState('')
  const [dateOfPrice, setDateOfPrice] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

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
    return loadRowsForMarket(variantCfg.pricesMarket) || []
  }, [priceTick, variantCfg.pricesMarket])

  const rates = useMemo(() => {
    void priceTick
    const r = loadRatesForMarket(variantCfg.pricesMarket)
    return {
      vatPct: Number.isFinite(Number(r.vatPct)) ? Number(r.vatPct) : DEFAULT_RATES.vatPct,
      commissionPct: Number.isFinite(Number(r.commissionPct)) ? Number(r.commissionPct) : DEFAULT_RATES.commissionPct,
      advertisingPct: Number.isFinite(Number(r.advertisingPct)) ? Number(r.advertisingPct) : DEFAULT_RATES.advertisingPct,
      requiredProfitPct: Number.isFinite(Number(r.requiredProfitPct))
        ? Number(r.requiredProfitPct)
        : DEFAULT_RATES.requiredProfitPct,
    }
  }, [priceTick, variantCfg.pricesMarket])

  const purchaseMap = useMemo(() => buildPurchasePriceMap(ecommerceRows), [ecommerceRows])

  const componentRows = useMemo(() => {
    if (!bundle?.components) return []
    return bundle.components.map((c) => {
      const resolved = resolveCompositeComponentPricing(c, purchaseMap, rates)
      const purchase = resolved.purchasePrice
      const purchaseMatch = resolved.matchedAllPricesRecordFound
        ? {
            itemNo: resolved.matchedAllPricesItemNo,
            sku: resolved.matchedAllPricesSku,
            purchasePrice: resolved.purchasePrice,
            shipping: resolved.shipping,
            dateOfPrices: resolved.dateOfPrice,
            matchedKey: resolved.matchKeyUsed,
            matchKind: resolved.matchKind,
          }
        : null
      const matchedListRow = purchaseMatch
        ? {
            itemNo: purchaseMatch.itemNo,
            sku: purchaseMatch.sku || purchaseMatch.itemNo,
            purchasePrice: purchaseMatch.purchasePrice,
            shipping: purchaseMatch.shipping ?? '',
            dateOfPrices: purchaseMatch.dateOfPrices || '',
          }
        : null
      const matchedEconomics = resolved.matchedAllPricesRecordFound
        ? {
            denominatorInvalid: resolved.pricingStatus !== 'complete',
            salesPrice: resolved.salesPriceAed,
            vatAmount: resolved.vat5,
            commissionAmount: resolved.commission15,
            advertisingAmount: resolved.advertising15,
            totalCost: resolved.totalCost,
            profit: resolved.profitAed,
            profitPct: resolved.profitPercent,
          }
        : null
      return {
        ...c,
        resolvedPricing: resolved,
        purchaseMatch,
        matchedListRow,
        matchedEconomics,
        purchaseFromList: purchase,
        lineTotal: resolved.linePurchaseTotal,
        missing: !resolved.matchedAllPricesRecordFound,
      }
    })
  }, [bundle, purchaseMap, rates])

  const missingCount = useMemo(() => componentRows.filter((r) => r.missing).length, [componentRows])
  const duplicateActiveCount = useMemo(
    () => componentRows.filter((r) => r.resolvedPricing?.matchStatus === 'DUPLICATE_ACTIVE_PRICE').length,
    [componentRows],
  )

  const totalPurchaseCost = useMemo(
    () => componentRows.reduce((sum, r) => sum + (Number.isFinite(r.lineTotal) ? r.lineTotal : 0), 0),
    [componentRows]
  )

  const economics = useMemo(() => {
    const ship = Number(bundleShipping)
    const shipN = Number.isFinite(ship) ? Math.max(0, ship) : 0
    return computeBundleEconomics(totalPurchaseCost, shipN, rates)
  }, [totalPurchaseCost, bundleShipping, rates])

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
      setSaveMessage('')
    } catch (e) {
      setBundle(null)
      setFetchError(e.message || 'Could not load composite item from Zoho.')
    } finally {
      setFetching(false)
    }
  }, [skuInput])

  const handleSaveComposite = useCallback(() => {
    if (!bundle || !economics.ok) return
    try {
      variantCfg.savedStore.save({
        sku: String(bundle.sku || '').trim(),
        name: bundle.name || '',
        composite_item_id: bundle.composite_item_id || '',
        bundleShipping: Number(bundleShipping) || 0,
        dateOfPrice: dateOfPrice || '',
        rates,
        components: componentRows.map((row) => ({
          item_id: row.item_id || '',
          sku: row.sku || '',
          name: row.name || '',
          quantity: Number(row.quantity) || 0,
          purchaseMatch: row.purchaseMatch
            ? {
                itemNo: row.purchaseMatch.itemNo || '',
                matchKind: row.purchaseMatch.matchKind || '',
              }
            : null,
          matchedListRow: row.matchedListRow || null,
          matchedEconomics: row.matchedEconomics || null,
          purchaseFromList: row.purchaseFromList,
          lineTotal: row.lineTotal,
          missing: !!row.missing,
        })),
        totalPurchaseCost,
        economics,
      })
      setSaveMessage(`Saved ${bundle.sku} to ${variantCfg.savedTitle}.`)
    } catch (err) {
      setSaveMessage(err?.message || 'Could not save this composite item.')
    }
  }, [bundle, economics, bundleShipping, dateOfPrice, rates, componentRows, totalPurchaseCost, variantCfg])

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
          <h1 className="doc-page-title">{variantCfg.calculatorTitle}</h1>
          <p className="doc-page-subtitle">
            Fetch a <strong>single</strong> composite bundle from Zoho by SKU (one search + one composite detail + one
            call per component to read real Inventory SKUs). Component purchase prices come from your saved{' '}
            <NavLink to={variantCfg.catalogRoute}>{variantCfg.catalogLabel}</NavLink> list. Use one bundle shipping
            figure (e.g. FBA).
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
          <NavLink className="btn btn--ghost" to={variantCfg.savedRoute}>
            Saved list
          </NavLink>
        </div>

        {fetchError ? (
          <p className="cb-bundle-error" role="alert">
            {fetchError}
          </p>
        ) : null}

        <div className="cb-bundle-rates" role="note">
          Rates (from {variantCfg.catalogLabel}): VAT <strong>{fmtMoney(rates.vatPct, 1)}%</strong> · Commission{' '}
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

            <div className="cb-bundle-save-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSaveComposite}
                disabled={!economics.ok}
              >
                Save composite item
              </button>
              {saveMessage ? <span className="cb-bundle-save-row__msg">{saveMessage}</span> : null}
            </div>

            {missingCount > 0 ? (
              <p className="cb-bundle-warn" role="status">
                {missingCount} component SKU(s) are not matched cleanly in your price list — purchase columns show “—”
                and do not contribute to the purchase total until you add or resolve them under{' '}
                <NavLink to={variantCfg.catalogRoute}>{variantCfg.catalogLabel}</NavLink>.
              </p>
            ) : null}
            {duplicateActiveCount > 0 ? (
              <p className="cb-bundle-warn" role="alert">
                Duplicate active price found. Resolve in{' '}
                <NavLink to={variantCfg.duplicateFixRoute}>{variantCfg.duplicateFixLabel}</NavLink>.
              </p>
            ) : null}

            <div className="cb-bundle-controls">
              <label className="cb-bundle-field">
                Date of price
                <input type="date" value={dateOfPrice} onChange={(e) => setDateOfPrice(e.target.value)} />
              </label>
            </div>

            <div className="ap-table-scroll cb-table-scroll">
              <table className="ap-ec-table cb-bundle-table">
                <thead>
                  <tr>
                    <th scope="col">Composite item no.</th>
                    <th scope="col">Component item no.</th>
                    <th scope="col">Matched {variantCfg.catalogShortLabel} SKU</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Purchase price ecommerce</th>
                    <th scope="col">Total component purchase</th>
                    <th scope="col">Manual shipping</th>
                    <th scope="col" className="cb-sales-price-cell">Suggested sales price</th>
                    <th scope="col">{rates.vatPct}% VAT</th>
                    <th scope="col">{rates.commissionPct}% commission</th>
                    <th scope="col">{rates.advertisingPct}% advertising</th>
                    <th scope="col">Total cost</th>
                    <th scope="col">Profit AED</th>
                    <th scope="col" className="cb-profit-percent-cell">Profit %</th>
                    <th scope="col">Date of price</th>
                  </tr>
                </thead>
                <tbody>
                  {componentRows.map((row, idx) => (
                    <tr key={`${row.item_id}-${idx}`}>
                      <td>{bundle.sku}</td>
                      <td className="cb-component-cell">
                        <span className="cb-component-cell__sku">{row.sku || '—'}</span>
                        {row.name &&
                        String(row.name).trim() &&
                        String(row.name).trim().toLowerCase() !== String(row.sku || '').trim().toLowerCase() ? (
                          <span className="cb-component-cell__name">{row.name}</span>
                        ) : null}
                      </td>
                      <td className="cb-match-cell">
                        {row.purchaseMatch ? (
                          <>
                            <span className="cb-match-cell__sku">{row.purchaseMatch.itemNo}</span>
                            {row.purchaseMatch.matchKind === 'base_without_color' ? (
                              <span className="cb-match-cell__hint">Base SKU match</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="cb-missing">
                            {row.resolvedPricing?.matchStatus === 'DUPLICATE_ACTIVE_PRICE'
                              ? `Duplicate active price found. Resolve in ${variantCfg.duplicateFixLabel}.`
                              : '—'}
                          </span>
                        )}
                      </td>
                      <td>{Number.isFinite(Number(row.quantity)) ? String(row.quantity) : '—'}</td>
                      <td>{row.missing ? <span className="cb-missing">—</span> : fmtMoney(row.purchaseFromList, 2)}</td>
                      <td>{row.lineTotal != null ? fmtMoney(row.lineTotal, 2) : '—'}</td>
                      <td>
                        {row.matchedListRow && Number.isFinite(Number(row.matchedListRow.shipping))
                          ? fmtMoney(row.matchedListRow.shipping, 2)
                          : '—'}
                      </td>
                      <td className="cb-sales-price-cell">
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.salesPrice, 0)
                          : '—'}
                      </td>
                      <td>
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.vatAmount, 2)
                          : '—'}
                      </td>
                      <td>
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.commissionAmount, 2)
                          : '—'}
                      </td>
                      <td>
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.advertisingAmount, 2)
                          : '—'}
                      </td>
                      <td>
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.totalCost, 2)
                          : '—'}
                      </td>
                      <td>
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtMoney(row.matchedEconomics.profit, 2)
                          : '—'}
                      </td>
                      <td className="cb-profit-percent-cell">
                        {row.matchedEconomics && !row.matchedEconomics.denominatorInvalid
                          ? fmtPct(row.matchedEconomics.profitPct, 2)
                          : '—'}
                      </td>
                      <td>{row.matchedListRow?.dateOfPrices || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="cb-bundle-summary">
                    <td className="cb-bundle-summary__label">Bundle totals</td>
                    <td className="cb-bundle-summary__spacer" aria-hidden="true" />
                    <td className="cb-bundle-summary__spacer" aria-hidden="true" />
                    <td className="cb-bundle-summary__spacer" aria-hidden="true" />
                    <td className="cb-bundle-summary__spacer" aria-hidden="true" />
                    <td>{fmtMoney(totalPurchaseCost, 2)}</td>
                    <td>
                      <input
                        className="cb-bundle-summary__shipping-input"
                        type="number"
                        min={0}
                        step={0.01}
                        value={bundleShipping}
                        onChange={(e) => setBundleShipping(e.target.value)}
                        placeholder="0.00"
                        aria-label="Bundle manual shipping"
                      />
                    </td>
                    <td className="cb-sales-price-cell">
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
                    <td className="cb-profit-percent-cell">{economics.ok ? fmtPct(economics.profitPct, 2) : '—'}</td>
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
