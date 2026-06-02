import { useCallback, useMemo, useState } from 'react'
import { SummaryCards } from '../components/amazon/outOfStockClearance/SummaryCards'
import { VigilUploadPanel } from '../components/amazon/outOfStockClearance/VigilUploadPanel'
import { ResultsTable } from '../components/amazon/outOfStockClearance/ResultsTable'
import { ManualEditModal } from '../components/amazon/outOfStockClearance/ManualEditModal'
import {
  fetchAmazonOutOfStock,
  fetchZohoStockForClearance,
  calculateClearance,
  exportClearanceRows,
  type AmazonOosRow,
  type ClearanceResultRow,
  type ClearanceSummary,
  type ManualMapping,
  type MarketplaceCode,
  type VigilParsedRow,
  type ZohoStockRow,
} from '../api/amazonOutOfStockClearance'

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

export function AmazonOutOfStockClearancePage() {
  const [marketplace, setMarketplace] = useState<MarketplaceCode>('UAE')
  const [amazonRows, setAmazonRows] = useState<AmazonOosRow[]>([])
  const [zohoRows, setZohoRows] = useState<ZohoStockRow[]>([])
  const [vigilRows, setVigilRows] = useState<VigilParsedRow[]>([])
  const [resultRows, setResultRows] = useState<ClearanceResultRow[]>([])
  const [summary, setSummary] = useState<ClearanceSummary | null>(null)
  const [manualMappings, setManualMappings] = useState<Record<string, ManualMapping>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [maxRecommendedQty, setMaxRecommendedQty] = useState<string>('')

  const [fetchingAmazon, setFetchingAmazon] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const [editRow, setEditRow] = useState<ClearanceResultRow | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)

  const runFetchAmazon = useCallback(async () => {
    setFetchingAmazon(true)
    setError('')
    setWarnings([])
    setResultRows([])
    setSummary(null)
    setSelectedIds(new Set())
    try {
      const json = await fetchAmazonOutOfStock(marketplace)
      if (!json?.success) {
        setError(json?.error || 'Failed to fetch Amazon SKUs')
        return
      }
      const rows = Array.isArray(json.rows) ? json.rows : []
      setAmazonRows(rows)
      setFetchedAt(json.fetchedAt || null)
      setWarnings(Array.isArray(json.warnings) ? json.warnings : [])
      if (rows.length === 0) {
        setWarnings((w) => [...w, 'No out-of-stock SKUs found for this marketplace.'])
      }
    } catch (e) {
      setError(safeError(e))
    } finally {
      setFetchingAmazon(false)
    }
  }, [marketplace])

  const runCalculate = useCallback(async () => {
    if (amazonRows.length === 0) {
      setError('Fetch Amazon out-of-stock SKUs first.')
      return
    }
    if (vigilRows.length === 0) {
      setError('Upload and confirm Vigil stock before calculating.')
      return
    }
    setCalculating(true)
    setError('')
    try {
      let zoho = zohoRows
      if (zoho.length === 0) {
        const skus = amazonRows.map((r) => r.amazonSku).filter(Boolean)
        const zohoRes = await fetchZohoStockForClearance(marketplace, skus)
        zoho = Array.isArray(zohoRes.rows) ? zohoRes.rows : []
        setZohoRows(zoho)
      }
      const body = {
        marketplace,
        amazonRows,
        zohoRows: zoho,
        vigilRows,
        manualMappings,
        maxRecommendedQty: maxRecommendedQty === '' ? undefined : Number(maxRecommendedQty),
        respectManualOverrides: true,
      }
      const json = await calculateClearance(body)
      if (!json?.success) {
        setError(json?.error || 'Calculation failed')
        return
      }
      setResultRows(json.rows || [])
      setSummary(json.summary || null)
      setSelectedIds(new Set())
    } catch (e) {
      setError(safeError(e))
    } finally {
      setCalculating(false)
    }
  }, [amazonRows, vigilRows, zohoRows, marketplace, manualMappings, maxRecommendedQty])

  const recalculateAfterManual = useCallback(
    async (mapping: Record<string, ManualMapping>) => {
      setManualMappings(mapping)
      setCalculating(true)
      setError('')
      try {
        const json = await calculateClearance({
          marketplace,
          amazonRows,
          zohoRows,
          vigilRows,
          manualMappings: mapping,
          maxRecommendedQty: maxRecommendedQty === '' ? undefined : Number(maxRecommendedQty),
          respectManualOverrides: true,
        })
        setResultRows(json.rows || [])
        setSummary(json.summary || null)
      } catch (e) {
        setError(safeError(e))
      } finally {
        setCalculating(false)
      }
    },
    [amazonRows, zohoRows, vigilRows, marketplace, maxRecommendedQty]
  )

  const handleExport = useCallback(
    async (exportKind: 'full' | 'ready' | 'manualReview') => {
      if (resultRows.length === 0) {
        setError('Calculate recommendations before exporting.')
        return
      }
      setExporting(true)
      setError('')
      try {
        await exportClearanceRows({ rows: resultRows, exportKind })
      } catch (e) {
        setError(safeError(e))
      } finally {
        setExporting(false)
      }
    },
    [resultRows]
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id))
      if (allOn) return new Set()
      return new Set(ids)
    })
  }, [])

  const selectedRows = useMemo(
    () => resultRows.filter((r) => selectedIds.has(r.id)),
    [resultRows, selectedIds]
  )

  const totalSelectedQty = useMemo(
    () => selectedRows.reduce((sum, r) => sum + (r.recommendedAmazonUpdateQty || 0), 0),
    [selectedRows]
  )

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/10 via-transparent to-emerald-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300/90">Admin · Amazon</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Amazon Out of Stock Clearance
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-400">
          Find Amazon UAE/KSA SKUs with zero FBA fulfillable quantity, compare Life Smile Zoho stock and
          Vigil wholesale availability, and get recommended replenishment quantities. Amazon inventory
          updates are not enabled in this release.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-400">
              Marketplace
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as MarketplaceCode)}
              >
                <option value="UAE">UAE</option>
                <option value="KSA">KSA</option>
              </select>
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Max recommended qty (optional cap)
              <input
                type="number"
                min={0}
                placeholder="No cap"
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={maxRecommendedQty}
                onChange={(e) => setMaxRecommendedQty(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            disabled={fetchingAmazon}
            onClick={() => void runFetchAmazon()}
          >
            {fetchingAmazon ? 'Fetching from Amazon…' : 'Fetch Amazon Out of Stock SKUs'}
          </button>
        </div>
        {fetchedAt && (
          <p className="mt-3 text-xs text-slate-500">Amazon data fetched at {new Date(fetchedAt).toLocaleString()}</p>
        )}
        {amazonRows.length > 0 && !fetchingAmazon && (
          <p className="mt-2 text-sm text-emerald-200/90">{amazonRows.length} out-of-stock SKU(s) loaded.</p>
        )}
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <SummaryCards summary={summary} amazonCount={amazonRows.length} />

      <VigilUploadPanel
        onConfirmed={(rows) => {
          setVigilRows(rows)
          setError('')
        }}
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          disabled={calculating || amazonRows.length === 0 || vigilRows.length === 0}
          onClick={() => void runCalculate()}
        >
          {calculating ? 'Calculating…' : 'Calculate Recommended Amazon Stock'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={exporting || resultRows.length === 0}
          onClick={() => void handleExport('full')}
        >
          Export full results
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={exporting || resultRows.length === 0}
          onClick={() => void handleExport('ready')}
        >
          Export Ready to Update
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={exporting || resultRows.length === 0}
          onClick={() => void handleExport('manualReview')}
        >
          Export Manual Review
        </button>
        <button
          type="button"
          title="Amazon inventory write API is not enabled in this release"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-500 cursor-not-allowed"
          disabled
          onClick={() => setShowUpdateModal(true)}
        >
          Update Selected SKUs on Amazon (coming soon)
        </button>
      </div>

      {resultRows.length > 0 && (
        <ResultsTable
          rows={resultRows}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          manualMappings={manualMappings}
          onEditRow={setEditRow}
        />
      )}

      <ManualEditModal
        row={editRow}
        onClose={() => setEditRow(null)}
        onSave={(sku, mapping) => {
          const next = { ...manualMappings, [sku]: mapping }
          setManualMappings(next)
          void recalculateAfterManual(next)
        }}
      />

      {showUpdateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold text-white">Update Amazon inventory</h3>
            <p className="mt-2 text-sm text-slate-400">
              Marketplace: {marketplace} · {selectedRows.length} SKU(s) · {totalSelectedQty} total units
            </p>
            <p className="mt-4 text-sm text-amber-200">
              Amazon SP-API inventory updates are disabled in this release. Export recommendations and
              update inventory manually, or enable Stage 2 when available.
            </p>
            <button
              type="button"
              className="mt-4 rounded-xl border border-white/15 px-4 py-2 text-sm text-white"
              onClick={() => setShowUpdateModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
