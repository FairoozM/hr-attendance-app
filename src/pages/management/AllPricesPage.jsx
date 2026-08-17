import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './AllPricesPage.css'
import { getAllPricesMarket, PRICES_MARKET_UAE, PROFIT_POLICY_ANY } from './allPricesMarket'
import { setAllPricesMarketScope } from './allPricesMarketScope'
import { AllPricesCogsPanel } from './AllPricesCogsPanel'
import { AllPricesFormulaView } from './AllPricesFormulaView'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { AllPricesActionToast } from './AllPricesActionToast'
import { AllPricesConfirmModal } from './AllPricesConfirmModal'
import { AllPricesLoadGuardModal } from './AllPricesLoadGuardModal'
import { AllPricesRevisionConflictModal } from './AllPricesRevisionConflictModal'
import {
  computeDraftFingerprint,
  formatRatesSummary,
  hasUnsavedChangesToActiveList,
  isSignificantRowCountChange,
} from './allPricesDraftSafety'
import { pushRecoverySnapshot, removeRecoverySnapshot } from './allPricesRecoverySnapshots'
import { exportCurrentDraftToExcel, exportSavedListToExcel } from './allPricesSavedListExport'
import {
  addSavedListToStore,
  normalizeSavedListsStore,
  persistSavedListsStore,
  readFreshSavedListsStore,
  readLegacySavedListsFromLocalStorage,
  readSavedListsStore,
  removeSavedListFromStore,
  updateSavedListInStore,
} from './allPricesSavedLists'
import {
  buildAllPricesBundle,
  cloneAllPricesRows,
  computeEcommercePriceRow,
  DEFAULT_RATES,
  fmtMoney,
  fmtPct,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
  makeRowId,
  parseExcelTsvPaste,
  profitMarginDisplayClass,
  purchaseMarkupPct,
  saveAllPricesEcommerceBundle,
} from './allPricesEcommerceUtils'
import { allPricesBundleStamp } from '../prices/allPricesCatalogSource'
import { applyUaeWholesaleResetIfNeeded } from './allPricesUaeWholesaleReset'
import { applySpecialOffersDraftResetIfNeeded } from './allPricesSpecialOffersReset'
import {
  appendCleanupBatch,
  appendHistoricalPrices,
  appendImportBatch,
} from './allPricesHistoricalPrices'
import {
  applyImportReview,
  applySafeDuplicateCleanup,
  buildImportReview,
  scanDuplicatePrices,
} from './allPricesVersioning'

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
      salesPrice: r.salesPrice ?? '',
      purchasePrice: r.purchasePrice ?? '',
      shipping: r.shipping ?? '',
      dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
    })),
    lastSavedAt: list.updatedAt || list.createdAt || null,
  }
}

const DRAFT_AUTOSAVE_MS = 450

/**
 * @param {{ market?: import('./allPricesMarket').PricesMarketId }} props
 */
