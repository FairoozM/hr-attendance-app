import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  downloadInventoryHealthCsv,
  fetchInventoryHealth,
  fetchInventoryHealthImageStatus,
  fetchInventoryHealthImageSyncJob,
  fetchActiveInventoryHealthImageSyncJob,
  fetchInventoryHealthRowImages,
  formatMonthsOfCover,
  refreshInventoryHealth,
  startInventoryHealthImageSync,
  type InventoryHealthDashboard,
  type InventoryHealthDebug,
  type InventoryHealthImageCacheStatus,
  type FamilyMoneyFrozenRow,
  type InventoryHealthQuery,
  type InventoryHealthRowImageFields,
} from '../../../api/inventoryHealth'
import {
  exportInventoryHealthPdf,
  exportInventoryHealthXlsx,
} from './inventoryHealthExport'
import {
  applyInventoryHealthFilters,
  buildFamilyMoneyFrozen,
  buildInventoryHealthSummary,
  INVENTORY_HEALTH_IMAGE_SYNC_BATCH,
  INVENTORY_HEALTH_LOAD_QUERY,
  sortInventoryHealthRows,
} from './inventoryHealthClientFilters'
import { InventoryHealthItemThumb } from './InventoryHealthItemThumb'
import { playSyncCompleteBeep, primeSyncCompleteBeep } from '../../../lib/playCompletionBeep'
import { useWarehouses } from '../../../hooks/useWarehouses'
import '../../Page.css'
import './InventoryHealthDashboardPage.css'

type ViewMode = 'skus' | 'moneyFrozen'

const SKU_PAGE_SIZE = 100
const FAMILY_PAGE_SIZE = 50

const RISK_CLASSES = [
  { value: 'all', label: 'All risk classes' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'watch', label: 'Watch' },
  { value: 'slow_moving', label: 'Slow Moving' },
  { value: 'dead_stock', label: 'Dead Stock' },
] as const

const FAMILY_TYPES = [
  { value: 'all', label: 'All families' },
  { value: 'slow_moving', label: 'Slow Moving family' },
  { value: 'other', label: 'Other family' },
] as const

const SORT_OPTIONS = [
  { value: 'riskScore', label: 'Risk Score' },
  { value: 'inventoryValue', label: 'Inventory Value' },
  { value: 'monthsOfCover', label: 'Months of Cover' },
  { value: 'sku', label: 'SKU' },
] as const

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

function formatNum(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'AED', maximumFractionDigits: 0 })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 16)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function badgeClass(tag: string) {
  if (tag.includes('Dead Stock')) return 'ih-badge ih-badge--dead'
  if (tag.includes('Hidden Slow Moving')) return 'ih-badge ih-badge--hidden'
  if (tag.includes('Zero Sales')) return 'ih-badge ih-badge--zero'
  if (tag.includes('Overstock')) return 'ih-badge ih-badge--overstock'
  if (tag.includes('Slow Family')) return 'ih-badge ih-badge--family'
  if (tag.includes('High Value')) return 'ih-badge ih-badge--value'
  if (tag.includes('Slow Moving')) return 'ih-badge ih-badge--slow'
  if (tag.includes('Watch')) return 'ih-badge ih-badge--watch'
  if (tag.includes('Healthy')) return 'ih-badge ih-badge--healthy'
  return 'ih-badge'
}

function riskScoreClass(riskClass: string) {
  if (riskClass === 'Dead Stock') return 'ih-risk-score ih-risk-score--dead'
  if (riskClass === 'Slow Moving') return 'ih-risk-score ih-risk-score--slow'
  if (riskClass === 'Watch') return 'ih-risk-score ih-risk-score--watch'
  return 'ih-risk-score ih-risk-score--healthy'
}

function rowClass(riskClass: string, selected: boolean) {
  const classes = ['ih-row']
  if (riskClass === 'Dead Stock') classes.push('ih-row--dead')
  else if (riskClass === 'Slow Moving') classes.push('ih-row--slow')
  else if (riskClass === 'Watch') classes.push('ih-row--watch')
  else classes.push('ih-row--healthy')
  if (selected) classes.push('selected')
  return classes.join(' ')
}

function defaultFilters(): InventoryHealthQuery {
  return {
    warehouseId: undefined,
    familyType: 'all',
    riskClass: 'all',
    hiddenOnly: false,
    minStockQty: 1,
    includeZeroStock: false,
    sortBy: 'riskScore',
    sortDirection: 'desc',
    search: '',
  }
}

function warehouseLabel(
  warehouses: Array<{ warehouse_id?: string; warehouse_name?: string }>,
  warehouseId: string | undefined,
) {
  if (!warehouseId) return 'All warehouses'
  const match = warehouses.find((w) => String(w.warehouse_id || '') === warehouseId)
  return match?.warehouse_name || warehouseId
}

