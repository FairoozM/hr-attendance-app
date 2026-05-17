import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../Page.css'
import './DocumentExpiryPage.css'
import './AllPricesPage.css'
import { PREF_ALL_PRICES_EC, PREF_ALL_PRICES_SAVED_LISTS } from '../../constants/userPreferenceKeys'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { exportSavedPriceListToExcel } from './allPricesSavedListExport'
import {
  addSavedListToStore,
  persistSavedListsStore,
  readLegacySavedListsFromLocalStorage,
  readSavedListsStore,
  removeSavedListFromStore,
  updateSavedListInStore,
} from './allPricesSavedLists'
import {
  buildAllPricesBundle,
  computeEcommercePriceRow,
  DEFAULT_RATES,
  fmtMoney,
  fmtPct,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
  makeRowId,
  parseExcelTsvPaste,
  saveAllPricesEcommerceBundle,
} from './allPricesEcommerceUtils'

function fmtShippingPurchaseDisplay(raw) {
  if (raw === '' || raw == null) return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return '—'
  return fmtMoney(n, 2)
}

function applySavedListToTableState(list) {
  return {
    rates: list.rates,
    rows: (list.rows || []).map((r) => ({
      id: r.id || makeRowId(),
      itemNo: r.itemNo != null ? String(r.itemNo) : '',
      purchasePrice: r.purchasePrice ?? '',
      shipping: r.shipping ?? '',
      dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
    })),
    lastSavedAt: list.updatedAt || list.createdAt || null,
  }
}

