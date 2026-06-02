import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SummaryCards } from '../components/amazon/outOfStockClearance/SummaryCards'
import { VigilUploadPanel } from '../components/amazon/outOfStockClearance/VigilUploadPanel'
import { AmazonOosSkusTable } from '../components/amazon/outOfStockClearance/AmazonOosSkusTable'
import { ResultsTable } from '../components/amazon/outOfStockClearance/ResultsTable'
import { ManualEditModal } from '../components/amazon/outOfStockClearance/ManualEditModal'
import {
  fetchAmazonOutOfStockFromCache,
  startAmazonOutOfStockFetch,
  getAmazonOutOfStockFetchStatus,
  fetchZohoStockForClearance,
  calculateClearance,
  exportClearanceRows,
  type AmazonOosRow,
  type ClearanceResultRow,
  type ClearanceSummary,
  type ManualMapping,
  type AmazonOosFilter,
  type MarketplaceCode,
  type OutOfStockFetchJob,
  type VigilParsedRow,
  type ZohoStockRow,
} from '../api/amazonOutOfStockClearance'

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

function marketplaceFromQuery(raw: string | null): MarketplaceCode {
  const v = String(raw || '').trim().toUpperCase()
  return v === 'KSA' ? 'KSA' : 'UAE'
}

function marketplaceToZohoStockPath(mk: MarketplaceCode, oosFilter: AmazonOosFilter) {
  const slug = mk === 'KSA' ? 'ksa' : 'uae'
  const stockFilter =
    oosFilter === 'sellerCentralInactiveOos' ? 'sellerCentralInactiveOos' : 'amazonOutOfStock'
  return `/ai/amazon-zoho-stock?marketplace=${slug}&stockFilter=${stockFilter}`
}

