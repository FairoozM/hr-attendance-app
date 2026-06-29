import { api, downloadBlob, fetchBinary } from './client'

export type InventoryHealthRiskClass = 'Healthy' | 'Watch' | 'Slow Moving' | 'Dead Stock'
export type InventoryHealthFamilyType = 'Slow Moving' | 'Other'

export interface InventoryHealthRow {
  sku: string
  itemId: string
  itemName: string
  familyName: string
  familyType: InventoryHealthFamilyType
  currentStockQty: number
  availableStockQty: number
  salesPrice: number
  purchaseRate: number
  inventoryValue: number
  salesQty90: number
  salesQty180: number
  salesQty365: number
  avgMonthlySales180: number
  monthsOfCover: number | null
  sellThroughRate180: number
  riskScore: number
  riskClass: InventoryHealthRiskClass
  tags: string[]
  reason: string
  recommendedAction: string
  hiddenSlowMoving: boolean
  imageUrl?: string | null
  imageSource?: string | null
  imageCachedAt?: string | null
  imageMissing?: boolean
}

export interface InventoryHealthSummary {
  totalItemsChecked: number
  totalStockQty: number
  totalInventoryValue: number
  deadStockCount: number
  deadStockValue: number
  slowMovingCount: number
  slowMovingValue: number
  hiddenSlowMovingCount: number
  hiddenSlowMovingValue: number
  zeroSales180Count: number
  zeroSales365Count: number
  topRiskFamily: {
    familyName: string
    riskValue: number
    riskSkuCount: number
  } | null
  generatedAt: string
  cacheStatus: string
  warnings?: string[]
}

export interface InventoryHealthDebug {
  itemsFetched: number
  activeItemsFetched: number
  stockItemsIncluded: number
  sales90RowsFetched: number
  sales180RowsFetched: number
  sales365RowsFetched: number
  zohoCallCountApprox: number
  timingsMs: {
    items: number
    sales90: number
    sales180: number
    sales365: number
    processing: number
    total: number
  }
  mode: string
  compositeDetailLookups?: number
}

export interface FamilyMoneyFrozenRow {
  familyName: string
  totalInventoryValue: number
  deadStockValue: number
  hiddenSlowMovingValue: number
  numberOfRiskSkus: number
}

export interface InventoryHealthDashboard {
  summary: InventoryHealthSummary
  debug?: InventoryHealthDebug
  rows: InventoryHealthRow[]
  familyMoneyFrozen: FamilyMoneyFrozenRow[]
  warehouseId?: string | null
  asOfDate?: string
  refreshed?: boolean
}

export interface InventoryHealthQuery {
  warehouseId?: string
  familyType?: 'all' | 'slow_moving' | 'other'
  riskClass?: 'all' | 'healthy' | 'watch' | 'slow_moving' | 'dead_stock'
  hiddenOnly?: boolean
  minStockQty?: number
  minInventoryValue?: number
  salesWindowDays?: number
  includeZeroStock?: boolean
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  search?: string
  refresh?: boolean
  /** When true, attaches cached images for all rows (slow). Default: omit / false. */
  includeImages?: boolean
}

function buildQuery(params: InventoryHealthQuery = {}) {
  const qs = new URLSearchParams()
  if (params.warehouseId) qs.set('warehouseId', params.warehouseId)
  if (params.familyType && params.familyType !== 'all') qs.set('familyType', params.familyType)
  if (params.riskClass && params.riskClass !== 'all') qs.set('riskClass', params.riskClass)
  if (params.hiddenOnly) qs.set('hiddenOnly', '1')
  if (params.minStockQty != null) qs.set('minStockQty', String(params.minStockQty))
  if (params.minInventoryValue != null) qs.set('minInventoryValue', String(params.minInventoryValue))
  if (params.salesWindowDays != null) qs.set('salesWindowDays', String(params.salesWindowDays))
  if (params.includeZeroStock) qs.set('includeZeroStock', '1')
  if (params.sortBy) qs.set('sortBy', params.sortBy)
  if (params.sortDirection) qs.set('sortDirection', params.sortDirection)
  if (params.search) qs.set('search', params.search)
  if (params.refresh) qs.set('refresh', '1')
  if (params.includeImages) qs.set('includeImages', '1')
  return qs.toString()
}

const INVENTORY_HEALTH_TIMEOUT_MS = 300_000

export async function fetchInventoryHealth(params: InventoryHealthQuery = {}) {
  const q = buildQuery(params)
  const path = q ? `/api/zoho/inventory-health?${q}` : '/api/zoho/inventory-health'
  return api.get(path, { timeoutMs: INVENTORY_HEALTH_TIMEOUT_MS }) as Promise<InventoryHealthDashboard>
}

