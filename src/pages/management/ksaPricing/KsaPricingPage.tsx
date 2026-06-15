import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../api/client'
import { PREF_ALL_PRICES_EC_KSA } from '../../../constants/userPreferenceKeys'
import { useUserPreferences } from '../../../contexts/UserPreferencesContext'
import '../DocumentExpiryPage.css'
import '../AllPricesPage.css'
import './KsaPricingPage.css'
import { fmtSar, recalcKsaRow, toOptionalNumber } from './ksaPricingCalc'
import {
  appendKsaPricingHistory,
  createEmptyKsaRow,
  createShipmentBatch,
  emptyKsaPricingHistory,
  emptyKsaPricingStore,
  KSA_PRICING_HISTORY_PREF,
  KSA_PRICING_STORE_PREF,
  normalizeKsaPricingHistory,
  normalizeKsaPricingStore,
  parseKsaPasteLines,
  recalcAllRows,
} from './ksaPricingPrefs'
import type {
  KsaPricingHistoryStore,
  KsaPricingRow,
  KsaPricingStore,
  KsaShipmentBatch,
  ZohoDimensionLookupResult,
  ZohoDimensionStatus,
} from './ksaPricingTypes'

const AUTOSAVE_MS = 500

function zohoBadgeClass(status: ZohoDimensionStatus): string {
  if (status === 'found') return 'ksa-zoho-badge ksa-zoho-badge--found'
  if (status === 'loading') return 'ksa-zoho-badge ksa-zoho-badge--loading'
  if (status === 'manual' || status === 'idle') return 'ksa-zoho-badge ksa-zoho-badge--manual'
  return 'ksa-zoho-badge ksa-zoho-badge--missing_dimensions'
}

function zohoBadgeLabel(status: ZohoDimensionStatus): string {
  if (status === 'found') return 'Zoho'
  if (status === 'loading') return 'Loading'
  if (status === 'missing_dimensions') return 'No dims'
  if (status === 'not_found') return 'Not found'
  if (status === 'manual') return 'Manual'
  if (status === 'error') return 'Error'
  return '—'
}

function indexZohoDimensionResults(results: ZohoDimensionLookupResult[]): Map<string, ZohoDimensionLookupResult> {
  const map = new Map<string, ZohoDimensionLookupResult>()
  for (const result of results) {
    for (const key of [result.requestedSku, result.itemName, result.sku]) {
      const normalized = key?.trim().toLowerCase()
      if (normalized) map.set(normalized, result)
    }
  }
  return map
}