function formatDebugSnippet(debug: InventoryHealthDebug | undefined) {
  if (!debug) return ''
  const t = debug.timingsMs
  return (
    `mode=${debug.mode}, activeItems=${debug.activeItemsFetched}, stockItems=${debug.stockItemsIncluded}, ` +
    `timingsMs(total=${t.total}, items=${t.items}, sales90=${t.sales90}, sales180=${t.sales180}, sales365=${t.sales365})`
  )
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    totalPages,
    totalItems: items.length,
    items: items.slice(start, start + pageSize),
  }
}

type PaginationBarProps = {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  itemLabel: string
  onPrevious: () => void
  onNext: () => void
}

function formatPaginationLabel(page: number, pageSize: number, totalItems: number, itemLabel: string) {
  if (totalItems === 0) {
    return `Showing 0 of 0 ${itemLabel}`
  }
  const startIndex = (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalItems)
  const totalPages = Math.ceil(totalItems / pageSize)
  return (
    `Showing ${startIndex.toLocaleString()}–${endIndex.toLocaleString()} of ${totalItems.toLocaleString()} ${itemLabel} · Page ${page} of ${totalPages}`
  )
}

function PaginationBar({ page, totalPages, totalItems, pageSize, itemLabel, onPrevious, onNext }: PaginationBarProps) {
  return (
    <div className="ih-pagination">
      <div className="ih-pagination-info">
        {formatPaginationLabel(page, pageSize, totalItems, itemLabel)}
      </div>
      <div className="ih-pagination-controls">
        <button type="button" className="ih-btn" disabled={page <= 1} onClick={onPrevious}>
          Previous
        </button>
        <button type="button" className="ih-btn" disabled={page >= totalPages} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  )
}

type ExportKind = 'csv' | 'xlsx' | 'pdf'