export function AllPricesPage({ market = PRICES_MARKET_UAE }) {
  const marketCfg = getAllPricesMarket(market)
  const { ready: prefsReady, getPref, setPref, prefsVersion } = useUserPreferences()

  const cogsEnabled = marketCfg.features.cogs
  const formulaEnabled = marketCfg.features.formulaSandbox
  const showMarkupColumn = marketCfg.features.purchaseMarkup
  const profitPolicy = marketCfg.profitPolicy
  const isOffersMarket = profitPolicy === PROFIT_POLICY_ANY
  const tableColumnCount = showMarkupColumn ? 14 : 13
  const exportOptions = useMemo(
    () => ({ filePrefix: marketCfg.exportFilePrefix, includePurchaseMarkup: showMarkupColumn }),
    [marketCfg.exportFilePrefix, showMarkupColumn],
  )

  useEffect(() => {
    setAllPricesMarketScope(market)
    return () => setAllPricesMarketScope(PRICES_MARKET_UAE)
  }, [market])

  const [listRates, setListRates] = useState({ ...DEFAULT_RATES })
  const [formulaRates, setFormulaRates] = useState({ ...DEFAULT_RATES })
  const [formulaRows, setFormulaRows] = useState([])
  const [rows, setRows] = useState([])
  const [activeTab, setActiveTab] = useState('prices')

  useEffect(() => {
    if (activeTab === 'cogs' && !cogsEnabled) setActiveTab('prices')
    if (activeTab === 'formula' && !formulaEnabled) setActiveTab('prices')
  }, [activeTab, cogsEnabled, formulaEnabled])
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteFeedback, setPasteFeedback] = useState({ type: '', text: '' })
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedListsStore, setSavedListsStore] = useState(() => readSavedListsStore())
  const [activeSavedListId, setActiveSavedListId] = useState(
    () => readSavedListsStore().activeSavedListId,
  )
  const [editingRowId, setEditingRowId] = useState(null)
  const [draftSaveStatus, setDraftSaveStatus] = useState('idle')
  const [actionToast, setActionToast] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [loadGuardTargetId, setLoadGuardTargetId] = useState(null)
  const [revisionConflict, setRevisionConflict] = useState(null)
  const [importReview, setImportReview] = useState(null)
  const skipNextAutosaveRef = useRef(true)
  const knownDraftStampRef = useRef(0)
  const [loadedBaseline, setLoadedBaselineState] = useState({
    listId: null,
    fingerprint: null,
    revision: null,
  })
  const lastUndoSnapshotIdRef = useRef(null)
  const draftAutosaveTimerRef = useRef(null)
  const hydratedMarketRef = useRef(null)

  const applyBundleToState = useCallback((bundle) => {
    const hydrated = hydrateAllPricesStateFromBundle(bundle)
    setListRates(hydrated.rates)
    setRows(hydrated.rows)
    setLastSavedAt(hydrated.lastSavedAt)
    return hydrated
  }, [])

  const setLoadedBaseline = useCallback((listId, nextRates, nextRows, revision) => {
    setLoadedBaselineState({
      listId: listId || null,
      fingerprint: listId
        ? computeDraftFingerprint({ activeSavedListId: listId, rates: nextRates, rows: nextRows })
        : null,
      revision: revision != null ? revision : null,
    })
  }, [])

  const currentFingerprint = useMemo(
    () => computeDraftFingerprint({ activeSavedListId, rates: listRates, rows }),
    [activeSavedListId, listRates, rows],
  )

  const activeList = useMemo(
    () => savedListsStore.savedLists.find((l) => l.id === activeSavedListId) || null,
    [activeSavedListId, savedListsStore.savedLists],
  )

  const duplicateScan = useMemo(() => scanDuplicatePrices(rows, listRates), [listRates, rows])
  const movedBy = ''

  const activeUnsaved = useMemo(
    () =>
      hasUnsavedChangesToActiveList({
        activeSavedListId,
        loadedFingerprint: loadedBaseline.fingerprint,
        currentFingerprint,
      }),
    [activeSavedListId, currentFingerprint, loadedBaseline.fingerprint],
  )

  const persistStore = useCallback(
    (store) => {
      const normalized = persistSavedListsStore(store)
      setSavedListsStore(normalized)
      setActiveSavedListId(normalized.activeSavedListId)
      setPref(marketCfg.prefs.savedLists, normalized)
      return normalized
    },
    [marketCfg.prefs.savedLists, setPref],
  )

  const showActionToast = useCallback((message, { actionLabel = 'undo', onAction } = {}) => {
    setActionToast({ message, actionLabel, onAction, secondsLeft: 10 })
  }, [])

  const syncDraftAfterSave = useCallback(
    (savedAt) => {
      const bundle = buildAllPricesBundle(listRates, rows, savedAt)
      saveAllPricesEcommerceBundle(bundle, {
        source: 'AllPricesPage',
        action: 'sync-draft-after-saved-list',
        preserveLastSavedAt: false,
      })
      setPref(marketCfg.prefs.ec, bundle)
      knownDraftStampRef.current = allPricesBundleStamp(bundle)
      setLastSavedAt(savedAt)
      skipNextAutosaveRef.current = true
      setDraftSaveStatus('saved')
    },
    [listRates, marketCfg.prefs.ec, rows, setPref],
  )

  const captureFormulaSnapshot = useCallback(() => {
    setFormulaRows(cloneAllPricesRows(rows))
    setFormulaRates({ ...listRates })
  }, [listRates, rows])

  const applyTableFromList = useCallback(
    (list) => {
      const applied = applySavedListToTableState(list)
      setListRates(applied.rates)
      setRows(applied.rows)
      setLastSavedAt(applied.lastSavedAt)
      setEditingRowId(null)
      setLoadedBaseline(list.id, applied.rates, applied.rows, list.revision)
      return applied
    },
    [setLoadedBaseline],
  )

  const restoreFromSnapshot = useCallback(
    (snapshot) => {
      if (!snapshot) return
      setListRates(snapshot.rates)
      setRows(
        (snapshot.rows || []).map((r) => ({
          id: r.id || makeRowId(),
          itemNo: r.itemNo != null ? String(r.itemNo) : '',
          salesPrice: r.salesPrice ?? '',
          purchasePrice: r.purchasePrice ?? '',
          shipping: r.shipping ?? '',
          dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
        })),
      )
      if (snapshot.sourceSavedListId) {
        setActiveSavedListId(snapshot.sourceSavedListId)
        const list = savedListsStore.savedLists.find((l) => l.id === snapshot.sourceSavedListId)
        if (list) {
          setLoadedBaseline(list.id, snapshot.rates, snapshot.rows, list.revision)
        }
      }
      skipNextAutosaveRef.current = true
      if (lastUndoSnapshotIdRef.current) {
        removeRecoverySnapshot(lastUndoSnapshotIdRef.current)
        lastUndoSnapshotIdRef.current = null
      }
    },
    [savedListsStore.savedLists, setLoadedBaseline],
  )

  useEffect(() => {
    if (!prefsReady) return
    if (hydratedMarketRef.current === market) return
    hydratedMarketRef.current = market

    // Every market route renders this same component instance, so the previous market's table
    // is still in state here. Clear it before hydrating or it autosaves into this market's draft.
    setRows([])
    setListRates({ ...DEFAULT_RATES })
    setFormulaRows([])
    setFormulaRates({ ...DEFAULT_RATES })
    setLastSavedAt(null)
    setEditingRowId(null)
    setPasteText('')
    setPasteFeedback({ type: '', text: '' })
    setActionToast(null)
    setConfirmModal(null)
    setImportReview(null)
    setRevisionConflict(null)
    setLoadGuardTargetId(null)
    setDraftSaveStatus('idle')
    lastUndoSnapshotIdRef.current = null

    applyUaeWholesaleResetIfNeeded({
      market,
      getPref,
      setPref,
      prefs: marketCfg.prefs,
    })

    applySpecialOffersDraftResetIfNeeded({
      market,
      getPref,
      setPref,
      prefs: marketCfg.prefs,
    })

    // The legacy localStorage lists predate multi-market support, so they belong to UAE only.
    const legacy = market === PRICES_MARKET_UAE ? readLegacySavedListsFromLocalStorage() : null
    let listsStore = legacy?.savedLists?.length
      ? legacy
      : normalizeSavedListsStore(getPref(marketCfg.prefs.savedLists, null))
    if (legacy?.savedLists?.length) {
      setPref(marketCfg.prefs.savedLists, legacy)
    }
    if (!listsStore.savedLists.length) {
      listsStore = readSavedListsStore()
    }

    setSavedListsStore(listsStore)
    setActiveSavedListId(listsStore.activeSavedListId)

    const activeListOnLoad = listsStore.activeSavedListId
      ? listsStore.savedLists.find((l) => l.id === listsStore.activeSavedListId)
      : null

    knownDraftStampRef.current = allPricesBundleStamp(getPref(marketCfg.prefs.ec, null))

    if (activeListOnLoad) {
      applyTableFromList(activeListOnLoad)
    } else {
      const bundle = getPref(marketCfg.prefs.ec, null)
      applyBundleToState(bundle)
      setLoadedBaseline(null, DEFAULT_RATES, [], null)
    }

    skipNextAutosaveRef.current = true
    setPrefsLoaded(true)
  }, [applyBundleToState, applyTableFromList, getPref, market, marketCfg.prefs, prefsReady, setLoadedBaseline, setPref])

  useEffect(() => {
    void prefsVersion
    if (!prefsReady || !prefsLoaded) return
    const fromPref = getPref(marketCfg.prefs.savedLists, null)
    if (fromPref) {
      const normalized = readSavedListsStore()
      setSavedListsStore(normalized)
      setActiveSavedListId(normalized.activeSavedListId)
    }
  }, [prefsLoaded, prefsReady, prefsVersion])

  useEffect(() => {
    if (!prefsReady || !prefsLoaded) return
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return undefined
    }

    setDraftSaveStatus('saving')
    if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)

    draftAutosaveTimerRef.current = setTimeout(() => {
      try {
        // Another tab may hold a newer table for this market; autosaving our older rows over it
        // silently loses their edits.
        if (allPricesBundleStamp(getPref(marketCfg.prefs.ec, null)) > knownDraftStampRef.current) {
          setDraftSaveStatus('stale')
          return
        }
        const bundle = buildAllPricesBundle(listRates, rows, lastSavedAt || undefined)
        const result = saveAllPricesEcommerceBundle(bundle, {
          source: 'AllPricesPage',
          action: 'autosave',
          preserveLastSavedAt: true,
        })
        if (result.blocked) {
          setDraftSaveStatus('error')
          return
        }
        setPref(marketCfg.prefs.ec, bundle)
        knownDraftStampRef.current = allPricesBundleStamp(bundle)
        setDraftSaveStatus('saved')
      } catch {
        setDraftSaveStatus('error')
      }
    }, DRAFT_AUTOSAVE_MS)

    return () => {
      if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)
    }
  }, [getPref, lastSavedAt, marketCfg.prefs.ec, prefsLoaded, prefsReady, listRates, rows, setPref])

  useEffect(
    () => () => {
      if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)
    },
    [],
  )

  const retryDraftSave = useCallback(() => {
    setDraftSaveStatus('saving')
    try {
      const bundle = buildAllPricesBundle(listRates, rows, lastSavedAt || undefined)
      const result = saveAllPricesEcommerceBundle(bundle, {
        source: 'AllPricesPage',
        action: 'autosave-retry',
        preserveLastSavedAt: true,
      })
      if (result.blocked) {
        setDraftSaveStatus('error')
        return
      }
      setPref(marketCfg.prefs.ec, bundle)
      knownDraftStampRef.current = allPricesBundleStamp(bundle)
      setDraftSaveStatus('saved')
    } catch {
      setDraftSaveStatus('error')
    }
  }, [lastSavedAt, listRates, marketCfg.prefs.ec, rows, setPref])

  const sortedSavedLists = useMemo(
    () =>
      [...savedListsStore.savedLists].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [savedListsStore.savedLists],
  )

  const formulaSumTakePct = useMemo(() => {
    const v = Number(formulaRates.vatPct) || 0
    const c = Number(formulaRates.commissionPct) || 0
    const a = Number(formulaRates.advertisingPct) || 0
    return v + c + a
  }, [formulaRates])

  const formulaRatesInvalid = formulaSumTakePct >= 100

  const primaryButton = useMemo(() => {
    if (!activeSavedListId) {
      return { label: 'Save as Price List', disabled: saving, mode: 'create' }
    }
    if (!activeUnsaved) {
      return { label: 'Saved', disabled: true, mode: 'noop' }
    }
    return { label: 'Update Active List', disabled: saving, mode: 'update-active' }
  }, [activeSavedListId, activeUnsaved, saving])

  const statusMessage = useMemo(() => {
    if (draftSaveStatus === 'saving') return 'Saving draft…'
    if (draftSaveStatus === 'error') return null
    if (activeSavedListId && activeUnsaved) return 'Draft saved. Active list not updated.'
    if (activeSavedListId && !activeUnsaved) return 'Draft saved'
    return 'Draft saved'
  }, [activeSavedListId, activeUnsaved, draftSaveStatus])

  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: makeRowId(), itemNo: '', salesPrice: '', purchasePrice: '', shipping: '', dateOfPrices: '' },
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

  const runUpdateList = useCallback(
    (listId, { skipSignificantCheck = false } = {}) => {
      const freshStore = readFreshSavedListsStore()
      const target = freshStore.savedLists.find((l) => l.id === listId)
      if (!target) return false

      const oldCount = target.rows?.length || 0
      const newCount = rows.length
      if (!skipSignificantCheck && isSignificantRowCountChange(oldCount, newCount)) {
        setConfirmModal({
          variant: 'update',
          listName: target.name,
          counts: { oldCount, newCount },
          onConfirm: () => {
            setConfirmModal(null)
            runUpdateList(listId, { skipSignificantCheck: true })
          },
        })
        return false
      }

      const snapshots = pushRecoverySnapshot({
        reason: 'before-update-saved-list',
        rates: listRates,
        rows,
        sourceSavedListId: activeSavedListId,
        sourceSavedListName: activeList?.name,
      })
      const snap = snapshots[0]
      if (snap) lastUndoSnapshotIdRef.current = snap.id

      const expectedRevision = loadedBaseline.revision ?? target.revision
      const result = updateSavedListInStore(freshStore, listId, listRates, rows, { expectedRevision })

      if (result.reason === 'revision_conflict') {
        setRevisionConflict({ listId, listName: target.name, serverEntry: result.entry })
        return false
      }

      if (result.blocked || !result.entry) {
        showActionToast('Update blocked: template sample rows cannot be saved in production.')
        return false
      }

      const nextStore = { ...result.store, activeSavedListId: listId }
      persistStore(nextStore)
      syncDraftAfterSave(result.entry.updatedAt)
      setLoadedBaseline(listId, listRates, rows, result.entry.revision)
      setRevisionConflict(null)
      showActionToast('Saved list updated.', {
        onAction: () => restoreFromSnapshot(snap),
      })
      return true
    },
    [activeList?.name, activeSavedListId, loadedBaseline.revision, listRates, persistStore, restoreFromSnapshot, rows, setLoadedBaseline, showActionToast, syncDraftAfterSave],
  )

  const handlePrimarySave = useCallback(() => {
    if (primaryButton.mode === 'noop') return
    setSaving(true)
    if (primaryButton.mode === 'create') {
      const result = addSavedListToStore(savedListsStore, listRates, rows)
      if (result.blocked || !result.entry) {
        showActionToast('Save blocked: template sample rows cannot be saved in production.')
        setSaving(false)
        return
      }
      persistStore(result.store)
      syncDraftAfterSave(result.entry.updatedAt)
      setLoadedBaseline(result.entry.id, listRates, rows, result.entry.revision)
      showActionToast(`Saved as price list: ${result.entry.name}`)
      setSaving(false)
      return
    }
    if (primaryButton.mode === 'update-active' && activeSavedListId) {
      runUpdateList(activeSavedListId)
    }
    setSaving(false)
  }, [activeSavedListId, listRates, persistStore, primaryButton.mode, rows, runUpdateList, savedListsStore, setLoadedBaseline, showActionToast, syncDraftAfterSave])

  const handleSaveAsNewList = useCallback(() => {
    setSaving(true)
    const result = addSavedListToStore(savedListsStore, listRates, rows)
    if (result.blocked || !result.entry) {
      showActionToast('Save blocked: template sample rows cannot be saved in production.')
      setSaving(false)
      return
    }
    persistStore(result.store)
    syncDraftAfterSave(result.entry.updatedAt)
    setLoadedBaseline(result.entry.id, listRates, rows, result.entry.revision)
    showActionToast(`Saved as new list: ${result.entry.name}`)
    setSaving(false)
  }, [listRates, persistStore, rows, savedListsStore, setLoadedBaseline, showActionToast, syncDraftAfterSave])

  const performLoadList = useCallback(
    (listId) => {
      const list = savedListsStore.savedLists.find((l) => l.id === listId)
      if (!list) return
      applyTableFromList(list)
      const nextStore = { ...savedListsStore, activeSavedListId: listId }
      persistStore(nextStore)
      skipNextAutosaveRef.current = true
      syncDraftAfterSave(list.updatedAt || list.createdAt)
      showActionToast(`Loaded “${list.name}”.`)
      setLoadGuardTargetId(null)
    },
    [applyTableFromList, persistStore, savedListsStore, showActionToast, syncDraftAfterSave],
  )

  const requestLoadList = useCallback(
    (listId) => {
      if (listId === activeSavedListId) return
      if (activeSavedListId && activeUnsaved) {
        setLoadGuardTargetId(listId)
        return
      }
      performLoadList(listId)
    },
    [activeSavedListId, activeUnsaved, performLoadList],
  )

  const handleUpdateSavedList = useCallback(
    (listId) => {
      const fresh = readFreshSavedListsStore()
      const target = fresh.savedLists.find((l) => l.id === listId)
      if (!target) return
      if (listId !== activeSavedListId) {
        applyTableFromList(target)
        setActiveSavedListId(listId)
      }
      runUpdateList(listId)
    },
    [applyTableFromList, runUpdateList],
  )

  const performDeleteList = useCallback(
    (listId) => {
      const target = savedListsStore.savedLists.find((l) => l.id === listId)
      const snapshots = pushRecoverySnapshot({
        reason: 'before-delete-saved-list',
        rates: listRates,
        rows,
        sourceSavedListId: target?.id,
        sourceSavedListName: target?.name,
      })
      const snap = snapshots[0]
      if (snap) lastUndoSnapshotIdRef.current = snap.id

      const deletedEntry = target ? { ...target } : null
      const next = removeSavedListFromStore(savedListsStore, listId)
      persistStore(next)
      if (activeSavedListId === listId) {
        setActiveSavedListId(next.activeSavedListId)
        setLoadedBaseline(next.activeSavedListId, listRates, rows, null)
      }
      showActionToast(deletedEntry ? `Deleted ${deletedEntry.name}.` : 'Saved price list deleted.', {
        actionLabel: 'restore',
        onAction: () => {
          if (!deletedEntry) return
          const restored = {
            ...savedListsStore,
            savedLists: [deletedEntry, ...next.savedLists],
            activeSavedListId: next.activeSavedListId || deletedEntry.id,
          }
          persistStore(restored)
          restoreFromSnapshot(snap)
        },
      })
    },
    [activeSavedListId, listRates, persistStore, restoreFromSnapshot, rows, savedListsStore, setLoadedBaseline, showActionToast],
  )

  const handleDeleteSavedList = useCallback(
    (listId) => {
      const list = savedListsStore.savedLists.find((l) => l.id === listId)
      setConfirmModal({
        variant: 'delete',
        listName: list?.name,
        onConfirm: () => {
          setConfirmModal(null)
          performDeleteList(listId)
        },
      })
    },
    [performDeleteList, savedListsStore.savedLists],
  )

  const runExportSavedList = useCallback(
    (list) => {
      if (!Array.isArray(list?.rows) || list.rows.length === 0) {
        window.alert('No saved prices available to export.')
        return
      }
      exportSavedListToExcel(list, exportOptions)
    },
    [exportOptions],
  )

  const handleExportSavedList = useCallback(
    (list) => {
      if (list.id === activeSavedListId && activeUnsaved) {
        setConfirmModal({
          variant: 'export-saved-unsaved',
          listName: list.name,
          onConfirm: () => {
            setConfirmModal(null)
            runExportSavedList(list)
          },
        })
        return
      }
      runExportSavedList(list)
    },
    [activeSavedListId, activeUnsaved, runExportSavedList],
  )

  const handleExportDraft = useCallback(() => {
    if (!rows.length) {
      window.alert('No rows in the working draft to export.')
      return
    }
    exportCurrentDraftToExcel({ rates: listRates, rows }, exportOptions)
  }, [exportOptions, listRates, rows])

  const persistHistoricalRows = useCallback((historyRows) => {
    if (!historyRows.length) return
    const nextHistory = appendHistoricalPrices(historyRows, market)
    setPref(marketCfg.prefs.history, nextHistory)
  }, [market, marketCfg.prefs.history, setPref])

  const handleAutoCleanDuplicates = useCallback(() => {
    const snapshots = pushRecoverySnapshot({
      reason: 'before-duplicate-auto-clean',
      rates: listRates,
      rows,
      sourceSavedListId: activeSavedListId,
      sourceSavedListName: activeList?.name,
    })
    const snap = snapshots[0]
    if (snap) lastUndoSnapshotIdRef.current = snap.id
    const result = applySafeDuplicateCleanup(rows, listRates, { movedBy, scan: duplicateScan })
    if (!result.historyRows.length) {
      showActionToast('No safe duplicate groups to auto-clean.')
      return
    }
    persistHistoricalRows(result.historyRows)
    setRows(result.activeRows)
    appendCleanupBatch({
      id: result.cleanupBatchId,
      startedBy: movedBy,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...result.summary,
    })
    showActionToast(`Auto-cleaned ${result.historyRows.length} duplicate row(s).`, {
      onAction: () => restoreFromSnapshot(snap),
    })
  }, [activeList?.name, activeSavedListId, duplicateScan, listRates, movedBy, persistHistoricalRows, restoreFromSnapshot, rows, showActionToast])

  const openImportReview = useCallback((parsed, skippedHeader, sourceMode) => {
    const incoming = parsed.map((p) => ({
      id: makeRowId(),
      itemNo: p.itemNo || '',
      salesPrice: p.salesPrice || '',
      purchasePrice: p.purchasePrice || '',
      shipping: p.shipping || '',
      dateOfPrices: p.dateOfPrices || '',
    }))
    setImportReview({
      sourceMode,
      skippedHeader,
      model: buildImportReview(incoming, rows, listRates),
    })
    setPasteFeedback({ type: 'ok', text: `Import review ready for ${incoming.length} row(s).` })
  }, [listRates, rows])

  const applyReviewedImport = useCallback(() => {
    if (!importReview?.model) return
    const snapshots = pushRecoverySnapshot({
      reason: 'before-import-review-apply',
      rates: listRates,
      rows,
      sourceSavedListId: activeSavedListId,
      sourceSavedListName: activeList?.name,
    })
    const snap = snapshots[0]
    if (snap) lastUndoSnapshotIdRef.current = snap.id
    const result = applyImportReview(rows, importReview.model, listRates, { movedBy })
    persistHistoricalRows(result.historyRows)
    setRows(result.activeRows)
    appendImportBatch({
      id: result.importBatchId,
      importedBy: movedBy,
      importedAt: new Date().toISOString(),
      sourceType: importReview.sourceMode || 'paste',
      status: result.summary.conflictCount ? 'applied_with_conflicts' : 'applied',
      ...importReview.model.summary,
      appliedCount: result.summary.appliedCount,
      historyCount: result.summary.historyCount,
    })
    setImportReview(null)
    setPasteText('')
    setPasteFeedback({
      type: 'ok',
      text: `${result.summary.appliedCount} import action(s) applied. ${result.summary.historyCount} row(s) moved to Historical Prices.`,
    })
    showActionToast('Import review applied.', { onAction: () => restoreFromSnapshot(snap) })
  }, [activeList?.name, activeSavedListId, importReview, listRates, movedBy, persistHistoricalRows, restoreFromSnapshot, rows, showActionToast])

  const applyPasteReplaceInternal = useCallback(() => {
    const { rows: parsed, skippedHeader, hint } = parseExcelTsvPaste(pasteText)
    if (hint === 'empty' || hint === 'no-data-rows') {
      setPasteFeedback({ type: 'err', text: 'Paste Excel data first (tab-separated rows).' })
      return
    }
    openImportReview(parsed, skippedHeader, 'replace')
  }, [openImportReview, pasteText])

  const applyPasteReplace = useCallback(() => {
    const { rows: parsed, hint } = parseExcelTsvPaste(pasteText)
    if (hint === 'empty' || hint === 'no-data-rows') {
      setPasteFeedback({ type: 'err', text: 'Paste Excel data first (tab-separated rows).' })
      return
    }
    if (rows.length >= 50) {
      setConfirmModal({
        variant: 'bulk-replace',
        counts: { oldCount: rows.length, pastedCount: parsed.length },
        onConfirm: () => {
          setConfirmModal(null)
          applyPasteReplaceInternal()
        },
      })
      return
    }
    applyPasteReplaceInternal()
  }, [applyPasteReplaceInternal, pasteText, rows.length])

  const applyPasteMerge = useCallback(() => {
    const { rows: parsed, skippedHeader, hint } = parseExcelTsvPaste(pasteText)
    if (hint === 'empty' || hint === 'no-data-rows') {
      setPasteFeedback({ type: 'err', text: 'Paste Excel data first (tab-separated rows).' })
      return
    }
    openImportReview(parsed, skippedHeader, 'merge')
  }, [openImportReview, pasteText])

  const resetFormulaRates = useCallback(() => {
    setFormulaRates({ ...DEFAULT_RATES })
  }, [])

  if (!prefsReady || !prefsLoaded) {
    return (
      <div className="page ap-ec-page ap-sc">
        <header className="ap-sc-page-head">
          <div>
            <h1 className="ap-sc-page-head__title">{marketCfg.pageTitle}</h1>
            <p className="ap-sc-page-head__sub">Loading your saved price list…</p>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="page ap-ec-page ap-sc">
      <header className="ap-sc-page-head">
        <div>
          <h1 className="ap-sc-page-head__title">{marketCfg.pageTitle}</h1>
          <p className="ap-sc-page-head__sub">{marketCfg.pageDescription}</p>
        </div>
      </header>

      {formulaEnabled || cogsEnabled ? (
        <div className="ap-tabs" role="tablist" aria-label="All Prices views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'prices'}
            className={`ap-tab${activeTab === 'prices' ? ' ap-tab--active' : ''}`}
            onClick={() => setActiveTab('prices')}
          >
            Price list
          </button>
          {formulaEnabled ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'formula'}
              className={`ap-tab${activeTab === 'formula' ? ' ap-tab--active' : ''}`}
              onClick={() => {
                captureFormulaSnapshot()
                setActiveTab('formula')
              }}
            >
              Price formula change
            </button>
          ) : null}
          {cogsEnabled ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'cogs'}
              className={`ap-tab${activeTab === 'cogs' ? ' ap-tab--active' : ''}`}
              onClick={() => setActiveTab('cogs')}
            >
              COGS
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'cogs' && cogsEnabled ? (
        <AllPricesCogsPanel rows={rows} currencyLabel="AED" />
      ) : activeTab === 'formula' && formulaEnabled ? (
        <AllPricesFormulaView
          rates={formulaRates}
          rows={formulaRows}
          sourceListName={activeList?.name || null}
          rowCount={rows.length}
          sumTakePct={formulaSumTakePct}
          ratesInvalid={formulaRatesInvalid}
          profitPolicy={profitPolicy}
          onRatesChange={(patch) => setFormulaRates((r) => ({ ...r, ...patch }))}
          onResetRates={resetFormulaRates}
          onRefreshSnapshot={captureFormulaSnapshot}
        />
      ) : (
      <section className="page-section ap-ec-wrap" aria-label="Ecommerce price list">
        {duplicateScan.summary.duplicateItemCount > 0 ? (
          <div className="ap-ec-warning-banner" role="alert">
            <div>
              <strong>
                {duplicateScan.summary.duplicateItemCount} duplicate item numbers found in {marketCfg.pageTitle}.
              </strong>
              <p>
                {isOffersMarket
                  ? 'Keep one offer row per item so the offer price is unambiguous.'
                  : 'Resolve duplicates before using composite pricing or importing new production prices.'}
              </p>
            </div>
            <div className="ap-ec-warning-banner__actions">
              {marketCfg.routeDuplicateCleanup ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    window.location.assign(marketCfg.routeDuplicateCleanup)
                  }}
                >
                  Review Duplicates
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleAutoCleanDuplicates}
                disabled={duplicateScan.summary.safeAutoFixCount === 0}
              >
                Auto-clean safe duplicates
              </button>
            </div>
          </div>
        ) : null}

        <div className="ap-ec-toolbar">
          <button type="button" className="btn btn--primary" onClick={addRow}>
            + Add row
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="all-prices-primary-save"
            onClick={handlePrimarySave}
            disabled={primaryButton.disabled}
          >
            {saving && primaryButton.mode !== 'noop' ? 'Saving…' : primaryButton.label}
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleSaveAsNewList} disabled={saving}>
            Save as New Price List
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="all-prices-export-draft"
            onClick={handleExportDraft}
            disabled={rows.length === 0}
          >
            Export Current Draft
          </button>
        </div>

        <div className="ap-ec-save-meta" aria-live="polite">
          {draftSaveStatus === 'stale' ? (
            <p className="ap-ec-save-notice ap-ec-save-notice--warn" role="alert">
              This table is older than the one saved from another tab, so it was not autosaved.
              Reload the page to get the current list.
            </p>
          ) : draftSaveStatus === 'error' ? (
            <p className="ap-ec-save-notice ap-ec-save-notice--error" role="alert">
              Draft save failed.{' '}
              <button type="button" className="btn btn--ghost btn--sm" onClick={retryDraftSave}>
                Retry
              </button>
            </p>
          ) : (
            <p className="ap-ec-save-notice" data-testid="all-prices-draft-status">
              {statusMessage}
            </p>
          )}
          {activeSavedListId && activeUnsaved ? (
            <p className="ap-ec-save-notice ap-ec-save-notice--warn" data-testid="all-prices-active-unsaved">
              Unsaved changes to active list
            </p>
          ) : null}
          {activeList && lastSavedAt ? (
            <p className="ap-ec-save-last">
              Working on: {activeList.name} · Last saved: {formatLastSavedAt(lastSavedAt)}
            </p>
          ) : (
            <p className="ap-ec-save-last ap-ec-save-last--muted">
              The table is your working draft (autosaved). Use Save as Price List or Update Active List for named snapshots.
            </p>
          )}
        </div>

        <AllPricesActionToast
          message={actionToast?.message}
          actionLabel={actionToast?.actionLabel}
          onAction={actionToast?.onAction}
          onDismiss={() => setActionToast(null)}
          secondsLeft={actionToast?.secondsLeft}
        />

        <section className="ap-ec-saved-lists" aria-label="Saved Price Lists">
          <h3 className="ap-ec-saved-lists__title">Saved Price Lists</h3>
          {sortedSavedLists.length === 0 ? (
            <p className="ap-ec-saved-lists__empty">
              No saved lists yet. Click <strong>Save as Price List</strong> to create your first saved version.
            </p>
          ) : (
            <ul className="ap-ec-saved-lists__grid">
              {sortedSavedLists.map((list) => {
                const isActive = list.id === activeSavedListId
                const cardUnsaved = isActive && activeUnsaved
                return (
                  <li
                    key={list.id}
                    className={`ap-ec-saved-card${isActive ? ' ap-ec-saved-card--active' : ''}`}
                  >
                    <div className="ap-ec-saved-card__head">
                      <strong className="ap-ec-saved-card__name">{list.name}</strong>
                      {isActive ? <span className="ap-ec-saved-card__badge">Active</span> : null}
                      {cardUnsaved ? (
                        <span className="ap-ec-saved-card__badge ap-ec-saved-card__badge--warn">
                          Active list has unsaved changes
                        </span>
                      ) : null}
                    </div>
                    <p className="ap-ec-saved-card__meta">Rows: {list.rows.length}</p>
                    <p className="ap-ec-saved-card__meta">Created: {formatLastSavedAt(list.createdAt)}</p>
                    <p className="ap-ec-saved-card__meta">Last updated: {formatLastSavedAt(list.updatedAt)}</p>
                    <p className="ap-ec-saved-card__meta">{formatRatesSummary(list.rates)}</p>
                    <p className="ap-ec-saved-card__meta ap-ec-saved-card__rev">rev {list.revision ?? 1}</p>
                    <div className="ap-ec-saved-card__actions">
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => requestLoadList(list.id)}>
                        Load
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleUpdateSavedList(list.id)}>
                        Update This Saved List
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDeleteSavedList(list.id)}>
                        Delete Saved List
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleExportSavedList(list)}>
                        Export Saved List
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
                Paste tab-separated rows from the {isOffersMarket ? 'special offers' : 'wholesales'} Excel export.
                Full rows must include sales price (column 2), shipping, and purchase price — sales price is kept
                exactly as pasted.
              </p>
            </div>
          </div>
          <textarea
            id="ap-ec-paste-area"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value)
              if (pasteFeedback.text) setPasteFeedback({ type: '', text: '' })
            }}
            placeholder="Paste tab-separated data…"
            spellCheck={false}
          />
          <div className="ap-ec-paste__actions">
            <button type="button" className="btn btn--primary" onClick={applyPasteReplace}>
              Replace all rows with paste
            </button>
            <button type="button" className="btn btn--ghost" onClick={applyPasteMerge}>
              Fill into existing rows (top-down)
            </button>
            {pasteFeedback.text ? (
              <span className={`ap-ec-paste__msg ${pasteFeedback.type === 'err' ? 'ap-ec-paste__msg--err' : ''}`}>
                {pasteFeedback.text}
              </span>
            ) : null}
          </div>
        </div>

        {importReview ? (
          <div className="ap-ec-paste ap-ec-import-review">
            <div className="ap-ec-paste__head">
              <div>
                <h3>Import Review</h3>
                <p className="ap-ec-paste__hint">
                  Review recommendations before applying. Old active prices are moved to Historical Prices before replacement.
                </p>
              </div>
            </div>
            <div className="ap-ec-summary-grid">
              <div className="ap-ec-summary-card"><span>New items</span><strong>{importReview.model.summary.newCount}</strong></div>
              <div className="ap-ec-summary-card"><span>Newer changed prices</span><strong>{importReview.model.summary.updatedCount}</strong></div>
              <div className="ap-ec-summary-card"><span>Unchanged</span><strong>{importReview.model.summary.unchangedCount}</strong></div>
              <div className="ap-ec-summary-card"><span>Older imported rows</span><strong>{importReview.model.summary.olderCount}</strong></div>
              <div className="ap-ec-summary-card"><span>Missing dates</span><strong>{importReview.model.summary.missingDateCount}</strong></div>
              <div className="ap-ec-summary-card"><span>Conflicts</span><strong>{importReview.model.summary.conflictCount}</strong></div>
            </div>
            <div className="ap-ec-toolbar">
              <button type="button" className="btn btn--primary" onClick={applyReviewedImport}>
                Apply safe import actions
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setImportReview(null)}>
                Cancel import
              </button>
            </div>
            <div className="ap-table-scroll">
              <table className="ap-ec-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Item No.</th>
                    <th>Current Sales</th>
                    <th>New Sales</th>
                    <th>Current Purchase</th>
                    <th>New Purchase</th>
                    <th>Current Shipping</th>
                    <th>New Shipping</th>
                    <th>Current Date</th>
                    <th>New Date</th>
                    <th>Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  {importReview.model.items.slice(0, 80).map((item) => (
                    <tr key={item.id}>
                      <td>{item.status}</td>
                      <td>{item.incoming.itemNo || '—'}</td>
                      <td>{item.current?.salesPrice ?? '—'}</td>
                      <td>{item.incoming.salesPrice || '—'}</td>
                      <td>{item.current?.purchasePrice ?? '—'}</td>
                      <td>{item.incoming.purchasePrice || '—'}</td>
                      <td>{item.current?.shipping ?? '—'}</td>
                      <td>{item.incoming.shipping || '—'}</td>
                      <td>{item.current?.dateOfPrices || '—'}</td>
                      <td>{item.incoming.dateOfPrices || '—'}</td>
                      <td>{item.recommendedAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importReview.model.items.length > 80 ? (
              <p className="ap-ec-save-last">Showing first 80 rows of {importReview.model.items.length}.</p>
            ) : null}
          </div>
        ) : null}

        <div className="ap-table-scroll">
          <table className="ap-ec-table">
            <thead>
              <tr>
                <th scope="col" className="ap-ec-row-number">
                  Sr no.
                </th>
                <th scope="col">Item no.</th>
                <th scope="col" className="col-accent">
                  Sales price (AED)
                </th>
                <th scope="col">{listRates.vatPct}% VAT</th>
                <th scope="col">{listRates.commissionPct}% commission</th>
                <th scope="col">{listRates.advertisingPct}% advertising</th>
                <th scope="col">Shipping</th>
                <th scope="col" className="col-purchase">
                  Purchase price
                </th>
                <th scope="col" className="col-cost-sum">
                  Purchase + VAT + comm. + adv. + shipping
                </th>
                <th scope="col">Sales − costs (profit)</th>
                {showMarkupColumn ? <th scope="col">Profit % of purchase</th> : null}
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
                  <td colSpan={tableColumnCount} className="ap-ec-empty">
                    No rows in the table. Paste or import your {isOffersMarket ? 'offer prices' : 'price list'}, then
                    save it as a named list.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const computed = computeEcommercePriceRow(row, listRates)
                  const salesNum = Number(row.salesPrice)
                  const purchaseNum = Number(row.purchasePrice)
                  const shipNum = Number(row.shipping)
                  const hasInputs =
                    row.salesPrice !== '' &&
                    row.purchasePrice !== '' &&
                    row.shipping !== '' &&
                    Number.isFinite(salesNum) &&
                    Number.isFinite(purchaseNum) &&
                    Number.isFinite(shipNum)
                  const editCosts = editingRowId === row.id
                  const markupPct = showMarkupColumn
                    ? purchaseMarkupPct(computed.salesPrice, row.purchasePrice)
                    : null

                  return (
                    <tr key={row.id}>
                      <td className="ap-ec-row-number">{rows.indexOf(row) + 1}</td>
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
                        {editCosts ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.salesPrice}
                            onChange={(e) => updateRow(row.id, { salesPrice: e.target.value })}
                            aria-label="Sales price from wholesales"
                          />
                        ) : !hasInputs || computed.denominatorInvalid ? (
                          <span className="ap-ec-num">—</span>
                        ) : (
                          <span className="ap-ec-num ap-ec-cell-readonly">{fmtMoney(computed.salesPrice, 0)}</span>
                        )}
                      </td>
                      <td>
                        <span className="ap-ec-num">
                          {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.vatAmount) : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="ap-ec-num">
                          {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.commissionAmount) : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="ap-ec-num">
                          {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.advertisingAmount) : '—'}
                        </span>
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
                          <span className="ap-ec-num ap-ec-cell-readonly">
                            {fmtShippingPurchaseDisplay(row.shipping)}
                          </span>
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
                          <span className="ap-ec-num ap-ec-cell-readonly">
                            {fmtShippingPurchaseDisplay(row.purchasePrice)}
                          </span>
                        )}
                      </td>
                      <td className="col-cost-sum">
                        <span className="ap-ec-num">
                          {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.totalCost) : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="ap-ec-num">
                          {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.profit) : '—'}
                        </span>
                      </td>
                      {showMarkupColumn ? (
                        <td>
                          <span className="ap-ec-num">
                            {hasInputs && !computed.denominatorInvalid && markupPct != null
                              ? fmtPct(markupPct, 2)
                              : '—'}
                          </span>
                        </td>
                      ) : null}
                      <td className="col-accent">
                        <span
                          className={`ap-ec-num ${
                            hasInputs && !computed.denominatorInvalid
                              ? profitMarginDisplayClass(computed.profitPct, profitPolicy)
                              : ''
                          }`}
                        >
                          {hasInputs && !computed.denominatorInvalid ? fmtPct(computed.profitPct) : '—'}
                        </span>
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
                          >
                            ×
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
      </section>
      )}

      <AllPricesConfirmModal
        open={Boolean(confirmModal)}
        variant={confirmModal?.variant}
        listName={confirmModal?.listName}
        counts={confirmModal?.counts}
        onClose={() => setConfirmModal(null)}
        onConfirm={() => confirmModal?.onConfirm?.()}
      />

      <AllPricesLoadGuardModal
        open={Boolean(loadGuardTargetId)}
        currentListName={activeList?.name}
        onClose={() => setLoadGuardTargetId(null)}
        onUpdateCurrent={() => {
          const targetId = loadGuardTargetId
          if (!activeSavedListId || !targetId) return
          if (runUpdateList(activeSavedListId)) {
            performLoadList(targetId)
          }
        }}
        onSaveAsNew={() => {
          const targetId = loadGuardTargetId
          handleSaveAsNewList()
          if (targetId) performLoadList(targetId)
        }}
        onDiscardAndLoad={() => {
          const targetId = loadGuardTargetId
          if (!targetId) return
          const snapshots = pushRecoverySnapshot({
            reason: 'before-load-other-list',
            rates: listRates,
            rows,
            sourceSavedListId: activeSavedListId,
            sourceSavedListName: activeList?.name,
          })
          const snap = snapshots[0]
          if (snap) {
            lastUndoSnapshotIdRef.current = snap.id
            showActionToast('Discarded unsaved changes.', { onAction: () => restoreFromSnapshot(snap) })
          }
          performLoadList(targetId)
        }}
      />

      <AllPricesRevisionConflictModal
        open={Boolean(revisionConflict)}
        listName={revisionConflict?.listName}
        onClose={() => setRevisionConflict(null)}
        onReloadSaved={() => {
          const entry = revisionConflict?.serverEntry
          if (!entry) return
          applyTableFromList(entry)
          const fresh = readFreshSavedListsStore()
          persistStore(fresh)
          syncDraftAfterSave(entry.updatedAt)
          setRevisionConflict(null)
        }}
        onSaveAsNew={() => {
          setRevisionConflict(null)
          handleSaveAsNewList()
        }}
      />
    </div>
  )
}