export function AllPricesPage() {
  const { ready: prefsReady, getPref, setPref, prefsVersion } = useUserPreferences()
  const [rates, setRates] = useState({ ...DEFAULT_RATES })
  const [rows, setRows] = useState([])
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteFeedback, setPasteFeedback] = useState({ type: '', text: '' })
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveToast, setSaveToast] = useState('')
  const [savedListsStore, setSavedListsStore] = useState(() => readSavedListsStore())
  const [activeSavedListId, setActiveSavedListId] = useState(null)
  const [editingRowId, setEditingRowId] = useState(null)
  const skipNextAutosaveRef = useRef(true)
  const saveToastTimerRef = useRef(null)

  const applyBundleToState = useCallback((bundle) => {
    const hydrated = hydrateAllPricesStateFromBundle(bundle)
    setRates(hydrated.rates)
    setRows(hydrated.rows)
    setLastSavedAt(hydrated.lastSavedAt)
    return hydrated
  }, [])

  const persistStore = useCallback(
    (store) => {
      const normalized = persistSavedListsStore(store)
      setSavedListsStore(normalized)
      setActiveSavedListId(normalized.activeSavedListId)
      setPref(PREF_ALL_PRICES_SAVED_LISTS, normalized)
      return normalized
    },
    [setPref],
  )

  useEffect(() => {
    if (!prefsReady || prefsLoaded) return

    let listsStore = readSavedListsStore()
    const legacy = readLegacySavedListsFromLocalStorage()
    if (legacy && legacy.savedLists.length) {
      listsStore = legacy
      setPref(PREF_ALL_PRICES_SAVED_LISTS, legacy)
    } else {
      const fromPref = getPref(PREF_ALL_PRICES_SAVED_LISTS, null)
      if (fromPref) listsStore = readSavedListsStore()
    }

    setSavedListsStore(listsStore)
    setActiveSavedListId(listsStore.activeSavedListId)

    const activeList = listsStore.activeSavedListId
      ? listsStore.savedLists.find((l) => l.id === listsStore.activeSavedListId)
      : null

    if (activeList) {
      const applied = applySavedListToTableState(activeList)
      setRates(applied.rates)
      setRows(applied.rows)
      setLastSavedAt(applied.lastSavedAt)
    } else {
      const bundle = getPref(PREF_ALL_PRICES_EC, null)
      applyBundleToState(bundle)
    }

    skipNextAutosaveRef.current = true
    setPrefsLoaded(true)
  }, [applyBundleToState, getPref, persistStore, prefsLoaded, prefsReady])

  useEffect(() => {
    void prefsVersion
    if (!prefsReady || !prefsLoaded) return
    const fromPref = getPref(PREF_ALL_PRICES_SAVED_LISTS, null)
    if (fromPref) {
      const normalized = readSavedListsStore()
      setSavedListsStore(normalized)
      setActiveSavedListId(normalized.activeSavedListId)
    }
  }, [getPref, prefsLoaded, prefsReady, prefsVersion])

  useEffect(() => {
    if (!prefsReady || !prefsLoaded) return
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return
    }
    const result = saveAllPricesEcommerceBundle(
      buildAllPricesBundle(rates, rows, lastSavedAt || undefined),
      { source: 'AllPricesPage', action: 'autosave', preserveLastSavedAt: true },
    )
    if (!result.blocked) {
      setPref(PREF_ALL_PRICES_EC, buildAllPricesBundle(rates, rows, lastSavedAt || undefined))
    }
  }, [getPref, lastSavedAt, prefsLoaded, prefsReady, rates, rows, setPref])

  useEffect(() => () => {
    if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current)
  }, [])

  const showSaveToast = useCallback((text) => {
    setSaveToast(text)
    if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current)
    saveToastTimerRef.current = setTimeout(() => setSaveToast(''), 4000)
  }, [])

  const sortedSavedLists = useMemo(
    () =>
      [...savedListsStore.savedLists].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [savedListsStore.savedLists],
  )

  const sumTakePct = useMemo(() => {
    const v = Number(rates.vatPct) || 0
    const c = Number(rates.commissionPct) || 0
    const a = Number(rates.advertisingPct) || 0
    const p = Number(rates.requiredProfitPct) || 0
    return v + c + a + p
  }, [rates])

  const denominatorPct = useMemo(() => Math.max(0, 100 - sumTakePct), [sumTakePct])
  const ratesInvalid = sumTakePct >= 100

  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: makeRowId(),
        itemNo: '',
        purchasePrice: '',
        shipping: '',
        dateOfPrices: '',
      },
    ])
  }, [])

  const deleteRow = useCallback((id) => {
    if (!window.confirm('Remove this row from the price list?')) return
    setEditingRowId((cur) => (cur === id ? null : cur))
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const toggleEditRow = useCallback((id) => {
    setEditingRowId((cur) => (cur === id ? null : id))
  }, [])

  const resetRates = useCallback(() => {
    setRates({ ...DEFAULT_RATES })
  }, [])

  const syncDraftAfterSave = useCallback(
    (savedAt) => {
      const bundle = buildAllPricesBundle(rates, rows, savedAt)
      saveAllPricesEcommerceBundle(bundle, {
        source: 'AllPricesPage',
        action: 'sync-draft-after-saved-list',
        preserveLastSavedAt: false,
      })
      setPref(PREF_ALL_PRICES_EC, bundle)
      setLastSavedAt(savedAt)
      skipNextAutosaveRef.current = true
    },
    [rates, rows, setPref],
  )

  const handleSavePrices = useCallback(() => {
    setSaving(true)
    const existingId = activeSavedListId
    let nextStore = savedListsStore
    let entry = null
    let blocked = false

    if (existingId && nextStore.savedLists.some((l) => l.id === existingId)) {
      const result = updateSavedListInStore(nextStore, existingId, rates, rows)
      blocked = result.blocked
      nextStore = { ...result.store, activeSavedListId: existingId }
      entry = result.entry
    } else {
      const result = addSavedListToStore(nextStore, rates, rows)
      blocked = result.blocked
      nextStore = result.store
      entry = result.entry
    }

    if (blocked || !entry) {
      showSaveToast('Save blocked: template sample rows cannot be saved in production.')
      setSaving(false)
      return
    }

    persistStore(nextStore)
    syncDraftAfterSave(entry.updatedAt)
    showSaveToast('Prices saved successfully.')
    setSaving(false)
  }, [activeSavedListId, persistStore, rates, rows, savedListsStore, showSaveToast, syncDraftAfterSave])

  const handleSaveAsNewList = useCallback(() => {
    setSaving(true)
    const result = addSavedListToStore(savedListsStore, rates, rows)
    if (result.blocked || !result.entry) {
      showSaveToast('Save blocked: template sample rows cannot be saved in production.')
      setSaving(false)
      return
    }
    persistStore(result.store)
    syncDraftAfterSave(result.entry.updatedAt)
    showSaveToast(`Saved as new list: ${result.entry.name}`)
    setSaving(false)
  }, [persistStore, rates, rows, savedListsStore, showSaveToast, syncDraftAfterSave])

  const handleLoadSavedList = useCallback(
    (listId) => {
      const list = savedListsStore.savedLists.find((l) => l.id === listId)
      if (!list) return
      const applied = applySavedListToTableState(list)
      setRates(applied.rates)
      setRows(applied.rows)
      setLastSavedAt(applied.lastSavedAt)
      setEditingRowId(null)
      const nextStore = { ...savedListsStore, activeSavedListId: listId }
      persistStore(nextStore)
      skipNextAutosaveRef.current = true
      syncDraftAfterSave(applied.lastSavedAt)
      showSaveToast(`Loaded “${list.name}”.`)
    },
    [persistStore, savedListsStore, showSaveToast, syncDraftAfterSave],
  )

  const handleUpdateSavedList = useCallback(
    (listId) => {
      const result = updateSavedListInStore(savedListsStore, listId, rates, rows)
      if (result.blocked || !result.entry) {
        showSaveToast('Update blocked: template sample rows cannot be saved in production.')
        return
      }
      const nextStore = {
        ...result.store,
        activeSavedListId: listId,
      }
      persistStore(nextStore)
      syncDraftAfterSave(result.entry.updatedAt)
      showSaveToast(`Updated “${result.entry.name}”.`)
    },
    [persistStore, rates, rows, savedListsStore, showSaveToast, syncDraftAfterSave],
  )

  const handleDeleteSavedList = useCallback(
    (listId) => {
      if (!window.confirm('Delete this saved price list?')) return
      const next = removeSavedListFromStore(savedListsStore, listId)
      persistStore(next)
      if (activeSavedListId === listId) {
        setActiveSavedListId(next.activeSavedListId)
      }
      showSaveToast('Saved price list deleted.')
    },
    [activeSavedListId, persistStore, savedListsStore, showSaveToast],
  )

  const handleExportSavedList = useCallback((list) => {
    if (!Array.isArray(list?.rows) || list.rows.length === 0) {
      window.alert('No saved prices available to export.')
      return
    }
    exportSavedPriceListToExcel(list)
  }, [])

  const applyPasteReplace = useCallback(() => {
    const { rows: parsed, skippedHeader, hint } = parseExcelTsvPaste(pasteText)
    if (hint === 'empty' || hint === 'no-data-rows') {
      setPasteFeedback({ type: 'err', text: 'Paste Excel data first (tab-separated rows).' })
      return
    }
    const next = parsed.map((p) => ({
      id: makeRowId(),
      itemNo: p.itemNo || '',
      purchasePrice: p.purchasePrice || '',
      shipping: p.shipping || '',
      dateOfPrices: p.dateOfPrices || '',
    }))
    setRows(next)
    setEditingRowId(null)
    setPasteFeedback({
      type: 'ok',
      text: `Replaced table with ${next.length} row(s)${skippedHeader ? ' (header row skipped)' : ''}.`,
    })
    setPasteText('')
  }, [pasteText])

  const applyPasteMerge = useCallback(() => {
    const { rows: parsed, skippedHeader, hint } = parseExcelTsvPaste(pasteText)
    if (hint === 'empty' || hint === 'no-data-rows') {
      setPasteFeedback({ type: 'err', text: 'Paste Excel data first (tab-separated rows).' })
      return
    }
    setRows((prev) => {
      const out = [...prev]
      parsed.forEach((p, i) => {
        const patch = {
          ...(p.itemNo !== '' ? { itemNo: p.itemNo } : {}),
          ...(p.purchasePrice !== '' ? { purchasePrice: p.purchasePrice } : {}),
          ...(p.shipping !== '' ? { shipping: p.shipping } : {}),
          ...(p.dateOfPrices !== '' ? { dateOfPrices: p.dateOfPrices } : {}),
        }
        if (i < out.length) {
          out[i] = { ...out[i], ...patch }
        } else {
          out.push({
            id: makeRowId(),
            itemNo: p.itemNo || '',
            purchasePrice: p.purchasePrice || '',
            shipping: p.shipping || '',
            dateOfPrices: p.dateOfPrices || '',
          })
        }
      })
      return out
    })
    setPasteFeedback({
      type: 'ok',
      text: `Merged ${parsed.length} pasted row(s) into the table${skippedHeader ? ' (header skipped)' : ''}.`,
    })
    setPasteText('')
  }, [pasteText])

  if (!prefsReady || !prefsLoaded) {
    return (
      <div className="page ap-ec-page">
        <div className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">All Prices (UAE &amp; KSA)</h1>
            <p className="doc-page-subtitle">Loading your saved price list…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">All Prices (UAE &amp; KSA)</h1>
          <p className="doc-page-subtitle">
            Ecommerce selling price calculator (UAE · AED). Enter <strong>purchase price</strong> and{' '}
            <strong>shipping</strong>; sales price is derived so marketplace VAT, commission, advertising, and target
            profit are covered.
          </p>
        </div>
      </div>

      <section className="page-section ap-ec-wrap" aria-label="Ecommerce price list">
        <div className="ap-ec-formula-note" role="note">
          <strong>Required sales price</strong> when purchase + shipping are known:{' '}
          <code>
            (Purchase + Shipping) ÷ (1 − VAT − Commission − Advertising − Required profit)
          </code>
          <br />
          Default matches your sheet: 5% + 15% + 15% + 25% = 60% → divide by{' '}
          <strong>40%</strong>. Values shown use <strong>rounded</strong> AED sales price (e.g. 119.58 → 120); VAT,
          commission, and advertising are calculated on that rounded price.
        </div>

        <div className="ap-ec-rates">
          <label>
            VAT %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rates.vatPct}
              onChange={(e) => setRates((r) => ({ ...r, vatPct: e.target.value }))}
            />
          </label>
          <label>
            Commission %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rates.commissionPct}
              onChange={(e) => setRates((r) => ({ ...r, commissionPct: e.target.value }))}
            />
          </label>
          <label>
            Advertising %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rates.advertisingPct}
              onChange={(e) => setRates((r) => ({ ...r, advertisingPct: e.target.value }))}
            />
          </label>
          <label>
            Required profit %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rates.requiredProfitPct}
              onChange={(e) => setRates((r) => ({ ...r, requiredProfitPct: e.target.value }))}
            />
          </label>
          <div className="ap-ec-rates__meta">
            Combined take rate: <strong>{fmtMoney(sumTakePct, 2)}%</strong> · Effective divisor:{' '}
            <strong>{fmtMoney(denominatorPct, 2)}%</strong> of sales price remains after deductions (must be &gt; 0).
            <button type="button" className="btn btn--ghost" style={{ marginLeft: '0.75rem' }} onClick={resetRates}>
              Reset rates to 5 / 15 / 15 / 25
            </button>
          </div>
        </div>

        {ratesInvalid ? (
          <p className="ap-ec-error" role="alert">
            The four percentages add up to 100% or more. Lower them so the divisor (1 − sum) stays positive.
          </p>
        ) : null}

        <div className="ap-ec-toolbar">
          <button type="button" className="btn btn--primary" onClick={addRow}>
            + Add row
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSavePrices}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Prices'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleSaveAsNewList}
            disabled={saving}
          >
            Save as New List
          </button>
        </div>
        <div className="ap-ec-save-meta" aria-live="polite">
          {saveToast ? <p className="ap-ec-save-toast" role="status">{saveToast}</p> : null}
          {activeSavedListId && lastSavedAt ? (
            <p className="ap-ec-save-last">
              Working on: {savedListsStore.savedLists.find((l) => l.id === activeSavedListId)?.name || 'Saved list'}
              {' · '}Last saved: {formatLastSavedAt(lastSavedAt)}
            </p>
          ) : (
            <p className="ap-ec-save-last ap-ec-save-last--muted">
              Click Save Prices to create a named saved list, or Save as New List for an additional copy.
            </p>
          )}
        </div>

        <section className="ap-ec-saved-lists" aria-label="Saved Price Lists">
          <h3 className="ap-ec-saved-lists__title">Saved Price Lists</h3>
          {sortedSavedLists.length === 0 ? (
            <p className="ap-ec-saved-lists__empty">
              No saved lists yet. Click <strong>Save Prices</strong> to create your first saved version.
            </p>
          ) : (
            <ul className="ap-ec-saved-lists__grid">
              {sortedSavedLists.map((list) => {
                const isActive = list.id === activeSavedListId
                return (
                  <li
                    key={list.id}
                    className={`ap-ec-saved-card${isActive ? ' ap-ec-saved-card--active' : ''}`}
                  >
                    <div className="ap-ec-saved-card__head">
                      <strong className="ap-ec-saved-card__name">{list.name}</strong>
                      {isActive ? <span className="ap-ec-saved-card__badge">Active</span> : null}
                    </div>
                    <p className="ap-ec-saved-card__meta">Rows: {list.rows.length}</p>
                    <p className="ap-ec-saved-card__meta">
                      Last saved: {formatLastSavedAt(list.updatedAt)}
                    </p>
                    <div className="ap-ec-saved-card__actions">
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => handleLoadSavedList(list.id)}>
                        Load
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleUpdateSavedList(list.id)}>
                        Update
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDeleteSavedList(list.id)}>
                        Delete
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleExportSavedList(list)}>
                        Export Excel
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="ap-ec-paste">
          <div className="ap-ec-paste__head">
            <div>
              <h3>Bulk paste from Excel</h3>
              <p className="ap-ec-paste__hint">
                In Excel, select cells and copy (<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>⌘</kbd>+<kbd>C</kbd>). Paste below —
                columns must be <strong>tab-separated</strong> (Excel default). Supported layouts:{' '}
                <strong>full row</strong> (item, sales, VAT, commission, advertising, shipping, purchase, …) — computed
                columns are ignored; <strong>3 columns</strong>{' '}
                <code>Item</code> · <code>Purchase</code> · <code>Shipping</code>; or{' '}
                <strong>2 columns</strong> <code>Purchase</code> · <code>Shipping</code> (keeps existing item codes when
                merging).
              </p>
            </div>
          </div>
          <label className="sr-only" htmlFor="ap-ec-paste-area">
            Paste tab-separated data from Excel
          </label>
          <textarea
            id="ap-ec-paste-area"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value)
              if (pasteFeedback.text) setPasteFeedback({ type: '', text: '' })
            }}
            placeholder={'Example full sheet row (tabs between cells):\nITEM-001\t120\t6\t18\t18\t21\t26.83\t...\n\nExample 3 columns:\nITEM-001\t26.83\t21'}
            spellCheck={false}
          />
          <div className="ap-ec-paste__actions">
            <button type="button" className="btn btn--primary" onClick={applyPasteReplace}>
              Replace all rows with paste
            </button>
            <button type="button" className="btn btn--ghost" onClick={applyPasteMerge}>
              Fill into existing rows (top-down)
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => { setPasteText(''); setPasteFeedback({ type: '', text: '' }) }}>
              Clear box
            </button>
            {pasteFeedback.text ? (
              <span className={`ap-ec-paste__msg ${pasteFeedback.type === 'err' ? 'ap-ec-paste__msg--err' : ''}`}>
                {pasteFeedback.text}
              </span>
            ) : null}
          </div>
        </div>

        <div className="ap-table-scroll">
          <table className="ap-ec-table">
            <thead>
              <tr>
                <th scope="col">Item no.</th>
                <th scope="col" className="col-accent" title="New website, Noon & Amazon sales price">
                  Sales price (AED)
                </th>
                <th scope="col">{rates.vatPct}% VAT</th>
                <th scope="col">{rates.commissionPct}% commission</th>
                <th scope="col">{rates.advertisingPct}% advertising</th>
                <th scope="col">Shipping</th>
                <th scope="col" className="col-purchase" title="Purchase price ecommerce">
                  Purchase price
                </th>
                <th scope="col" className="col-cost-sum" title="Purchase + VAT + commission + advertising + shipping">
                  <span className="ap-ec-th-cost-line">Purchase + VAT + comm.</span>
                  <span className="ap-ec-th-cost-line">+ adv. + shipping</span>
                </th>
                <th scope="col">Sales − costs (profit)</th>
                <th scope="col" className="col-accent">
                  Profit % of sales
                </th>
                <th scope="col">Date of prices</th>
                <th scope="col" className="ap-ec-actions ap-ec-actions-head">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="ap-ec-empty">
                    No rows in the table. Paste or import your price list, then save it as a named list.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const computed = computeEcommercePriceRow(row, rates)
                  const purchaseNum = Number(row.purchasePrice)
                  const shipNum = Number(row.shipping)
                  const hasInputs =
                    row.purchasePrice !== '' &&
                    row.shipping !== '' &&
                    Number.isFinite(purchaseNum) &&
                    Number.isFinite(shipNum)
                  const editCosts = editingRowId === row.id

                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="item-no-input"
                          type="text"
                          value={row.itemNo}
                          onChange={(e) => updateRow(row.id, { itemNo: e.target.value })}
                          aria-label="Item number"
                        />
                      </td>
                      <td className="col-accent">
                        {!hasInputs || computed.denominatorInvalid ? (
                          <span className="ap-ec-num">—</span>
                        ) : (
                          <span className="ap-ec-num">{computed.salesPrice}</span>
                        )}
                      </td>
                      <td>
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.vatAmount) : '—'}</span>
                      </td>
                      <td>
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.commissionAmount) : '—'}</span>
                      </td>
                      <td>
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.advertisingAmount) : '—'}</span>
                      </td>
                      <td>
                        {editCosts ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.shipping}
                            onChange={(e) => updateRow(row.id, { shipping: e.target.value })}
                            aria-label="Shipping cost"
                          />
                        ) : (
                          <span className="ap-ec-num ap-ec-cell-readonly">{fmtShippingPurchaseDisplay(row.shipping)}</span>
                        )}
                      </td>
                      <td className="col-purchase">
                        {editCosts ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.purchasePrice}
                            onChange={(e) => updateRow(row.id, { purchasePrice: e.target.value })}
                            aria-label="Purchase price ecommerce"
                          />
                        ) : (
                          <span className="ap-ec-num ap-ec-cell-readonly">{fmtShippingPurchaseDisplay(row.purchasePrice)}</span>
                        )}
                      </td>
                      <td className="col-cost-sum">
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.totalCost) : '—'}</span>
                      </td>
                      <td>
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.profit) : '—'}</span>
                      </td>
                      <td className="col-accent">
                        <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtPct(computed.profitPct) : '—'}</span>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={row.dateOfPrices || ''}
                          onChange={(e) => updateRow(row.id, { dateOfPrices: e.target.value })}
                          aria-label="Date of prices"
                        />
                      </td>
                      <td className="ap-ec-actions">
                        <div className="ap-ec-actions__inner">
                          <button
                            type="button"
                            className="ap-ec-edit-btn"
                            onClick={() => toggleEditRow(row.id)}
                            aria-pressed={editCosts}
                          >
                            {editCosts ? 'Done' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            className="ap-ec-trash"
                            onClick={() => deleteRow(row.id)}
                            aria-label="Remove row"
                            title="Remove row"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="doc-page-subtitle" style={{ marginTop: '1rem', marginBottom: 0 }}>
          Saved lists are stored on your account (server) and remain available after refresh.
        </p>
      </section>
    </div>
  )
}