export function AmazonOutOfStockClearancePage() {
  const [searchParams] = useSearchParams()
  const [marketplace, setMarketplace] = useState<MarketplaceCode>(() =>
    marketplaceFromQuery(searchParams.get('marketplace'))
  )
  const [oosFilter, setOosFilter] = useState<AmazonOosFilter>(() => {
    const q = searchParams.get('oosFilter')
    return q === 'amazonFbaZero' ? 'amazonFbaZero' : 'sellerCentralInactiveOos'
  })
  const [amazonRows, setAmazonRows] = useState<AmazonOosRow[]>([])
  const [zohoRows, setZohoRows] = useState<ZohoStockRow[]>([])
  const [vigilRows, setVigilRows] = useState<VigilParsedRow[]>([])
  const [resultRows, setResultRows] = useState<ClearanceResultRow[]>([])
  const [summary, setSummary] = useState<ClearanceSummary | null>(null)
  const [manualMappings, setManualMappings] = useState<Record<string, ManualMapping>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [maxRecommendedQty, setMaxRecommendedQty] = useState<string>('')

  const [fetchingAmazon, setFetchingAmazon] = useState(false)
  const [fetchJob, setFetchJob] = useState<OutOfStockFetchJob | null>(null)
  const [fetchProgress, setFetchProgress] = useState('')
  const [dataSource, setDataSource] = useState<'cache' | 'live' | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const [editRow, setEditRow] = useState<ClearanceResultRow | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)

  const applyFetchResult = useCallback((json: OutOfStockFetchJob & { zohoRowsFromCache?: ZohoStockRow[] }) => {
    const rows = Array.isArray(json.rows) ? json.rows : []
    setAmazonRows(rows)
    setFetchedAt(json.fetchedAt || null)
    setWarnings(Array.isArray(json.warnings) ? json.warnings : [])
    setDataSource(json.source === 'live' ? 'live' : json.source === 'cache' ? 'cache' : null)
    if (Array.isArray(json.zohoRowsFromCache) && json.zohoRowsFromCache.length > 0) {
      setZohoRows(json.zohoRowsFromCache)
    }
  }, [])

  const runLoadFromCache = useCallback(async () => {
    setFetchingAmazon(true)
    setFetchJob(null)
    setFetchProgress('')
    setError('')
    setWarnings([])
    setResultRows([])
    setSummary(null)
    setSelectedIds(new Set())
    try {
      const json = await fetchAmazonOutOfStockFromCache(marketplace, oosFilter)
      if (!json?.success) {
        setError((json as { error?: string }).error || 'Failed to load cached SKUs')
        return
      }
      applyFetchResult(json)
    } catch (e) {
      setError(safeError(e))
    } finally {
      setFetchingAmazon(false)
    }
  }, [marketplace, oosFilter, applyFetchResult])

  const runLiveFetchAmazon = useCallback(
    async (mode: 'fast' | 'fba' | 'listings-report' = 'fast') => {
      setFetchingAmazon(true)
      setFetchJob(null)
      setFetchProgress(
        mode === 'fba'
          ? 'Scanning Amazon FBA inventory API…'
          : mode === 'listings-report'
            ? 'Starting legacy listings report…'
            : 'Refreshing FBA inventory for cached SKUs…'
      )
      setError('')
      setWarnings(
        mode === 'fba'
          ? [
              'Amazon has no “out of stock SKUs” endpoint. We page GET /fba/inventory/v1/summaries and filter fulfillable qty = 0 (time depends on total FBA SKU count, not your 24 OOS rows).',
            ]
          : mode === 'listings-report'
            ? ['Legacy path uses the slow merchant listings report. Prefer "Discover all OOS (FBA API)".']
            : []
      )
      setResultRows([])
      setSummary(null)
      setSelectedIds(new Set())
      try {
        const json = await startAmazonOutOfStockFetch(marketplace, mode)
        setFetchJob(json)
        if (!['queued', 'running'].includes(json.status)) {
          setFetchingAmazon(false)
          if (json.status === 'completed' && json.rows) applyFetchResult(json)
          if (json.status === 'failed') setError(json.error || 'Amazon fetch failed')
        }
      } catch (e) {
        setError(safeError(e))
        setFetchingAmazon(false)
      }
    },
    [marketplace, applyFetchResult]
  )

  useEffect(() => {
    if (!fetchJob?.jobId || !['queued', 'running'].includes(fetchJob.status)) return undefined
    const step = fetchJob.progress?.step
    if (step) setFetchProgress(step)
    const timer = window.setInterval(async () => {
      try {
        const json = await getAmazonOutOfStockFetchStatus(fetchJob.jobId)
        setFetchJob(json)
        if (json.progress?.step) setFetchProgress(json.progress.step)
        if (json.status === 'completed') {
          setFetchingAmazon(false)
          applyFetchResult(json)
        } else if (json.status === 'failed') {
          setFetchingAmazon(false)
          setError(json.error || 'Amazon fetch failed')
        }
      } catch (e) {
        setFetchingAmazon(false)
        setError(safeError(e))
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [fetchJob?.jobId, fetchJob?.status, applyFetchResult])

  useEffect(() => {
    void runLoadFromCache()
  }, [runLoadFromCache])

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
          Replenishment workflow for Amazon UAE/KSA SKUs with zero FBA fulfillable quantity. OOS SKUs are
          loaded from the same cache as{' '}
          <Link className="text-emerald-300 underline" to={marketplaceToZohoStockPath(marketplace, oosFilter)}>
            Amazon + Zoho Stock
          </Link>{' '}
          (refresh once there — includes Amazon inactive OOS report). Amazon inventory writes are not enabled yet.
        </p>
      </header>

      <AmazonOosSkusTable
        rows={amazonRows}
        marketplace={marketplace}
        oosFilter={oosFilter}
        loading={fetchingAmazon}
        fetchedAt={fetchedAt}
      />

      <section className="rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-5 backdrop-blur-md">
        <p className="text-sm font-semibold text-emerald-100">Step 1 — refresh OOS list (fast)</p>
        <p className="mt-1 text-sm text-emerald-50/90">
          On{' '}
          <Link className="font-semibold text-white underline" to={marketplaceToZohoStockPath(marketplace, oosFilter)}>
            Amazon + Zoho Stock
          </Link>
          : choose {marketplace}, click <strong>Refresh Amazon + Zoho</strong> (pulls inactive OOS report), then
          filter <strong>Seller Central inactive OOS</strong>. This page reloads from cache automatically.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            to={marketplaceToZohoStockPath(marketplace, oosFilter)}
          >
            Open Amazon + Zoho Stock →
          </Link>
          <button
            type="button"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            disabled={fetchingAmazon}
            onClick={() => void runLoadFromCache()}
          >
            {fetchingAmazon ? 'Loading cache…' : 'Reload OOS from cache'}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-3">
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
            <label className="text-sm text-slate-400 md:col-span-2">
              OOS source (Amazon filter)
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={oosFilter}
                onChange={(e) => setOosFilter(e.target.value as AmazonOosFilter)}
              >
                <option value="sellerCentralInactiveOos">
                  Seller Central — Inactive → Out of stock (~26)
                </option>
                <option value="amazonFbaZero">
                  Active listings — FBA on-hand &amp; fulfillable both 0 (~1300+)
                </option>
              </select>
            </label>
            <label className="text-sm text-slate-400 md:col-span-3">
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
        </div>
        <details className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-300">
            Advanced — live Amazon sync (only if cache is empty or stale)
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50"
              disabled={fetchingAmazon}
              onClick={() => void runLiveFetchAmazon('fast')}
            >
              {fetchingAmazon && fetchJob ? 'Refreshing…' : 'Refresh FBA for cached SKUs'}
            </button>
            <button
              type="button"
              className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
              disabled={fetchingAmazon}
              title="Pages entire FBA catalog — slow"
              onClick={() => void runLiveFetchAmazon('fba')}
            >
              Discover all OOS (slow)
            </button>
          </div>
        </details>
        {fetchingAmazon && fetchProgress && (
          <p className="mt-3 text-sm text-sky-200/90">{fetchProgress}</p>
        )}
        {fetchedAt && (
          <p className="mt-3 text-xs text-slate-500">
            Data {dataSource === 'live' ? 'from live Amazon' : dataSource === 'cache' ? 'from cache' : ''} ·{' '}
            {new Date(fetchedAt).toLocaleString()}
          </p>
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

      {summary ? (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">After calculate</h2>
          <SummaryCards summary={summary} />
        </section>
      ) : null}

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