export async function refreshInventoryHealth(params: InventoryHealthQuery = {}) {
  const q = buildQuery({ ...params, refresh: true })
  const path = q ? `/api/zoho/inventory-health/refresh?${q}` : '/api/zoho/inventory-health/refresh'
  return api.post(path, {}, { timeoutMs: INVENTORY_HEALTH_TIMEOUT_MS }) as Promise<InventoryHealthDashboard>
}

export async function downloadInventoryHealthCsv(params: InventoryHealthQuery = {}) {
  const q = buildQuery(params)
  const path = q
    ? `/api/zoho/inventory-health/export.csv?${q}`
    : '/api/zoho/inventory-health/export.csv'
  const blob = await fetchBinary(path)
  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(blob, `inventory-health-${stamp}.csv`)
}

export function formatMonthsOfCover(value: number | null | undefined) {
  if (value == null) return '—'
  if (value >= 999) return '999+'
  return String(value)
}

export interface InventoryHealthImageCacheStatus {
  totalActiveItems: number | null
  cachedImages: number
  missingImages: number
  noImageInZoho?: number
  cacheCoveragePercent: number
  lastSyncAt: string | null
  sampleMissing: Array<{
    sku: string | null
    itemName: string | null
    itemId: string | null
    reason: string | null
  }>
}

export interface InventoryHealthImageSyncResult {
  success: boolean
  mode: string
  dryRun: boolean
  scannedItems: number
  alreadyCached: number
  missingBeforeSync: number
  attempted: number
  downloaded: number
  saved: number
  failed: number
  noImageInZoho?: number
  stillMissing: number
  skippedDueToLimit: number
  batchesRun?: number
  timedOut?: boolean
  rateLimitPaused?: boolean
  concurrency?: number
  errors: Array<{ itemId?: string; sku?: string; reason?: string; message?: string }>
  timingsMs: {
    items: number
    cacheLookup: number
    imageFetch: number
    save: number
    total: number
  }
}

export async function fetchInventoryHealthImageStatus() {
  return api.get('/api/zoho/inventory-health/images/status') as Promise<InventoryHealthImageCacheStatus>
}

export type InventoryHealthRowImageFields = Pick<
  InventoryHealthRow,
  'imageUrl' | 'imageMissing' | 'imageSource' | 'imageCachedAt'
>

export async function fetchInventoryHealthRowImages(itemIds: string[]) {
  const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 120)
  if (!ids.length) return {} as Record<string, InventoryHealthRowImageFields>
  const res = (await api.post('/api/zoho/inventory-health/images/batch', { itemIds: ids }, {
    timeoutMs: 30_000,
  })) as { images?: Record<string, InventoryHealthRowImageFields> }
  return res.images || {}
}

export interface InventoryHealthImageSyncJob {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  alreadyRunning?: boolean
  progress: {
    step: string
    saved: number
    failed: number
    noImageInZoho?: number
    attempted: number
    remaining: number
    alreadyCached: number
    scannedItems: number
  }
  startedAt: string
  completedAt: string | null
  error?: string | null
  result?: InventoryHealthImageSyncResult
}

export async function startInventoryHealthImageSync(opts?: {
  limit?: number
  concurrency?: number
  all?: boolean
}) {
  return api.post(
    '/api/zoho/inventory-health/images/sync',
    {
      async: true,
      force: false,
      all: opts?.all ?? false,
      limit: opts?.limit ?? 20,
      concurrency: opts?.concurrency ?? 1,
      dryRun: false,
    },
    { timeoutMs: 15_000 },
  ) as Promise<InventoryHealthImageSyncJob>
}

export async function fetchInventoryHealthImageSyncJob(jobId: string) {
  return api.get(`/api/zoho/inventory-health/images/sync/job/${encodeURIComponent(jobId)}`, {
    timeoutMs: 15_000,
  }) as Promise<InventoryHealthImageSyncJob>
}

export async function fetchActiveInventoryHealthImageSyncJob() {
  return api.get('/api/zoho/inventory-health/images/sync/active', {
    timeoutMs: 15_000,
  }) as Promise<{ job: InventoryHealthImageSyncJob | null }>
}

/** @deprecated Use startInventoryHealthImageSync + poll job status instead */
export async function syncMissingInventoryHealthImages(opts?: {
  limit?: number
  dryRun?: boolean
  all?: boolean
  concurrency?: number
  async?: boolean
}) {
  return api.post('/api/zoho/inventory-health/images/sync', {
    force: false,
    limit: opts?.limit ?? 200,
    dryRun: opts?.dryRun ?? false,
    all: opts?.all ?? true,
    concurrency: opts?.concurrency ?? 15,
    async: opts?.async ?? true,
  }) as Promise<InventoryHealthImageSyncResult | InventoryHealthImageSyncJob>
}

export async function syncOneInventoryHealthImage(body: { itemId?: string; sku?: string; force?: boolean }) {
  return api.post('/api/zoho/inventory-health/images/sync-one', body) as Promise<{
    success: boolean
    skipped?: boolean
    reason?: string
    row?: unknown
  }>
}
