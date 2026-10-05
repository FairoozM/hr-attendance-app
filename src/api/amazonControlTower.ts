import { api } from './client'

const BASE = '/api/amazon/control-tower/ksa'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted'
export type FreshnessStatus = 'FRESH' | 'WARNING' | 'STALE' | 'NEVER_SYNCED' | 'ERROR'
export type MappingStatus = 'CONFIRMED' | 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'UNMAPPED'
export type ManualJobType = 'refresh_all' | 'listings' | 'sales' | 'rollup' | 'fba_inventory' | 'warehouse_stock'

export interface RefreshStep {
  key: string
  label: string
  runId: string | null
  status: RunStatus
  error: string | null
  recordsProcessed: number
  startedAt: string | null
  finishedAt: string | null
}

export interface RefreshRun {
  id: string
  marketplaceKey: string
  jobType: string
  triggerSource: string
  parentRunId: string | null
  status: RunStatus
  currentStep: string | null
  progressCurrent: number
  progressTotal: number
  recordsProcessed: number
  errorMessage: string | null
  metadata: { steps?: RefreshStep[]; [key: string]: unknown }
  requestedBy: string | null
  queuedAt: string
  startedAt: string | null
  heartbeatAt: string | null
  finishedAt: string | null
  durationMs: number | null
  children?: RefreshRun[]
}

export interface StartRunResponse {
  runIds: string[]
  status: RunStatus
  alreadyRunning: boolean
  jobType: string
}

export interface FreshnessSource {
  key: string
  label: string
  jobType: string
  status: FreshnessStatus
  lastSuccessAt: string | null
  ageMs: number | null
  lastError: string | null
  warnAfterMs: number
  staleAfterMs: number
  currentRun: { id: string; status: RunStatus; currentStep: string | null; startedAt: string | null; queuedAt: string } | null
}

export interface FreshnessResponse {
  marketplaceKey: string
  generatedAt: string
  sources: FreshnessSource[]
}