export function KsaPricingPage() {
  const { ready: prefsReady, getPref, setPref, prefsVersion } = useUserPreferences()
  const [store, setStore] = useState<KsaPricingStore>(() => emptyKsaPricingStore())
  const [history, setHistory] = useState<KsaPricingHistoryStore>(() => emptyKsaPricingHistory())
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [dimensionBusy, setDimensionBusy] = useState(false)
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipAutosaveRef = useRef(true)

  const activeBatch = useMemo(
    () => store.batches.find((b) => b.id === store.activeBatchId) || store.batches[0] || null,
    [store.activeBatchId, store.batches]
  )

  const legacyKsaRowsCount = useMemo(() => {
    if (!prefsReady) return 0
    const legacy = getPref(PREF_ALL_PRICES_EC_KSA, null) as { rows?: unknown[] } | null
    return Array.isArray(legacy?.rows) ? legacy.rows.length : 0
  }, [getPref, prefsReady, prefsVersion])

  const persistStore = useCallback(
    (next: KsaPricingStore) => {
      const recalculated = recalcAllRows(next)
      setStore(recalculated)
      setPref(KSA_PRICING_STORE_PREF, { ...recalculated, lastSavedAt: new Date().toISOString() })
    },
    [setPref]
  )

  const persistHistory = useCallback(
    (next: KsaPricingHistoryStore) => {
      setHistory(next)
      setPref(KSA_PRICING_HISTORY_PREF, next)
    },
    [setPref]
  )

  useEffect(() => {
    if (!prefsReady) return
    void prefsVersion
    const loadedStore = normalizeKsaPricingStore(getPref(KSA_PRICING_STORE_PREF, null))
    const loadedHistory = normalizeKsaPricingHistory(getPref(KSA_PRICING_HISTORY_PREF, null))
    setStore(recalcAllRows(loadedStore))
    setHistory(loadedHistory)
    setPrefsLoaded(true)
    skipAutosaveRef.current = true
  }, [getPref, prefsReady, prefsVersion])

  useEffect(() => {
    if (!prefsLoaded || !prefsReady || skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }
    if (autosaveRef.current) clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(() => {
      setPref(KSA_PRICING_STORE_PREF, { ...store, lastSavedAt: new Date().toISOString() })
    }, AUTOSAVE_MS)
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current)
    }
  }, [prefsLoaded, prefsReady, setPref, store])

  const updateBatchField = (field: keyof KsaShipmentBatch, value: string | number) => {
    if (!activeBatch) return
    const batches = store.batches.map((b) =>
      b.id === activeBatch.id
        ? { ...b, [field]: value, updatedAt: new Date().toISOString() }
        : b
    )
    persistStore({ ...store, batches })
  }

  const createBatch = () => {
    const batch = createShipmentBatch()
    persistStore({
      ...store,
      batches: [batch, ...store.batches],
      activeBatchId: batch.id,
    })
    setNotice(`Created shipment batch "${batch.name}".`)
  }

  const selectBatch = (batchId: string) => {
    persistStore({ ...store, activeBatchId: batchId })
  }

  const addRow = () => {
    if (!activeBatch) {
      setError('Create or select a shipment batch first.')
      return
    }
    const row = createEmptyKsaRow(activeBatch)
    persistStore({ ...store, rows: [...store.rows, row] })
  }

  const updateRow = (rowId: string, patch: Partial<KsaPricingRow>) => {
    const batchById = new Map(store.batches.map((b) => [b.id, b]))
    const rows = store.rows.map((row) => {
      if (row.id !== rowId) return row
      const merged = {
        ...row,
        ...patch,
        updatedAt: new Date().toISOString(),
        zohoDimensionStatus:
          patch.length !== undefined || patch.width !== undefined || patch.height !== undefined
            ? ('manual' as const)
            : row.zohoDimensionStatus,
      }
      const batch = batchById.get(merged.shipmentBatchId) || activeBatch
      return recalcKsaRow(merged, batch || null)
    })
    persistStore({ ...store, rows })
  }

  const removeRow = (rowId: string) => {
    persistStore({ ...store, rows: store.rows.filter((r) => r.id !== rowId) })
  }

  const fetchDimensionsForRows = useCallback(
    async (rowIds: string[], sourceStore = store) => {
      const targets = sourceStore.rows.filter((r) => rowIds.includes(r.id) && r.itemCode.trim())
      if (!targets.length) return
      setDimensionBusy(true)
      setError('')
      try {
        const res = await api.post<{ results: ZohoDimensionLookupResult[] }>(
          '/api/prices/ksa/zoho-dimensions',
          { skus: targets.map((r) => r.itemCode.trim()) }
        )
        const bySku = indexZohoDimensionResults(res.results || [])
        const batchById = new Map(sourceStore.batches.map((b) => [b.id, b]))
        const targetIds = new Set(rowIds)
        const rows = sourceStore.rows.map((row) => {
          if (!targetIds.has(row.id) || !row.itemCode.trim()) return row
          const hit = bySku.get(row.itemCode.trim().toLowerCase())
          if (!hit) {
            return { ...row, zohoDimensionStatus: 'not_found' as const, updatedAt: new Date().toISOString() }
          }
          const merged: KsaPricingRow = {
            ...row,
            itemCode: row.itemCode.trim(),
            length: hit.length ?? '',
            width: hit.width ?? '',
            height: hit.height ?? '',
            dimensionUnit: hit.dimensionUnit,
            zohoDimensionStatus: hit.zohoDimensionStatus,
            zohoItemId: hit.itemId || undefined,
            zohoItemName: hit.itemName || undefined,
            updatedAt: new Date().toISOString(),
          }
          const batch = batchById.get(merged.shipmentBatchId) || activeBatch
          return recalcKsaRow(merged, batch || null)
        })
        persistStore({ ...sourceStore, rows })
        setNotice(`Fetched Zoho dimensions for ${targets.length} item(s).`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Zoho dimension lookup failed'
        setError(message)
      } finally {
        setDimensionBusy(false)
      }
    },
    [activeBatch, persistStore, store]
  )

  const onItemCodeBlur = async (rowId: string, itemCode: string) => {
    if (!itemCode.trim()) return
    const nextStore = {
      ...store,
      rows: store.rows.map((row) =>
        row.id === rowId
          ? { ...row, itemCode: itemCode.trim(), zohoDimensionStatus: 'loading' as const }
          : row
      ),
    }
    persistStore(nextStore)
    await fetchDimensionsForRows([rowId], nextStore)
  }

  const handlePaste = async () => {
    if (!activeBatch) {
      setError('Create or select a shipment batch first.')
      return
    }
    const codes = parseKsaPasteLines(pasteText)
    if (!codes.length) {
      setError('Paste one item code per line.')
      return
    }
    const newRows = codes.map((code) => {
      const row = createEmptyKsaRow(activeBatch)
      return { ...row, itemCode: code, zohoDimensionStatus: 'loading' as const }
    })
    const nextStore = { ...store, rows: [...store.rows, ...newRows] }
    persistStore(nextStore)
    setPasteText('')
    setNotice(`Added ${newRows.length} row(s). Fetching Zoho dimensions…`)
    await fetchDimensionsForRows(newRows.map((r) => r.id), nextStore)
  }

  const recordHistoryForReadyRows = () => {
    let nextHistory = history
    let count = 0
    for (const row of store.rows) {
      if (!row.itemCode.trim() || !row.newPriceSar) continue
      nextHistory = appendKsaPricingHistory(nextHistory, row, 'Manual snapshot')
      count += 1
    }
    if (!count) {
      setError('No priced rows to record in history.')
      return
    }
    persistHistory(nextHistory)
    setNotice(`Recorded ${count} row(s) in KSA pricing history.`)
  }

  if (!prefsReady || !prefsLoaded) {
    return (
      <div className="page ksa-pricing-page">
        <div className="doc-page-hero">
          <h1 className="doc-page-title">All Prices (KSA)</h1>
          <p className="doc-page-subtitle">Loading shipment-batch pricing…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page ksa-pricing-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">All Prices (KSA)</h1>
          <p className="doc-page-subtitle">
            Shipment-batch landed-cost calculator (SAR). Cargo cost uses Zoho package dimensions × batch freight
            rate/CBM. Storage and KSA shipping are manual for now.
          </p>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {notice && <div className="pp-notice">{notice}</div>}

      <div className="ksa-formula-note" role="note">
        <strong>Formula</strong>
        <div>
          CBM = L × W × H ÷ 1,000,000 when Zoho dimensions are in centimeters. Inch dimensions are converted to cubic
          meters before cargo cost. Cargo = CBM × freight/CBM · Base = purchase + cargo + storage + KSA shipping
        </div>
        <code>
          New price SAR = base ÷ (1 − commission − advertising − VAT − profit) · After VAT = new price − VAT amount
        </code>
      </div>

      <div className="ksa-system-note" role="note">
        <strong>New KSA pricing system:</strong> this page uses shipment batches and landed-cost rows only. Legacy
        UAE-style KSA ecommerce calculator data from <code>all_prices_ecommerce_ksa_v1</code>
        {legacyKsaRowsCount > 0 ? ` (${legacyKsaRowsCount} row(s))` : ''} is preserved but not displayed here.
      </div>

      <section className="ksa-batch-panel" aria-label="Shipment batches">
        <div className="ksa-batch-panel__head">
          <div>
            <h2 className="doc-section-title">Shipment batch</h2>
            <p className="pp-hint">Each batch snapshots freight rate/CBM on every row.</p>
          </div>
          <div className="ksa-pricing-toolbar">
            <button type="button" className="btn btn--primary" onClick={createBatch}>
              New batch
            </button>
            {store.batches.length > 1 && (
              <select
                value={store.activeBatchId || ''}
                onChange={(e) => selectBatch(e.target.value)}
                aria-label="Active shipment batch"
              >
                {store.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.shipmentDate || 'no date'})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {activeBatch ? (
          <div className="ksa-batch-panel__grid">
            <label>
              Batch name
              <input value={activeBatch.name} onChange={(e) => updateBatchField('name', e.target.value)} />
            </label>
            <label>
              Shipment date
              <input
                type="date"
                value={activeBatch.shipmentDate || ''}
                onChange={(e) => updateBatchField('shipmentDate', e.target.value)}
              />
            </label>
            <label>
              Freight rate / CBM (SAR)
              <input
                type="number"
                min={0}
                step="0.01"
                value={activeBatch.freightRatePerCbm}
                onChange={(e) => updateBatchField('freightRatePerCbm', Number(e.target.value) || 0)}
              />
            </label>
            <label className="ksa-batch-panel__notes">
              Notes
              <textarea
                rows={2}
                value={activeBatch.notes}
                onChange={(e) => updateBatchField('notes', e.target.value)}
              />
            </label>
          </div>
        ) : (
          <p className="pp-hint">No shipment batch yet. Create one to start pricing rows.</p>
        )}
      </section>

      <div className="ksa-pricing-toolbar">
        <button type="button" className="btn" onClick={addRow} disabled={!activeBatch}>
          Add row
        </button>
        <button
          type="button"
          className="btn"
          disabled={dimensionBusy || !store.rows.length}
          onClick={() => fetchDimensionsForRows(store.rows.map((r) => r.id))}
        >
          {dimensionBusy ? 'Fetching Zoho…' : 'Refresh Zoho dimensions'}
        </button>
        <button type="button" className="btn" onClick={recordHistoryForReadyRows}>
          Record history snapshot
        </button>
        {store.lastSavedAt && (
          <span className="pp-hint">Last saved {new Date(store.lastSavedAt).toLocaleString()}</span>
        )}
      </div>

      <div className="ap-ec-paste">
        <label>
          Paste item codes (one per line)
          <textarea rows={3} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={handlePaste} disabled={!activeBatch || dimensionBusy}>
          Paste &amp; fetch Zoho
        </button>
      </div>

      <div className="ksa-pricing-table-wrap">
        <table className="ksa-pricing-table">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Zoho</th>
              <th>Purchase</th>
              <th>L</th>
              <th>W</th>
              <th>H</th>
              <th>CBM</th>
              <th>Cargo</th>
              <th>Storage</th>
              <th>KSA ship</th>
              <th>Comm cost</th>
              <th>Ad cost</th>
              <th>VAT cost</th>
              <th>Profit</th>
              <th>Base</th>
              <th>Price SAR</th>
              <th>After VAT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {store.rows.length === 0 ? (
              <tr>
                <td colSpan={18} className="pp-hint">
                  No rows yet. Add or paste item codes for the active shipment batch.
                </td>
              </tr>
            ) : (
              store.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      value={row.itemCode}
                      onChange={(e) => updateRow(row.id, { itemCode: e.target.value })}
                      onBlur={(e) => onItemCodeBlur(row.id, e.target.value)}
                    />
                  </td>
                  <td>
                    <span className={zohoBadgeClass(row.zohoDimensionStatus)}>{zohoBadgeLabel(row.zohoDimensionStatus)}</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.purchasePriceEcommerce}
                      onChange={(e) =>
                        updateRow(row.id, { purchasePriceEcommerce: toOptionalNumber(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.length}
                      onChange={(e) => updateRow(row.id, { length: toOptionalNumber(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.width}
                      onChange={(e) => updateRow(row.id, { width: toOptionalNumber(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.height}
                      onChange={(e) => updateRow(row.id, { height: toOptionalNumber(e.target.value) })}
                    />
                  </td>
                  <td className="ksa-readonly-cell">{fmtSar(row.cbm, 4)}</td>
                  <td className="ksa-readonly-cell">{fmtSar(row.cargoCost)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.storageCost}
                      onChange={(e) => updateRow(row.id, { storageCost: toOptionalNumber(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.ksaShippingCost}
                      onChange={(e) => updateRow(row.id, { ksaShippingCost: toOptionalNumber(e.target.value) })}
                    />
                  </td>
                  <td className="ksa-percent-cost-cell">
                    <strong>{fmtSar(row.commissionAmount)}</strong>
                    <label>
                      <span>Rate %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={row.commissionPercent}
                        onChange={(e) => updateRow(row.id, { commissionPercent: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </td>
                  <td className="ksa-percent-cost-cell">
                    <strong>{fmtSar(row.advertisingAmount)}</strong>
                    <label>
                      <span>Rate %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={row.advertisingPercent}
                        onChange={(e) => updateRow(row.id, { advertisingPercent: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </td>
                  <td className="ksa-percent-cost-cell">
                    <strong>{fmtSar(row.vatKsaAmount)}</strong>
                    <label>
                      <span>Rate %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={row.vatKsaPercent}
                        onChange={(e) => updateRow(row.id, { vatKsaPercent: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </td>
                  <td className="ksa-percent-cost-cell">
                    <strong>{fmtSar(row.profitAmount)}</strong>
                    <label>
                      <span>Rate %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={row.profitPercent}
                        onChange={(e) => updateRow(row.id, { profitPercent: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </td>
                  <td className="ksa-readonly-cell">{fmtSar(row.totalBaseCost)}</td>
                  <td className="ksa-readonly-cell">
                    <strong>{fmtSar(row.newPriceSar)}</strong>
                  </td>
                  <td className="ksa-readonly-cell">{fmtSar(row.newPriceAfterVat)}</td>
                  <td>
                    <button type="button" className="btn btn--ghost" onClick={() => removeRow(row.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="ksa-history-section" aria-labelledby="ksa-history-title">
        <h2 id="ksa-history-title" className="doc-section-title">
          KSA Shipment History
        </h2>
        <p className="pp-hint">
          Separate from UAE historical prices and old KSA ecommerce data. Use “Record history snapshot” after batch
          pricing is final.
        </p>
        {history.entries.length === 0 ? (
          <p className="pp-hint">No history recorded yet.</p>
        ) : (
          <div className="ksa-pricing-table-wrap">
            <table className="ksa-pricing-table">
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Item</th>
                  <th>Batch</th>
                  <th>Freight/CBM</th>
                  <th>CBM</th>
                  <th>Base</th>
                  <th>Price SAR</th>
                  <th>After VAT</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.entries.slice(0, 100).map((entry) => (
                  <tr key={entry.historyId}>
                    <td>{new Date(entry.recordedAt).toLocaleString()}</td>
                    <td>{entry.itemCode}</td>
                    <td>{entry.shipmentBatchName}</td>
                    <td>{fmtSar(entry.freightRatePerCbmSnapshot)}</td>
                    <td>{fmtSar(entry.cbm, 4)}</td>
                    <td>{fmtSar(entry.totalBaseCost)}</td>
                    <td>{fmtSar(entry.newPriceSar)}</td>
                    <td>{fmtSar(entry.newPriceAfterVat)}</td>
                    <td>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
