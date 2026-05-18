import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../Page.css'
import './AllPricesPage.css'
import { PREF_ALL_PRICES_EC, PREF_ALL_PRICES_HISTORY } from '../../constants/userPreferenceKeys'
import { useAuth } from '../../contexts/AuthContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import {
  buildAllPricesBundle,
  computeEcommercePriceRow,
  fmtMoney,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
  saveAllPricesEcommerceBundle,
} from './allPricesEcommerceUtils'
import {
  appendCleanupBatch,
  appendHistoricalPrices,
  readHistoricalPricesStore,
} from './allPricesHistoricalPrices'
import {
  applyConflictResolution,
  applySafeDuplicateCleanup,
  scanDuplicatePrices,
} from './allPricesVersioning'

function SummaryCard({ label, value, hint }) {
  return (
    <div className="ap-ec-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  )
}

function RowSnapshot({ row, rates }) {
  const computed = computeEcommercePriceRow(row, rates)
  const purchase = row.purchasePrice === '' ? '—' : fmtMoney(row.purchasePrice)
  const shipping = row.shipping === '' ? '—' : fmtMoney(row.shipping)
  const salesPrice = computed.denominatorInvalid ? '—' : fmtMoney(computed.salesPrice, 0)
  return (
    <div className="ap-ec-duplicate-row">
      <strong>{row.itemNo || 'No item no.'}</strong>
      <span>Sales price: {salesPrice}</span>
      <span>Purchase: {purchase}</span>
      <span>Shipping: {shipping}</span>
      <span>Date: {row.dateOfPrices || 'blank'}</span>
      <span>Row #{(row.originalIndex ?? 0) + 1}</span>
    </div>
  )
}

export function DuplicatePriceCleanupPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ready: prefsReady, getPref, setPref, prefsVersion } = useUserPreferences()
  const [feedback, setFeedback] = useState('')
  const [selectedConflictRows, setSelectedConflictRows] = useState({})

  const activeState = useMemo(() => {
    void prefsVersion
    return hydrateAllPricesStateFromBundle(getPref(PREF_ALL_PRICES_EC, null))
  }, [getPref, prefsReady, prefsVersion])

  const scan = useMemo(
    () => scanDuplicatePrices(activeState.rows, activeState.rates),
    [activeState.rates, activeState.rows],
  )

  const movedBy = user?.name || user?.email || user?.username || ''

  function persistActiveRows(nextRows) {
    const savedAt = new Date().toISOString()
    const bundle = buildAllPricesBundle(activeState.rates, nextRows, savedAt)
    saveAllPricesEcommerceBundle(bundle, {
      source: 'DuplicatePriceCleanupPage',
      action: 'duplicate-cleanup',
      preserveLastSavedAt: false,
    })
    setPref(PREF_ALL_PRICES_EC, bundle)
  }

  function persistHistoryRows(historyRows) {
    if (!historyRows.length) return
    const nextHistory = appendHistoricalPrices(historyRows)
    setPref(PREF_ALL_PRICES_HISTORY, nextHistory)
  }

  function handleAutoClean() {
    const result = applySafeDuplicateCleanup(activeState.rows, activeState.rates, { movedBy })
    if (!result.historyRows.length) {
      setFeedback('No safe duplicate groups to auto-clean.')
      return
    }
    persistHistoryRows(result.historyRows)
    persistActiveRows(result.activeRows)
    appendCleanupBatch({
      id: result.cleanupBatchId,
      startedBy: movedBy,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...result.summary,
    })
    setFeedback(`Auto-cleaned ${result.historyRows.length} duplicate row(s). Conflict groups were left for review.`)
  }

  function handleApplyConflictResolutions() {
    const result = applyConflictResolution(activeState.rows, activeState.rates, selectedConflictRows, {
      movedBy,
    })
    if (!result.historyRows.length) {
      setFeedback('Select one active row in at least one conflict group first.')
      return
    }
    persistHistoryRows(result.historyRows)
    persistActiveRows(result.activeRows)
    appendCleanupBatch({
      id: result.cleanupBatchId,
      startedBy: movedBy,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      autoCleanedCount: 0,
      adminResolvedCount: result.historyRows.length,
      conflictGroupCount: Object.keys(selectedConflictRows).length,
      status: 'admin_resolved',
    })
    setSelectedConflictRows({})
    setFeedback(`Resolved conflicts and moved ${result.historyRows.length} row(s) to Historical Prices.`)
  }

  function handleExportReport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: scan.summary,
      groups: scan.groups,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `duplicate-price-cleanup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!prefsReady) {
    return (
      <div className="page ap-ec-page">
        <div className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">Duplicate Price Cleanup</h1>
            <p className="doc-page-subtitle">Loading pricing data…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">Duplicate Price Cleanup</h1>
          <p className="doc-page-subtitle">
            Scan current All Prices rows, auto-move safe duplicates to Historical Prices, and review only true conflicts.
          </p>
        </div>
      </div>

      <section className="page-section ap-ec-wrap">
        <div className="ap-ec-summary-grid">
          <SummaryCard label="Duplicate item numbers" value={scan.summary.duplicateItemCount} />
          <SummaryCard label="Duplicate rows found" value={scan.summary.duplicateRowCount} />
          <SummaryCard label="Safe auto-fixes" value={scan.summary.safeAutoFixCount} hint="rows moved to history" />
          <SummaryCard label="Conflict groups" value={scan.summary.conflictGroupCount} />
        </div>

        <div className="ap-ec-toolbar">
          <button type="button" className="btn btn--primary" onClick={handleAutoClean} disabled={!scan.summary.safeAutoFixCount}>
            Auto-clean safe duplicates
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleApplyConflictResolutions} disabled={!scan.summary.conflictGroupCount}>
            Apply selected conflict resolutions
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleExportReport} disabled={!scan.groups.length}>
            Export duplicate report
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/prices/all-prices')}>
            Back to All Prices
          </button>
        </div>
        {feedback ? <p className="ap-ec-save-notice ap-ec-save-notice--warn">{feedback}</p> : null}

        {scan.groups.length === 0 ? (
          <p className="ap-ec-empty">No duplicate active item numbers found.</p>
        ) : (
          <div className="ap-ec-duplicate-groups">
            {scan.groups.map((group) => (
              <article key={group.id} className={`ap-ec-duplicate-group ${group.conflict ? 'ap-ec-duplicate-group--conflict' : ''}`}>
                <header>
                  <div>
                    <h3>{group.displayItemNo}</h3>
                    <p>
                      {group.rows.length} rows · {group.classification} · {group.reason}
                    </p>
                  </div>
                  {group.safe ? <span className="ap-ec-badge ap-ec-badge--safe">Safe auto-clean</span> : <span className="ap-ec-badge ap-ec-badge--warn">Admin review</span>}
                </header>
                <div className="ap-ec-duplicate-row-grid">
                  {group.rows.map((row) => (
                    <label key={row.id} className={row.id === group.keepRowId ? 'ap-ec-duplicate-choice ap-ec-duplicate-choice--keep' : 'ap-ec-duplicate-choice'}>
                      {group.conflict ? (
                        <input
                          type="radio"
                          name={`dup-${group.id}`}
                          checked={selectedConflictRows[group.id] === row.id}
                          onChange={() => setSelectedConflictRows((prev) => ({ ...prev, [group.id]: row.id }))}
                        />
                      ) : null}
                      <RowSnapshot row={row} rates={activeState.rates} />
                      {row.id === group.keepRowId ? <em>Recommended active row</em> : null}
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