export interface MarketplaceSettings {
  marketplaceKey: string
  timezone: string
  vatRate: number
  lowStockUnitsThreshold: number
  targetCoverDays: number
  maxCoverDays: number
  defaultLeadTimeDays: number
  defaultCartonQuantity: number | null
  schedulerEnabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface StockRow {
  id: number
  sellerSku: string
  asin: string | null
  title: string | null
  fbaFulfillable: number | null
  inbound: number | null
  warehouseAvailable: number | null
  mappingStatus: MappingStatus
  units7d: number
  units30d: number
}

export interface UnmappedRow {
  id: number
  sellerSku: string
  asin: string | null
  title: string | null
  potentialMatch: { zohoItemId: string; itemCode: string | null; itemName: string | null; method: string } | null
  candidateCount: number
  confidence: number | null
  mappingStatus: MappingStatus
  units30d: number
}

export interface CommandCenterResponse {
  marketplaceKey: string
  currency: string
  timezone: string
  today: string
  generatedAt: string
  settings: MarketplaceSettings
  salesBasis: string
  salesProvisional: boolean
  salesCaveat: string
  inventorySource: {
    source: string
    fulfillmentModel: 'UNVERIFIED' | 'FBA' | 'SELLER_FLEX' | 'MIXED'
    caveat: string
  }
  kpis: {
    todaySales: number | null
    yesterdaySales: number | null
    last7DaysSales: number | null
    last30DaysSales: number | null
    unitsSold30d: number | null
    activeSkus: number
    fbaFulfillableUnits: number | null
    inboundUnits: number | null
    reservedUnits: number | null
    unfulfillableUnits: number | null
    outOfStockSkus: number | null
    lowStockSkus: number | null
    unmappedSkus: number
    activeSkusWithoutFbaData: number | null
  }
  tables: {
    outOfStock: { total: number; rows: StockRow[] }
    lowStock: { total: number; threshold: number; rows: StockRow[] }
    unmapped: { total: number; rows: UnmappedRow[] }
  }
  snapshots: { inventorySnapshotAt: string | null; warehouseSnapshotAt: string | null }
  coverage: {
    orderLines: { firstPurchaseAt: string | null; lastPurchaseAt: string | null; lineCount: number }
    dailySales: { firstDate: string | null; lastDate: string | null; daysWithSales: number }
  }
  freshness: FreshnessResponse
}

export interface MappingCandidate {
  zohoItemId: string
  itemCode: string | null
  itemName: string | null
  method: string
  confidence?: number
}

export interface SkuMasterRow {
  id: number
  marketplaceKey: string
  sellerSku: string
  normalizedSku: string | null
  asin: string | null
  fnsku: string | null
  amazonTitle: string | null
  fulfillmentChannel: string | null
  listingStatus: string | null
  zohoItemId: string | null
  zohoItemCode: string | null
  zohoItemName: string | null
  mappingStatus: MappingStatus
  mappingMethod: string | null
  mappingConfidence: number | null
  mappingCandidates: MappingCandidate[]
  confirmedBy: string | null
  confirmedAt: string | null
  packMultiplier: number | null
  cartonQuantity: number | null
  active: boolean
  lastSeenInListingsAt: string | null
  lastSeenInInventoryAt: string | null
  updatedAt: string | null
}

export interface SkuMasterList {
  rows: SkuMasterRow[]
  total: number
  statusCounts: Record<MappingStatus, number>
}

export interface ZohoItemOption {
  zohoItemId: string
  itemCode: string | null
  itemName: string | null
  onHand: number | null
  availableForSale: number | null
  committedStock: number | null
}

export interface RefreshSchedule {
  id: number
  jobType: string
  intervalMinutes: number
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
}

export interface SettingsResponse {
  settings: MarketplaceSettings
  schedules: RefreshSchedule[]
  schedulerEnvEnabled: boolean
}

export type SettingsPatch = Partial<
  Pick<MarketplaceSettings, 'lowStockUnitsThreshold' | 'targetCoverDays' | 'maxCoverDays' | 'defaultLeadTimeDays' | 'defaultCartonQuantity' | 'vatRate'>
>

export function startKsaRefresh(jobType: ManualJobType = 'refresh_all'): Promise<StartRunResponse> {
  return api.post(`${BASE}/refresh`, { jobType })
}

export function startKsaSalesBackfill(days: number): Promise<StartRunResponse> {
  return api.post(`${BASE}/backfill`, { days })
}

export async function getKsaRun(id: string): Promise<RefreshRun> {
  const res: { run: RefreshRun } = await api.get(`${BASE}/runs/${encodeURIComponent(id)}`)
  return res.run
}

export async function listKsaRuns(limit = 20): Promise<RefreshRun[]> {
  const res: { runs: RefreshRun[] } = await api.get(`${BASE}/runs?limit=${limit}`)
  return res.runs
}

export function getKsaFreshness(): Promise<FreshnessResponse> {
  return api.get(`${BASE}/freshness`)
}

export function getKsaCommandCenter(): Promise<CommandCenterResponse> {
  return api.get(`${BASE}/command-center`)
}

export function listKsaSkuMaster(params: { status?: MappingStatus | ''; search?: string; activeOnly?: boolean; limit?: number; offset?: number }): Promise<SkuMasterList> {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.search) qs.set('search', params.search)
  if (params.activeOnly) qs.set('activeOnly', '1')
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  return api.get(`${BASE}/sku-master?${qs.toString()}`)
}

export async function confirmKsaSku(id: number, zohoItemId?: string): Promise<SkuMasterRow> {
  const res: { sku: SkuMasterRow } = await api.post(`${BASE}/sku-master/${id}/confirm`, zohoItemId ? { zohoItemId } : {})
  return res.sku
}

export async function changeKsaSkuMapping(id: number, zohoItemId: string): Promise<SkuMasterRow> {
  const res: { sku: SkuMasterRow } = await api.put(`${BASE}/sku-master/${id}/mapping`, { zohoItemId })
  return res.sku
}

export async function unmapKsaSku(id: number): Promise<SkuMasterRow> {
  const res: { sku: SkuMasterRow } = await api.post(`${BASE}/sku-master/${id}/unmap`, {})
  return res.sku
}

export async function updateKsaSkuParameters(id: number, patch: { packMultiplier?: number; cartonQuantity?: number | null }): Promise<SkuMasterRow> {
  const res: { sku: SkuMasterRow } = await api.put(`${BASE}/sku-master/${id}/parameters`, patch)
  return res.sku
}

export async function searchKsaZohoItems(search: string): Promise<ZohoItemOption[]> {
  const res: { items: ZohoItemOption[] } = await api.get(`${BASE}/zoho-items?search=${encodeURIComponent(search)}`)
  return res.items
}

export function getKsaSettings(): Promise<SettingsResponse> {
  return api.get(`${BASE}/settings`)
}

export async function updateKsaSettings(patch: SettingsPatch): Promise<MarketplaceSettings> {
  const res: { settings: MarketplaceSettings } = await api.put(`${BASE}/settings`, patch)
  return res.settings
}

export const isTerminalRunStatus = (status: RunStatus) => !['queued', 'running'].includes(status)
