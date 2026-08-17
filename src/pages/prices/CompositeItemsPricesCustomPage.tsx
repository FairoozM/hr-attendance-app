import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import '../Page.css'
import '../management/DocumentExpiryPage.css'
import '../management/AllPricesPage.css'
import './CompositeItemsPricesPage.css'
import {
  fmtMoney,
  fmtPct,
  loadRows,
  STORAGE_KEY_ROWS,
} from '../management/allPricesEcommerceUtils'
import {
  buildPurchasePriceMap,
  computeBundleEconomics,
  saveSavedCompositeItemCustom,
} from './compositeBundlePricingUtils'
import { resolveCompositeComponentPricing } from './compositeComponentPricingResolver'

export interface CompositeCustomRates {
  vatPct: number
  commissionPct: number
  advertisingPct: number
  requiredProfitPct: number
  updatedAt?: string | null
  updatedBy?: number | null
}

interface ZohoCompositeComponent {
  item_id?: string
  sku?: string
  name?: string
  quantity?: number
  match_keys?: string[]
  zoho_purchase_rate?: number
}

interface ZohoCompositeBundle {
  composite_item_id?: string
  sku?: string
  name?: string
  components?: ZohoCompositeComponent[]
}

const DEFAULT_DRAFT_RATES: CompositeCustomRates = {
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

function parseDraftPct(value: string | number): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function areCompositeCustomRatesValid(
  vatPct: number,
  commissionPct: number,
  advertisingPct: number,
  requiredProfitPct: number,
): boolean {
  const sum = vatPct + commissionPct + advertisingPct + requiredProfitPct
  return sum < 100
}

export function CompositeItemsPricesCustomPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { prefsVersion } = useUserPreferences()

  const [priceTick, setPriceTick] = useState(0)
  const [skuInput, setSkuInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [bundle, setBundle] = useState<ZohoCompositeBundle | null>(null)

  const [bundleShipping, setBundleShipping] = useState('')
  const [dateOfPrice, setDateOfPrice] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const [ratesLoading, setRatesLoading] = useState(true)
  const [ratesLoadError, setRatesLoadError] = useState<string | null>(null)
  const [savedRates, setSavedRates] = useState<CompositeCustomRates | null>(null)
  const [draftVat, setDraftVat] = useState<string | number>(DEFAULT_DRAFT_RATES.vatPct)
  const [draftComm, setDraftComm] = useState<string | number>(DEFAULT_DRAFT_RATES.commissionPct)
  const [draftAdv, setDraftAdv] = useState<string | number>(DEFAULT_DRAFT_RATES.advertisingPct)
  const [draftProfit, setDraftProfit] = useState<string | number>(DEFAULT_DRAFT_RATES.requiredProfitPct)
  const [savingRates, setSavingRates] = useState(false)
  const [ratesSaveError, setRatesSaveError] = useState<string | null>(null)
  const [ratesSaveOk, setRatesSaveOk] = useState<string | null>(null)

  const loadRates = useCallback(async () => {
    setRatesLoading(true)
    setRatesLoadError(null)
    try {
      const res = (await api.get('/api/prices/uae-composite-custom/rates')) as {
        rates: CompositeCustomRates
      }
      const rates = res?.rates
      if (rates) {
        setSavedRates(rates)
        setDraftVat(rates.vatPct)
        setDraftComm(rates.commissionPct)
        setDraftAdv(rates.advertisingPct)
        setDraftProfit(rates.requiredProfitPct)
      }
    } catch (err) {
      const msg =
        (err as { body?: { error?: string }; message?: string })?.body?.error ||
        (err as Error)?.message ||
        'Failed to load composite custom rates'
      setRatesLoadError(String(msg))
    } finally {
      setRatesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  useEffect(() => {
    const bump = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_ROWS) {
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

  // prefsVersion covers price-list edits made elsewhere in this session; the window listeners
  // above only fire for other tabs.
  const ecommerceRows = useMemo(() => {
    void priceTick
    void prefsVersion
    return loadRows() || []
  }, [prefsVersion, priceTick])

  const draftVatN = parseDraftPct(draftVat)
  const draftCommN = parseDraftPct(draftComm)
  const draftAdvN = parseDraftPct(draftAdv)
  const draftProfitN = parseDraftPct(draftProfit)

  const rates = useMemo(
    () => ({
      vatPct: draftVatN ?? DEFAULT_DRAFT_RATES.vatPct,
      commissionPct: draftCommN ?? DEFAULT_DRAFT_RATES.commissionPct,
      advertisingPct: draftAdvN ?? DEFAULT_DRAFT_RATES.advertisingPct,
      requiredProfitPct: draftProfitN ?? DEFAULT_DRAFT_RATES.requiredProfitPct,
    }),
    [draftVatN, draftCommN, draftAdvN, draftProfitN],
  )

  const ratesValid =
    draftVatN != null &&
    draftCommN != null &&
    draftAdvN != null &&
    draftProfitN != null &&
    areCompositeCustomRatesValid(draftVatN, draftCommN, draftAdvN, draftProfitN)

  const ratesDirty =
    savedRates != null &&
    (Number(draftVat) !== Number(savedRates.vatPct) ||
      Number(draftComm) !== Number(savedRates.commissionPct) ||
      Number(draftAdv) !== Number(savedRates.advertisingPct) ||
      Number(draftProfit) !== Number(savedRates.requiredProfitPct))

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
    [componentRows],
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
      const data = (await api.post('/api/prices/composite-items/lookup', { sku })) as ZohoCompositeBundle
      setBundle(data)
      setBundleShipping('')
      setSaveMessage('')
    } catch (e) {
      setBundle(null)
      setFetchError((e as Error).message || 'Could not load composite item from Zoho.')
    } finally {
      setFetching(false)
    }
  }, [skuInput])

  const handleSaveComposite = useCallback(() => {
    if (!bundle || !economics.ok) return
    try {
      saveSavedCompositeItemCustom({
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
      setSaveMessage(`Saved ${bundle.sku} to Saved Composite Items (Custom).`)
    } catch (err) {
      setSaveMessage((err as Error)?.message || 'Could not save this composite item.')
    }
  }, [bundle, economics, bundleShipping, dateOfPrice, rates, componentRows, totalPurchaseCost])

  async function handleSaveRates() {
    if (!isAdmin || !ratesValid) return
    setSavingRates(true)
    setRatesSaveError(null)
    setRatesSaveOk(null)
    try {
      const res = (await api.put('/api/prices/uae-composite-custom/rates', {
        vatPct: draftVatN,
        commissionPct: draftCommN,
        advertisingPct: draftAdvN,
        requiredProfitPct: draftProfitN,
      })) as { rates: CompositeCustomRates }
      const next = res?.rates
      if (next) {
        setSavedRates(next)
        setDraftVat(next.vatPct)
        setDraftComm(next.commissionPct)
        setDraftAdv(next.advertisingPct)
        setDraftProfit(next.requiredProfitPct)
      }
      setRatesSaveOk('Rates saved for everyone.')
    } catch (err) {
      const msg =
        (err as { body?: { error?: string }; message?: string })?.body?.error ||
        (err as Error)?.message ||
        'Failed to save rates'
      setRatesSaveError(String(msg))
    } finally {
      setSavingRates(false)
    }
  }

  function handleResetDraft() {
    if (savedRates) {
      setDraftVat(savedRates.vatPct)
      setDraftComm(savedRates.commissionPct)
      setDraftAdv(savedRates.advertisingPct)
      setDraftProfit(savedRates.requiredProfitPct)
    } else {
      setDraftVat(DEFAULT_DRAFT_RATES.vatPct)
      setDraftComm(DEFAULT_DRAFT_RATES.commissionPct)
      setDraftAdv(DEFAULT_DRAFT_RATES.advertisingPct)
      setDraftProfit(DEFAULT_DRAFT_RATES.requiredProfitPct)
    }
    setRatesSaveError(null)
    setRatesSaveOk(null)
  }

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
          <h1 className="doc-page-title">Composite Items Prices (Custom)</h1>
          <p className="doc-page-subtitle">
            Same Zoho composite lookup and All Prices (UAE) purchase matching as the standard calculator, with editable
            VAT, commission, advertising, and profit rates shared for everyone. Saving here writes to{' '}
            <NavLink to="/prices/saved-composite-items-custom">Saved Composite Items (Custom)</NavLink> only.
          </p>
        </div>
      </div>

      <section className="page-section cb-bundle-section" aria-label="Custom composite rates">
        <div className="ap-ec-formula-note" role="note">
          Purchase prices sync from your All Prices (UAE) list. Rates below are independent of All UAE Prices (Custom)
          and of the non-editable rates on Composite Items Prices.
        </div>

        <div className="ap-ec-rates">
          <label>
            VAT %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draftVat}
              disabled={!isAdmin || ratesLoading}
              onChange={(e) => {
                setDraftVat(e.target.value)
                setRatesSaveOk(null)
              }}
            />
          </label>
          <label>
            Commission %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draftComm}
              disabled={!isAdmin || ratesLoading}
              onChange={(e) => {
                setDraftComm(e.target.value)
                setRatesSaveOk(null)
              }}
            />
          </label>
          <label>
            Advertising %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draftAdv}
              disabled={!isAdmin || ratesLoading}
              onChange={(e) => {
                setDraftAdv(e.target.value)
                setRatesSaveOk(null)
              }}
            />
          </label>
          <label>
            Profit %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draftProfit}
              disabled={!isAdmin || ratesLoading}
              onChange={(e) => {
                setDraftProfit(e.target.value)
                setRatesSaveOk(null)
              }}
            />
          </label>
          <div className="ap-ec-rates__meta">
            Fee + profit take: <strong>{fmtMoney(sumTakePct, 2)}%</strong> · Effective divisor{' '}
            <strong>{fmtMoney(divisorPct, 2)}%</strong>
            {!ratesValid ? (
              <span className="ap-ec-paste__msg ap-ec-paste__msg--err" style={{ marginLeft: '0.75rem' }}>
                Rates must total under 100%.
              </span>
            ) : null}
          </div>
        </div>

        {ratesLoadError ? (
          <p className="cb-bundle-error" role="alert">
            {ratesLoadError}
          </p>
        ) : null}

        {isAdmin ? (
          <div className="ap-ec-paste__actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!ratesDirty || !ratesValid || savingRates || ratesLoading}
              onClick={() => void handleSaveRates()}
            >
              {savingRates ? 'Saving…' : 'Save rates for everyone'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!ratesDirty || savingRates}
              onClick={handleResetDraft}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ratesLoading || savingRates}
              onClick={() => void loadRates()}
            >
              Refresh rates
            </button>
            {ratesSaveOk ? <span className="ap-ec-paste__msg">{ratesSaveOk}</span> : null}
            {ratesSaveError ? <span className="ap-ec-paste__msg ap-ec-paste__msg--err">{ratesSaveError}</span> : null}
          </div>
        ) : (
          <div className="ap-ec-paste__actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ratesLoading}
              onClick={() => void loadRates()}
            >
              Refresh rates
            </button>
            <span className="ap-ec-save-last ap-ec-save-last--muted">Only admins can change rates.</span>
          </div>
        )}
      </section>

      <section className="page-section cb-bundle-section" aria-label="Composite bundle pricing custom">
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
                if (e.key === 'Enter') void handleFetch()
              }}
            />
          </label>
          <button type="button" className="btn btn--primary" disabled={fetching} onClick={() => void handleFetch()}>
            {fetching ? 'Fetching…' : 'Fetch from Zoho'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPriceTick((t) => t + 1)}>
            Reload price list
          </button>
          <NavLink className="btn btn--ghost" to="/prices/saved-composite-items-custom">
            Saved list (Custom)
          </NavLink>
        </div>

        {fetchError ? (
          <p className="cb-bundle-error" role="alert">
            {fetchError}
          </p>
        ) : null}

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
                disabled={!economics.ok || !ratesValid}
              >
                Save composite item
              </button>
              {saveMessage ? <span className="cb-bundle-save-row__msg">{saveMessage}</span> : null}
            </div>

            {missingCount > 0 ? (
              <p className="cb-bundle-warn" role="status">
                {missingCount} component SKU(s) are not matched cleanly in your ecommerce price list — purchase columns
                show “—” and do not contribute to the purchase total until you add or resolve them under{' '}
                <NavLink to="/prices/all-prices">All Prices</NavLink>.
              </p>
            ) : null}
            {duplicateActiveCount > 0 ? (
              <p className="cb-bundle-warn" role="alert">
                Duplicate active price found. Resolve in{' '}
                <NavLink to="/prices/duplicate-cleanup">Duplicate Price Cleanup</NavLink>.
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
                    <th scope="col">Matched All Prices SKU</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Purchase price ecommerce</th>
                    <th scope="col">Total component purchase</th>
                    <th scope="col">Manual shipping</th>
                    <th scope="col" className="cb-sales-price-cell">
                      Suggested sales price
                    </th>
                    <th scope="col">{rates.vatPct}% VAT</th>
                    <th scope="col">{rates.commissionPct}% commission</th>
                    <th scope="col">{rates.advertisingPct}% advertising</th>
                    <th scope="col">Total cost</th>
                    <th scope="col">Profit AED</th>
                    <th scope="col" className="cb-profit-percent-cell">
                      Profit %
                    </th>
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
                              ? 'Duplicate active price found. Resolve in Duplicate Price Cleanup.'
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
                      {economics.ok ? fmtMoney(economics.salesPrice, 0) : <span className="cb-missing">—</span>}
                    </td>
                    <td>{economics.ok ? fmtMoney(economics.vatAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.commissionAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.advertisingAmount, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.totalCost, 2) : '—'}</td>
                    <td>{economics.ok ? fmtMoney(economics.profit, 2) : '—'}</td>
                    <td className="cb-profit-percent-cell">
                      {economics.ok ? fmtPct(economics.profitPct, 2) : '—'}
                    </td>
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
