import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import './AllPricesPage.css'
import {
  CUSTOM_FIXED_COMMISSION_PCT,
  areCustomUaeRatesValid,
  computeCustomUaePriceRow,
  fmtMoney,
  fmtPct,
  formatLastSavedAt,
  profitMarginDisplayClass,
} from './allPricesEcommerceUtils'

export interface CustomUaeRates {
  vatPct: number
  advertisingPct: number
  requiredProfitPct: number
  commissionPct: number
  updatedAt?: string | null
}

export interface CustomUaeCatalogRow {
  id: string
  itemNo: string
  purchasePrice: string | number
  shipping: string | number
  dateOfPrices: string
}

const DEFAULT_DRAFT_RATES = {
  vatPct: 5,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

function fmtShippingPurchaseDisplay(raw: string | number | null | undefined): string {
  if (raw === '' || raw == null) return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return '—'
  return fmtMoney(n, 2)
}

function parseDraftPct(value: string | number): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function AllUaePricesCustomPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<CustomUaeCatalogRow[]>([])
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<string | null>(null)
  const [savedRates, setSavedRates] = useState<CustomUaeRates | null>(null)
  const [draftVat, setDraftVat] = useState<string | number>(DEFAULT_DRAFT_RATES.vatPct)
  const [draftAdv, setDraftAdv] = useState<string | number>(DEFAULT_DRAFT_RATES.advertisingPct)
  const [draftProfit, setDraftProfit] = useState<string | number>(DEFAULT_DRAFT_RATES.requiredProfitPct)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [ratesRes, catalogRes] = await Promise.all([
        api.get('/api/prices/uae-custom/rates') as Promise<{ rates: CustomUaeRates }>,
        api.get('/api/prices/uae-custom/catalog') as Promise<{
          rows: CustomUaeCatalogRow[]
          updatedAt: string | null
        }>,
      ])
      const rates = ratesRes?.rates
      if (rates) {
        setSavedRates(rates)
        setDraftVat(rates.vatPct)
        setDraftAdv(rates.advertisingPct)
        setDraftProfit(rates.requiredProfitPct)
      }
      setRows(Array.isArray(catalogRes?.rows) ? catalogRes.rows : [])
      setCatalogUpdatedAt(catalogRes?.updatedAt ?? null)
    } catch (err) {
      const msg =
        (err as { body?: { error?: string }; message?: string })?.body?.error ||
        (err as Error)?.message ||
        'Failed to load All UAE Prices (Custom)'
      setLoadError(String(msg))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const draftVatN = parseDraftPct(draftVat)
  const draftAdvN = parseDraftPct(draftAdv)
  const draftProfitN = parseDraftPct(draftProfit)

  const ratesForCalc = useMemo(
    () => ({
      vatPct: draftVatN ?? DEFAULT_DRAFT_RATES.vatPct,
      advertisingPct: draftAdvN ?? DEFAULT_DRAFT_RATES.advertisingPct,
      requiredProfitPct: draftProfitN ?? DEFAULT_DRAFT_RATES.requiredProfitPct,
      commissionPct: CUSTOM_FIXED_COMMISSION_PCT,
    }),
    [draftVatN, draftAdvN, draftProfitN],
  )

  const ratesValid =
    draftVatN != null &&
    draftAdvN != null &&
    draftProfitN != null &&
    areCustomUaeRatesValid(draftVatN, draftAdvN, draftProfitN)

  const feeTakePct =
    (Number(ratesForCalc.vatPct) || 0) +
    CUSTOM_FIXED_COMMISSION_PCT +
    (Number(ratesForCalc.advertisingPct) || 0)

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => String(r.itemNo || '').toLowerCase().includes(q))
  }, [rows, search])

  const dirty =
    savedRates != null &&
    (Number(draftVat) !== Number(savedRates.vatPct) ||
      Number(draftAdv) !== Number(savedRates.advertisingPct) ||
      Number(draftProfit) !== Number(savedRates.requiredProfitPct))

  async function handleSaveRates() {
    if (!isAdmin || !ratesValid) return
    setSaving(true)
    setSaveError(null)
    setSaveOk(null)
    try {
      const res = (await api.put('/api/prices/uae-custom/rates', {
        vatPct: draftVatN,
        advertisingPct: draftAdvN,
        requiredProfitPct: draftProfitN,
      })) as { rates: CustomUaeRates }
      const rates = res?.rates
      if (rates) {
        setSavedRates(rates)
        setDraftVat(rates.vatPct)
        setDraftAdv(rates.advertisingPct)
        setDraftProfit(rates.requiredProfitPct)
      }
      setSaveOk('Rates saved for everyone.')
    } catch (err) {
      const msg =
        (err as { body?: { error?: string }; message?: string })?.body?.error ||
        (err as Error)?.message ||
        'Failed to save rates'
      setSaveError(String(msg))
    } finally {
      setSaving(false)
    }
  }

  function handleResetDraft() {
    if (savedRates) {
      setDraftVat(savedRates.vatPct)
      setDraftAdv(savedRates.advertisingPct)
      setDraftProfit(savedRates.requiredProfitPct)
    } else {
      setDraftVat(DEFAULT_DRAFT_RATES.vatPct)
      setDraftAdv(DEFAULT_DRAFT_RATES.advertisingPct)
      setDraftProfit(DEFAULT_DRAFT_RATES.requiredProfitPct)
    }
    setSaveError(null)
    setSaveOk(null)
  }

  return (
    <div className="page ap-ec-page">
      <header className="doc-page-hero">
        <h1>All UAE Prices (Custom)</h1>
        <p className="doc-page-subtitle">
          Live purchase prices and shipping from All Prices (UAE). Sales prices are recalculated with custom VAT,
          advertising, and profit (commission fixed at {CUSTOM_FIXED_COMMISSION_PCT}%).
        </p>
      </header>

      <section className="page-section ap-ec-wrap" aria-label="Custom rates">
        <div className="ap-ec-formula-note" role="note">
          Purchase prices and shipping sync from the shared All Prices (UAE) catalog and cannot be edited here.
          {catalogUpdatedAt ? (
            <>
              {' '}
              Catalog last updated: <strong>{formatLastSavedAt(catalogUpdatedAt)}</strong>.
            </>
          ) : null}
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
              disabled={!isAdmin || loading}
              onChange={(e) => {
                setDraftVat(e.target.value)
                setSaveOk(null)
              }}
            />
          </label>
          <label>
            Commission %
            <input type="number" value={CUSTOM_FIXED_COMMISSION_PCT} disabled readOnly aria-readonly="true" />
          </label>
          <label>
            Advertising %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draftAdv}
              disabled={!isAdmin || loading}
              onChange={(e) => {
                setDraftAdv(e.target.value)
                setSaveOk(null)
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
              disabled={!isAdmin || loading}
              onChange={(e) => {
                setDraftProfit(e.target.value)
                setSaveOk(null)
              }}
            />
          </label>
          <div className="ap-ec-rates__meta">
            Fee + profit take:{' '}
            <strong>
              {fmtMoney(feeTakePct + (Number(ratesForCalc.requiredProfitPct) || 0), 2)}%
            </strong>{' '}
            (VAT + {CUSTOM_FIXED_COMMISSION_PCT}% commission + advertising + profit)
            {!ratesValid ? (
              <span className="ap-ec-paste__msg ap-ec-paste__msg--err" style={{ marginLeft: '0.75rem' }}>
                Rates must total under 100% (including commission).
              </span>
            ) : null}
          </div>
        </div>

        {isAdmin ? (
          <div className="ap-ec-paste__actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!dirty || !ratesValid || saving || loading}
              onClick={() => void handleSaveRates()}
            >
              {saving ? 'Saving…' : 'Save rates for everyone'}
            </button>
            <button type="button" className="btn btn--ghost" disabled={!dirty || saving} onClick={handleResetDraft}>
              Reset
            </button>
            <button type="button" className="btn btn--ghost" disabled={loading || saving} onClick={() => void load()}>
              Refresh catalog
            </button>
            {saveOk ? <span className="ap-ec-paste__msg">{saveOk}</span> : null}
            {saveError ? <span className="ap-ec-paste__msg ap-ec-paste__msg--err">{saveError}</span> : null}
          </div>
        ) : (
          <div className="ap-ec-paste__actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn btn--ghost" disabled={loading} onClick={() => void load()}>
              Refresh catalog
            </button>
            <span className="ap-ec-save-last ap-ec-save-last--muted">Only admins can change rates.</span>
          </div>
        )}
      </section>

      <section className="page-section ap-ec-wrap" aria-label="Custom price list">
        <div className="ap-ec-rates" style={{ marginBottom: '0.75rem' }}>
          <label>
            Search item no.
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by item…"
              disabled={loading}
            />
          </label>
          <div className="ap-ec-rates__meta">
            Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> items
          </div>
        </div>

        {loading ? <p className="ap-ec-empty">Loading…</p> : null}
        {loadError ? (
          <div className="ap-ec-warning-banner" role="alert">
            <p>
              <strong>Could not load data.</strong> {loadError}
            </p>
            <div className="ap-ec-warning-banner__actions">
              <button type="button" className="btn btn--primary" onClick={() => void load()}>
                Retry
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !loadError && rows.length === 0 ? (
          <p className="ap-ec-empty">
            The shared All Prices (UAE) catalog is empty. Add purchase prices in All Prices (UAE) first.
          </p>
        ) : null}

        {!loading && !loadError && filteredRows.length > 0 ? (
          <div className="ap-table-scroll">
            <table className="ap-ec-table">
              <thead>
                <tr>
                  <th scope="col" className="ap-ec-row-number">
                    Sr no.
                  </th>
                  <th scope="col">Item no.</th>
                  <th scope="col" className="col-purchase">
                    Purchase price
                  </th>
                  <th scope="col">Shipping</th>
                  <th scope="col" className="col-accent">
                    Sales price (AED)
                  </th>
                  <th scope="col">{ratesForCalc.vatPct}% VAT</th>
                  <th scope="col">{CUSTOM_FIXED_COMMISSION_PCT}% commission</th>
                  <th scope="col">{ratesForCalc.advertisingPct}% advertising</th>
                  <th scope="col">Profit</th>
                  <th scope="col">Profit %</th>
                  <th scope="col">Date of prices</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => {
                  const computed = computeCustomUaePriceRow(row, ratesForCalc)
                  const profitClass = profitMarginDisplayClass(computed.profitPct)
                  return (
                    <tr key={row.id || `${row.itemNo}-${index}`}>
                      <td className="ap-ec-row-number">{index + 1}</td>
                      <td>{row.itemNo || '—'}</td>
                      <td className="col-purchase">{fmtShippingPurchaseDisplay(row.purchasePrice)}</td>
                      <td>{fmtShippingPurchaseDisplay(row.shipping)}</td>
                      <td className="col-accent">
                        {computed.denominatorInvalid ? '—' : fmtMoney(computed.salesPrice, 0)}
                      </td>
                      <td>{computed.denominatorInvalid ? '—' : fmtMoney(computed.vatAmount)}</td>
                      <td>{computed.denominatorInvalid ? '—' : fmtMoney(computed.commissionAmount)}</td>
                      <td>{computed.denominatorInvalid ? '—' : fmtMoney(computed.advertisingAmount)}</td>
                      <td className={profitClass}>
                        {computed.denominatorInvalid ? '—' : fmtMoney(computed.profit)}
                      </td>
                      <td className={profitClass}>
                        {computed.denominatorInvalid ? '—' : fmtPct(computed.profitPct)}
                      </td>
                      <td>{row.dateOfPrices || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}