export function InventoryHealthDashboardPage() {
  const [filters, setFilters] = useState<InventoryHealthQuery>(defaultFilters)
  const { warehouses, loading: warehousesLoading, error: warehousesError } = useWarehouses()
  const [data, setData] = useState<InventoryHealthDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [error, setError] = useState('')
  const [errorDebug, setErrorDebug] = useState('')
  const [selectedSku, setSelectedSku] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('skus')
  const [skuPage, setSkuPage] = useState(1)
  const [familyPage, setFamilyPage] = useState(1)
  const [imageStatus, setImageStatus] = useState<InventoryHealthImageCacheStatus | null>(null)
  const [imageStatusLoading, setImageStatusLoading] = useState(false)
  const [imageSyncing, setImageSyncing] = useState(false)
  const [imageSyncMessage, setImageSyncMessage] = useState('')
  const [lastImageSyncStats, setLastImageSyncStats] = useState<{
    downloaded: number
    saved: number
    noImageInZoho: number
    failed: number
    at: string
  } | null>(null)
  const [rowImageByItemId, setRowImageByItemId] = useState<Record<string, InventoryHealthRowImageFields>>({})
  const [appliedWarehouseId, setAppliedWarehouseId] = useState<string | undefined>(undefined)
  const [fetchTargetWarehouseId, setFetchTargetWarehouseId] = useState<string | undefined>(undefined)
  const imageSyncPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSyncedSavedRef = useRef(0)
  const rowImagesRequestRef = useRef(0)
  const visibleItemIdsRef = useRef<string[]>([])

  const warehousePending = (filters.warehouseId || '') !== (appliedWarehouseId || '')

  const queryParams = useMemo(
    () => ({ ...filters, warehouseId: appliedWarehouseId }),
    [filters, appliedWarehouseId],
  )

  const allRows = data?.rows || []

  const displayRows = useMemo(() => {
    const filtered = applyInventoryHealthFilters(allRows, filters)
    return sortInventoryHealthRows(filtered, filters.sortBy, filters.sortDirection)
  }, [allRows, filters])

  const summary = useMemo(() => {
    if (!data?.summary) return null
    return buildInventoryHealthSummary(displayRows, {
      generatedAt: data.summary.generatedAt,
      cacheStatus: data.summary.cacheStatus,
      warnings: data.summary.warnings,
    })
  }, [data?.summary, displayRows])

  const selected = useMemo(() => {
    if (!selectedSku || !displayRows.length) return null
    return displayRows.find((r) => r.sku === selectedSku) || null
  }, [displayRows, selectedSku])

  const sortedFamilies = useMemo(() => {
    const families = buildFamilyMoneyFrozen(displayRows)
    return [...families].sort((a, b) => (b.deadStockValue || 0) - (a.deadStockValue || 0))
  }, [displayRows])

  const skuPagination = useMemo(
    () => paginate(displayRows, skuPage, SKU_PAGE_SIZE),
    [displayRows, skuPage],
  )

  const familyPagination = useMemo(
    () => paginate<FamilyMoneyFrozenRow>(sortedFamilies, familyPage, FAMILY_PAGE_SIZE),
    [sortedFamilies, familyPage],
  )

  const loadVisibleRowImages = useCallback(async (itemIds: string[]) => {
    const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))]
    if (!ids.length) return
    const reqId = ++rowImagesRequestRef.current
    try {
      const images = await fetchInventoryHealthRowImages(ids)
      if (reqId !== rowImagesRequestRef.current) return
      setRowImageByItemId((prev) => ({ ...prev, ...images }))
    } catch {
      // non-fatal — placeholders remain
    }
  }, [])

  useEffect(() => {
    visibleItemIdsRef.current = skuPagination.items.map((r) => r.itemId).filter(Boolean)
    if (!data?.rows?.length || viewMode !== 'skus') return
    void loadVisibleRowImages(visibleItemIdsRef.current)
  }, [data?.rows, viewMode, skuPagination.items, skuPage, loadVisibleRowImages])

  const load = useCallback(async (opts?: { refresh?: boolean; warehouseId?: string | undefined }) => {
    const warehouseId = opts?.warehouseId !== undefined ? opts.warehouseId : appliedWarehouseId
    const query = {
      ...INVENTORY_HEALTH_LOAD_QUERY,
      warehouseId: warehouseId || undefined,
    }
    setFetchTargetWarehouseId(warehouseId)
    setError('')
    setErrorDebug('')
    if (opts?.refresh) setRefreshing(true)
    else setLoading(true)
    try {
      const result = opts?.refresh
        ? await refreshInventoryHealth(query)
        : await fetchInventoryHealth(query)
      setData(result)
      setAppliedWarehouseId(warehouseId)
    } catch (err) {
      const body = err as { message?: string; debug?: InventoryHealthDebug }
      setError(safeError(err))
      if (body && typeof body === 'object' && body.debug) {
        setErrorDebug(formatDebugSnippet(body.debug))
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
      setFetchTargetWarehouseId(undefined)
    }
  }, [appliedWarehouseId])

  useEffect(() => {
    void load({ warehouseId: undefined })
    // Initial load only — warehouse changes require Apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleApplyWarehouse = useCallback(() => {
    void load({ warehouseId: filters.warehouseId })
  }, [filters.warehouseId, load])

  useEffect(() => {
    setSkuPage(1)
    setFamilyPage(1)
  }, [filters])


  const updateFilters = useCallback((updater: (prev: InventoryHealthQuery) => InventoryHealthQuery) => {
    setFilters(updater)
  }, [])

  const exportRows = displayRows
  const showInitialSkeleton = loading && !data
  const inventoryFetching = loading || refreshing
  const canExport = !showInitialSkeleton && exportRows.length > 0 && !inventoryFetching
  const exportBusy = exporting != null

  const [loadSeconds, setLoadSeconds] = useState(0)

  useEffect(() => {
    if (!inventoryFetching) {
      setLoadSeconds(0)
      return
    }
    const started = Date.now()
    setLoadSeconds(0)
    const timer = window.setInterval(() => {
      setLoadSeconds(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [inventoryFetching])

  const handleExportCsv = useCallback(async () => {
    if (!canExport) return
    setExporting('csv')
    try {
      await downloadInventoryHealthCsv(queryParams)
    } finally {
      setExporting(null)
    }
  }, [canExport, queryParams])

  const handleExportXlsx = useCallback(async () => {
    if (!canExport) return
    setExporting('xlsx')
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      exportInventoryHealthXlsx(exportRows)
    } finally {
      setExporting(null)
    }
  }, [canExport, exportRows])

  const handleExportPdf = useCallback(async () => {
    if (!canExport) return
    setExporting('pdf')
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      exportInventoryHealthPdf(exportRows)
    } finally {
      setExporting(null)
    }
  }, [canExport, exportRows])

  const loadImageStatus = useCallback(async () => {
    setImageStatusLoading(true)
    try {
      const status = await fetchInventoryHealthImageStatus()
      setImageStatus(status)
    } catch (err) {
      setImageSyncMessage(safeError(err))
    } finally {
      setImageStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadImageStatus()
  }, [loadImageStatus])

  const stopImageSyncPoll = useCallback(() => {
    if (imageSyncPollRef.current) {
      clearInterval(imageSyncPollRef.current)
      imageSyncPollRef.current = null
    }
  }, [])

  const pollImageSyncJob = useCallback(
    (jobId: string) => {
      stopImageSyncPoll()
      lastSyncedSavedRef.current = 0

      const tick = async () => {
        try {
          const job = await fetchInventoryHealthImageSyncJob(jobId)
          const p = job.progress
          setImageSyncMessage(
            (p.rateLimitPaused
              ? 'Zoho rate limited — wait ~15 min, then click Sync again. '
              : '') +
              `${p.step} — ${p.saved} saved` +
              `${(p.noImageInZoho ?? 0) > 0 ? `, ${p.noImageInZoho} no image in Zoho` : ''}` +
              `${p.failed > 0 && !p.rateLimitPaused ? `, ${p.failed} errors` : ''}` +
              `${p.remaining > 0 ? `, ~${p.remaining} left this batch` : ''}`,
          )
          setLastImageSyncStats({
            downloaded: p.saved,
            saved: p.saved,
            noImageInZoho: p.noImageInZoho ?? 0,
            failed: p.failed,
            at: new Date().toISOString(),
          })
          if (p.saved > lastSyncedSavedRef.current) {
            lastSyncedSavedRef.current = p.saved
            void loadImageStatus()
            void loadVisibleRowImages(visibleItemIdsRef.current)
          }
          if (job.status === 'completed' || job.status === 'failed') {
            stopImageSyncPoll()
            setImageSyncing(false)
            if (job.status === 'failed') {
              setImageSyncMessage(job.error || 'Image sync failed')
            } else if (job.result?.rateLimitPaused) {
              setImageSyncMessage(
                'Zoho rate limited — wait ~15 minutes, then click Sync next 20 images again.',
              )
            } else if (job.result && job.result.saved === 0 && (job.result.skippedDueToLimit ?? 0) > 0) {
              setImageSyncMessage(
                `No new images saved this run (~${job.result.skippedDueToLimit.toLocaleString()} still need sync` +
                  `${(job.result.noImageInZoho ?? 0) > 0 ? `, ${job.result.noImageInZoho} confirmed no image in Zoho` : ''}` +
                  `${job.result.failed > 0 ? `, ${job.result.failed} errors` : ''}). Click Sync again.`,
              )
            } else if (job.result) {
              const sampleErrors = (job.result.errors || [])
                .slice(0, 2)
                .map((e) => e.reason || e.message || 'unknown')
                .join('; ')
              setImageSyncMessage(
                `Done — ${job.result.saved} saved` +
                  `${(job.result.noImageInZoho ?? 0) > 0 ? `, ${job.result.noImageInZoho} no image in Zoho (won't retry)` : ''}` +
                  `${job.result.failed > 0 ? `, ${job.result.failed} errors` : ''}` +
                  `${job.result.skippedDueToLimit > 0 ? `, ${job.result.skippedDueToLimit.toLocaleString()} still queued` : ''}` +
                  `${sampleErrors ? ` — ${sampleErrors}` : ''}.`,
              )
            }
            if (job.status === 'completed') {
              playSyncCompleteBeep()
            }
            await loadImageStatus()
            void loadVisibleRowImages(visibleItemIdsRef.current)
          }
        } catch (err) {
          stopImageSyncPoll()
          setImageSyncing(false)
          setImageSyncMessage(safeError(err))
        }
      }

      void tick()
      imageSyncPollRef.current = setInterval(() => void tick(), 2500)
    },
    [loadImageStatus, loadVisibleRowImages, stopImageSyncPoll],
  )

  useEffect(() => {
    void (async () => {
      try {
        const { job } = await fetchActiveInventoryHealthImageSyncJob()
        if (job && (job.status === 'queued' || job.status === 'running')) {
          setImageSyncing(true)
          pollImageSyncJob(job.jobId)
        }
      } catch {
        // ignore — status optional on load
      }
    })()
    return () => stopImageSyncPoll()
  }, [pollImageSyncJob, stopImageSyncPoll])

  const handleSyncMissingImages = useCallback(async () => {
    primeSyncCompleteBeep()
    setImageSyncing(true)
    setImageSyncMessage('Starting safe batch (20 images, 1 at a time)…')
    try {
      const job = await startInventoryHealthImageSync(INVENTORY_HEALTH_IMAGE_SYNC_BATCH)
      pollImageSyncJob(job.jobId)
    } catch (err) {
      setImageSyncMessage(safeError(err))
      setImageSyncing(false)
    }
  }, [pollImageSyncJob])

  return (
    <div className="ih-page page">
      <div className="ih-header">
        <div>
          <h1>Inventory Health &amp; Dead Stock</h1>
          <p>
            Fast V1 view using Zoho stock and sales-by-item velocity only (no last-sold scan on load).
            Highlights hidden slow movers inside otherwise normal families.{' '}
            <strong>First Zoho load can take 1–3 min once;</strong> after that it uses server cache (fast).
          </p>
        </div>
        <div className="ih-actions">
          <button
            type="button"
            className="ih-btn ih-btn--primary"
            disabled={inventoryFetching}
            onClick={() => void load({ refresh: true, warehouseId: appliedWarehouseId })}
          >
            {refreshing ? 'Refreshing…' : 'Refresh from Zoho'}
          </button>
          <button
            type="button"
            className="ih-btn"
            disabled={imageSyncing || loading}
            onClick={() => void handleSyncMissingImages()}
          >
            {imageSyncing ? 'Syncing batch…' : 'Sync next 20 images'}
          </button>
          <button
            type="button"
            className="ih-btn"
            disabled={imageStatusLoading}
            onClick={() => void loadImageStatus()}
          >
            {imageStatusLoading ? 'Loading status…' : 'Image Cache Status'}
          </button>
          <div className="ih-export-group" role="group" aria-label="Export options">
            <button
              type="button"
              className="ih-btn"
              disabled={!canExport || exportBusy}
              onClick={() => void handleExportCsv()}
            >
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              type="button"
              className="ih-btn"
              disabled={!canExport || exportBusy}
              onClick={() => void handleExportXlsx()}
            >
              {exporting === 'xlsx' ? 'Exporting…' : 'Export XLSX'}
            </button>
            <button
              type="button"
              className="ih-btn"
              disabled={!canExport || exportBusy}
              onClick={() => void handleExportPdf()}
            >
              {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="ih-error">
          {error}
          {errorDebug ? <div className="ih-card-sub" style={{ marginTop: '0.5rem' }}>{errorDebug}</div> : null}
        </div>
      ) : null}

      {imageSyncMessage ? <div className="ih-image-sync-msg">{imageSyncMessage}</div> : null}

      {imageStatus ? (
        <div className="ih-image-status">
          <div className="ih-image-status-title">Image cache</div>
          <div className="ih-image-status-grid">
            <span>
              Cached: {imageStatus.cachedImages.toLocaleString()} /{' '}
              {(imageStatus.totalActiveItems ?? 0).toLocaleString()} active items
            </span>
            <span>Still need sync: {imageStatus.missingImages.toLocaleString()}</span>
            {(imageStatus.noImageInZoho ?? 0) > 0 ? (
              <span>No image in Zoho: {(imageStatus.noImageInZoho ?? 0).toLocaleString()}</span>
            ) : null}
            <span>Coverage: {imageStatus.cacheCoveragePercent}%</span>
            <span>Last sync: {formatDateTime(imageStatus.lastSyncAt)}</span>
            {lastImageSyncStats ? (
              <span>
                Last batch: {lastImageSyncStats.saved} saved
                {lastImageSyncStats.noImageInZoho > 0
                  ? `, ${lastImageSyncStats.noImageInZoho} no image in Zoho`
                  : ''}
                {lastImageSyncStats.failed > 0 ? `, ${lastImageSyncStats.failed} errors` : ''} (
                {formatDateTime(lastImageSyncStats.at)})
              </span>
            ) : null}
          </div>
          {imageStatus.cachedImages === 0 && imageStatus.missingImages === 0 ? (
            <div className="ih-image-status-hint">
              No product images cached yet. Click <strong>Sync next 20 images</strong> for one safe batch from Zoho (repeat after each batch completes).
            </div>
          ) : imageStatus.missingImages > 0 ? (
            <div className="ih-image-status-hint">
              {imageStatus.missingImages.toLocaleString()} images still need sync. Click{' '}
              <strong>Sync next 20 images</strong> — downloads directly from Zoho (one batch; repeat to continue).
            </div>
          ) : null}
        </div>
      ) : null}

      {summary?.warnings && summary.warnings.length > 0 ? (
        <div className="ih-warnings">
          {summary.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}


      {inventoryFetching ? (
        <div className="ih-fetch-banner" role="status" aria-live="polite">
          <div className="ih-fetch-banner__spinner" aria-hidden />
          <div>
            <strong>
              {refreshing ? 'Refreshing from Zoho' : 'Loading inventory'} —{' '}
              {warehouseLabel(warehouses, fetchTargetWarehouseId ?? appliedWarehouseId)}
            </strong>
            <p>
              Fetching stock and sales from Zoho
              {loadSeconds > 0 ? ` · ${loadSeconds}s elapsed` : ''}
              {loadSeconds >= 45 ? ' · still working, please wait.' : ' · may take 1–3 minutes for a new warehouse.'}
            </p>
          </div>
        </div>
      ) : null}

      {showInitialSkeleton ? (
        <>
          <div className="ih-skeleton-grid">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="ih-skeleton ih-skeleton-card" />
            ))}
          </div>
          <div className="ih-skeleton ih-skeleton-table" />
          <div className="ih-loading">
            Loading inventory health… {loadSeconds > 0 ? `${loadSeconds}s` : ''}
            <br />
            <span className="ih-card-sub">
              First fetch from Zoho after cache clear can take 2–5 min. Do not refresh the browser — wait for this to finish.
            </span>
          </div>
        </>
      ) : null}

      {!showInitialSkeleton && summary ? (
        <div className={`ih-cards-wrap${inventoryFetching && data ? ' ih-cards-wrap--fetching' : ''}`}>
          <div className="ih-cards">
            <div className="ih-card">
              <div className="ih-card-label">Total Inventory Value</div>
              <div className="ih-card-value">{formatMoney(summary.totalInventoryValue)}</div>
              <div className="ih-card-sub">{formatNum(summary.totalStockQty, 0)} units</div>
            </div>
            <div className="ih-card">
              <div className="ih-card-label">Dead Stock Value</div>
              <div className="ih-card-value">{formatMoney(summary.deadStockValue)}</div>
              <div className="ih-card-sub">{summary.deadStockCount} SKUs</div>
            </div>
            <div className="ih-card">
              <div className="ih-card-label">Hidden Slow Moving Value</div>
              <div className="ih-card-value">{formatMoney(summary.hiddenSlowMovingValue)}</div>
              <div className="ih-card-sub">{summary.hiddenSlowMovingCount} SKUs</div>
            </div>
            <div className="ih-card">
              <div className="ih-card-label">Dead Stock SKUs</div>
              <div className="ih-card-value">{formatNum(summary.deadStockCount, 0)}</div>
            </div>
            <div className="ih-card">
              <div className="ih-card-label">Hidden Slow Moving SKUs</div>
              <div className="ih-card-value">{formatNum(summary.hiddenSlowMovingCount, 0)}</div>
            </div>
          </div>

          <div className="ih-meta">
            Generated {formatDateTime(summary.generatedAt)} · Cache: {summary.cacheStatus}
            · Warehouse: {warehouseLabel(warehouses, appliedWarehouseId ?? data?.warehouseId ?? undefined)}
            {warehousePending ? (
              <> · <span className="ih-meta-pending">Pending: {warehouseLabel(warehouses, filters.warehouseId)}</span></>
            ) : null}
            {summary.topRiskFamily ? (
              <> · Top risk family: {summary.topRiskFamily.familyName} ({formatMoney(summary.topRiskFamily.riskValue)})</>
            ) : null}
            {data?.debug ? <> · {formatDebugSnippet(data.debug)}</> : null}
          </div>
        </div>
      ) : null}

      <div className="ih-tabs">
        <button type="button" className={`ih-tab ${viewMode === 'skus' ? 'active' : ''}`} onClick={() => setViewMode('skus')}>
          SKU table
        </button>
        <button
          type="button"
          className={`ih-tab ${viewMode === 'moneyFrozen' ? 'active' : ''}`}
          onClick={() => setViewMode('moneyFrozen')}
        >
          Money Frozen (by family)
        </button>
      </div>

      <div className="ih-filters">
        <label>
          Warehouse
          <select
            value={filters.warehouseId || ''}
            disabled={warehousesLoading}
            onChange={(e) =>
              updateFilters((f) => ({
                ...f,
                warehouseId: e.target.value ? e.target.value : undefined,
              }))
            }
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => {
              const id = String(w.warehouse_id || '').trim()
              if (!id) return null
              const name = String(w.warehouse_name || id).trim()
              return (
                <option key={id} value={id}>
                  {name}
                  {w.is_primary ? ' (primary)' : ''}
                </option>
              )
            })}
          </select>
        </label>
        <div className="ih-warehouse-apply">
          <button
            type="button"
            className="ih-btn ih-btn--primary"
            disabled={!warehousePending || inventoryFetching}
            onClick={() => void handleApplyWarehouse()}
          >
            {inventoryFetching ? 'Loading…' : 'Apply warehouse'}
          </button>
        </div>
        {warehousePending ? (
          <div className="ih-filter-hint ih-filter-hint--pending">
            Warehouse changed to <strong>{warehouseLabel(warehouses, filters.warehouseId)}</strong>. Click{' '}
            <strong>Apply warehouse</strong> to fetch from Zoho (may take 1–3 minutes).
          </div>
        ) : null}
        {warehousesError ? <div className="ih-filter-hint ih-filter-hint--warn">{warehousesError}</div> : null}
        <label>
          Search SKU / name / family
          <input
            type="search"
            value={filters.search || ''}
            onChange={(e) => updateFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search…"
          />
        </label>
        <label>
          Risk class
          <select
            value={filters.riskClass || 'all'}
            onChange={(e) => updateFilters((f) => ({ ...f, riskClass: e.target.value as InventoryHealthQuery['riskClass'] }))}
          >
            {RISK_CLASSES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          Family type
          <select
            value={filters.familyType || 'all'}
            onChange={(e) => updateFilters((f) => ({ ...f, familyType: e.target.value as InventoryHealthQuery['familyType'] }))}
          >
            {FAMILY_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          Min stock qty
          <input
            type="number"
            min={0}
            value={filters.minStockQty ?? 1}
            onChange={(e) => updateFilters((f) => ({ ...f, minStockQty: Number(e.target.value) || 0 }))}
          />
        </label>
        <label>
          Min stock value
          <input
            type="number"
            min={0}
            value={filters.minInventoryValue ?? ''}
            onChange={(e) =>
              updateFilters((f) => ({
                ...f,
                minInventoryValue: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
          />
        </label>
        <label>
          Sort by
          <select
            value={filters.sortBy || 'riskScore'}
            onChange={(e) => updateFilters((f) => ({ ...f, sortBy: e.target.value }))}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select
            value={filters.sortDirection || 'desc'}
            onChange={(e) => updateFilters((f) => ({ ...f, sortDirection: e.target.value as 'asc' | 'desc' }))}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <label className="ih-check">
          <input
            type="checkbox"
            checked={!!filters.hiddenOnly}
            onChange={(e) => updateFilters((f) => ({ ...f, hiddenOnly: e.target.checked }))}
          />
          Hidden only
        </label>
        <label className="ih-check">
          <input
            type="checkbox"
            checked={!!filters.includeZeroStock}
            onChange={(e) => updateFilters((f) => ({ ...f, includeZeroStock: e.target.checked }))}
          />
          Include zero stock
        </label>
      </div>

      {!showInitialSkeleton && viewMode === 'skus' ? (
        <div className={`ih-table-panel${inventoryFetching && data ? ' ih-table-panel--fetching' : ''}`}>
          {inventoryFetching && data ? <div className="ih-fetch-overlay" aria-hidden /> : null}
          {skuPagination.totalItems > 0 ? (
            <>
              <div className="ih-table-wrap">
                <table className="ih-table">
                  <thead>
                    <tr>
                      <th className="ih-col-image">Image</th>
                      <th className="ih-col-item">Item</th>
                      <th className="ih-col-family">Family</th>
                      <th className="ih-col-num">Stock</th>
                      <th className="ih-col-num">Value</th>
                      <th className="ih-col-sales">90 / 180 / 365 Sales</th>
                      <th className="ih-col-cover">Cover</th>
                      <th className="ih-col-risk">Risk</th>
                      <th className="ih-col-tags">Tags</th>
                      <th className="ih-col-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuPagination.items.map((row) => {
                      const img = rowImageByItemId[row.itemId]
                      return (
                      <tr
                        key={`${row.itemId}-${row.sku}`}
                        className={rowClass(row.riskClass, selected?.sku === row.sku)}
                        onClick={() => setSelectedSku(row.sku)}
                      >
                        <td className="ih-col-image-cell" onClick={(e) => e.stopPropagation()}>
                          <InventoryHealthItemThumb
                            imageUrl={img?.imageUrl ?? row.imageUrl}
                            imageMissing={img?.imageMissing ?? row.imageMissing}
                            itemId={row.itemId}
                            itemName={row.itemName}
                            sku={row.sku}
                          />
                        </td>
                        <td className="ih-cell-ellipsis" title={row.sku ? `${row.sku} — ${row.itemName || ''}` : row.itemName || undefined}>
                          {row.itemName || '—'}
                        </td>
                        <td>
                          <div className="ih-cell-ellipsis" title={row.familyName || undefined}>{row.familyName || '—'}</div>
                          <div className="ih-cell-muted">{row.familyType}</div>
                        </td>
                        <td>{formatNum(row.currentStockQty, 0)}</td>
                        <td>
                          <div>{formatMoney(row.inventoryValue)}</div>
                          {row.salesPrice > 0 ? (
                            <div className="ih-cell-muted">
                              {formatMoney(row.salesPrice)} × {formatNum(row.currentStockQty, 0)}
                            </div>
                          ) : (
                            <div className="ih-cell-muted">No sales price</div>
                          )}
                        </td>
                        <td>
                          {formatNum(row.salesQty90, 0)} / {formatNum(row.salesQty180, 0)} / {formatNum(row.salesQty365, 0)}
                        </td>
                        <td>{formatMonthsOfCover(row.monthsOfCover)}</td>
                        <td>
                          <div className="ih-risk-pill">
                            <span className={riskScoreClass(row.riskClass)}>{row.riskScore}</span>
                            <span className="ih-risk-label">{row.riskClass}</span>
                          </div>
                        </td>
                        <td>
                          <div className="ih-tags">
                            {(row.tags || []).map((tag) => (
                              <span key={tag} className={badgeClass(tag)} title={tag}>{tag}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="ih-action-text" title={row.recommendedAction}>{row.recommendedAction}</div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={skuPagination.page}
                totalPages={skuPagination.totalPages}
                totalItems={skuPagination.totalItems}
                pageSize={SKU_PAGE_SIZE}
                itemLabel="filtered SKUs"
                onPrevious={() => setSkuPage((p) => Math.max(1, p - 1))}
                onNext={() => setSkuPage((p) => Math.min(skuPagination.totalPages, p + 1))}
              />
            </>
          ) : (
            <div className="ih-empty">
              {error ? 'Could not load SKU rows. Try Refresh from Zoho or check the error above.' : 'No SKUs match the current filters.'}
            </div>
          )}
        </div>
      ) : null}

      {!showInitialSkeleton && viewMode === 'moneyFrozen' ? (
        <div className={`ih-table-panel${inventoryFetching && data ? ' ih-table-panel--fetching' : ''}`}>
          {inventoryFetching && data ? <div className="ih-fetch-overlay" aria-hidden /> : null}
          {familyPagination.totalItems > 0 ? (
            <>
              <div className="ih-table-wrap">
                <table className="ih-table">
                  <thead>
                    <tr>
                      <th>Family</th>
                      <th>Total Inventory Value</th>
                      <th>Dead Stock Value</th>
                      <th>Hidden Slow Moving Value</th>
                      <th>Risk SKU Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {familyPagination.items.map((row) => (
                      <tr key={row.familyName} className="ih-row ih-row--healthy">
                        <td>{row.familyName}</td>
                        <td>{formatMoney(row.totalInventoryValue)}</td>
                        <td>{formatMoney(row.deadStockValue)}</td>
                        <td>{formatMoney(row.hiddenSlowMovingValue)}</td>
                        <td>{formatNum(row.numberOfRiskSkus, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={familyPagination.page}
                totalPages={familyPagination.totalPages}
                totalItems={familyPagination.totalItems}
                pageSize={FAMILY_PAGE_SIZE}
                itemLabel="families"
                onPrevious={() => setFamilyPage((p) => Math.max(1, p - 1))}
                onNext={() => setFamilyPage((p) => Math.min(familyPagination.totalPages, p + 1))}
              />
            </>
          ) : (
            <div className="ih-empty">No family data for current filters.</div>
          )}
        </div>
      ) : null}

      {selected ? (
        <div className="ih-detail">
          <h3>{selected.sku} — {selected.itemName}</h3>
          <dl className="ih-detail-grid">
            <div className="ih-detail-item">
              <dt>Current stock</dt>
              <dd>{formatNum(selected.currentStockQty, 0)} (available {formatNum(selected.availableStockQty, 0)})</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Inventory value</dt>
              <dd>
                {formatMoney(selected.inventoryValue)} ({formatMoney(selected.salesPrice)} ×{' '}
                {formatNum(selected.currentStockQty, 0)})
              </dd>
            </div>
            <div className="ih-detail-item">
              <dt>Purchase rate (cost)</dt>
              <dd>{formatMoney(selected.purchaseRate)}</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Last sold</dt>
              <dd title="Not loaded in fast V1 mode">—</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Sales 90 / 180 / 365 days</dt>
              <dd>{formatNum(selected.salesQty90, 0)} / {formatNum(selected.salesQty180, 0)} / {formatNum(selected.salesQty365, 0)}</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Avg monthly sales (180d)</dt>
              <dd>{formatNum(selected.avgMonthlySales180, 2)}</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Months of cover</dt>
              <dd>{formatMonthsOfCover(selected.monthsOfCover)} months</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Sell-through (180d)</dt>
              <dd>{formatNum(selected.sellThroughRate180 * 100, 1)}%</dd>
            </div>
            <div className="ih-detail-item">
              <dt>Risk score / class</dt>
              <dd>
                <span className={riskScoreClass(selected.riskClass)}>{selected.riskScore}</span>
                {' '}
                {selected.riskClass}
              </dd>
            </div>
            <div className="ih-detail-item">
              <dt>Family</dt>
              <dd>{selected.familyName || '—'} ({selected.familyType}){selected.hiddenSlowMoving ? ' · Hidden slow moving' : ''}</dd>
            </div>
            <div className="ih-detail-item" style={{ gridColumn: '1 / -1' }}>
              <dt>Reason</dt>
              <dd style={{ fontWeight: 400 }}>{selected.reason}</dd>
            </div>
            <div className="ih-detail-item" style={{ gridColumn: '1 / -1' }}>
              <dt>Recommended action</dt>
              <dd>{selected.recommendedAction}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}

export default InventoryHealthDashboardPage
