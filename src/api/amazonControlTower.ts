import { api } from './client'

const BASE = '/api/amazon/control-tower/ksa'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted'
export type FreshnessStatus = 'FRESH' | 'WARNING' | 'STALE' | 'NEVER_SYNCED' | 'ERROR'
export type MappingStatus = 'CONFIRMED' | 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'UNMAPPED'
export type ManualJobType =
  | 'refresh_all'
  | 'refresh_health'
  | 'listings'
  | 'listing_status'
  | 'sales'
  | 'rollup'
  | 'fba_inventory'
  | 'warehouse_stock'
  | 'inventory_reports'
  | 'removal_orders'
export type AmazonListingStatus = 'ACTIVE' | 'INACTIVE' | 'SUPPRESSED' | 'INCOMPLETE' | 'CLOSED' | 'UNKNOWN'
export type MappingIndicator = 'MAPPED' | 'UNMAPPED' | 'AMBIGUOUS'

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
  healthAgedMinDays: number
  healthExcessCoverDays: number
  healthLowCoverDays: number
  healthSlowUnitsPer30d: number
  healthVeryLowUnitsPer30d: number
  removalStuckDays: number
  capacityWarnPct: number
  capacityHighPct: number
  capacityCriticalPct: number
  usageCoverageMinPct: number
  createdAt: string | null
  updatedAt: string | null
}

export interface StockRow {
  id: number
  sellerSku: string
  asin: string | null
  title: string | null
  listingStatus: AmazonListingStatus | null
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
    activeSkus: number | null
    activeFbaSkus: number | null
    activeMfnSkus: number | null
    activeAmazonStockUnits: number | null
    fbaFulfillableUnits: number | null
    inboundUnits: number | null
    reservedUnits: number | null
    unfulfillableUnits: number | null
    outOfStockSkus: number | null
    lowStockSkus: number | null
    unmappedSkus: number | null
    activeSkusWithoutFbaData: number | null
    inactiveSkusWithFbaStock: number | null
    unitsInInactiveSkus: number | null
    estimatedCapacityWastedByInactive: {
      volumeCm3: number
      coveragePct: number | null
      source: 'CALCULATED'
      confidence: 'ESTIMATE'
      asOf: string | null
    } | null
  }
  listingStatus: {
    known: boolean
    operationalBasis: 'AMAZON_LISTING_STATUS_ACTIVE' | 'LISTING_STATUS_NOT_REFRESHED'
    refreshedAt: string | null
    statusCounts: Record<string, number> | null
    source: string
    error: string | null
  }
  physicalAllListings: {
    note: string
    fulfillable: number | null
    inbound: number | null
    reserved: number | null
    unfulfillable: number | null
  } | null
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
  amazonListingStatus: AmazonListingStatus | null
  amazonListingStatusRaw: string | null
  amazonListingStatusReason: string | null
  amazonListingStatusAt: string | null
  searchSuppressed: boolean | null
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
  Pick<
    MarketplaceSettings,
    | 'lowStockUnitsThreshold'
    | 'targetCoverDays'
    | 'maxCoverDays'
    | 'defaultLeadTimeDays'
    | 'defaultCartonQuantity'
    | 'vatRate'
    | 'healthAgedMinDays'
    | 'healthExcessCoverDays'
    | 'healthLowCoverDays'
    | 'healthSlowUnitsPer30d'
    | 'healthVeryLowUnitsPer30d'
    | 'removalStuckDays'
    | 'capacityWarnPct'
    | 'capacityHighPct'
    | 'capacityCriticalPct'
    | 'usageCoverageMinPct'
  >
>

// ---------- capacity ----------

export type StorageType = 'ALL' | 'STANDARD' | 'OVERSIZE' | 'APPAREL' | 'FOOTWEAR' | 'OTHER'
export type CapacityUnit = 'CUBIC_FEET' | 'CUBIC_METERS' | 'UNITS' | 'OTHER'
export type CapacitySource = 'AMAZON_API' | 'SELLER_CENTRAL_MANUAL' | 'CALCULATED' | 'IMPORT'
export type Confidence = 'OFFICIAL' | 'AMAZON_REPORTED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'ESTIMATE'

export interface CapacityPeriod {
  id: number
  marketplaceKey: string
  periodStart: string
  periodEnd: string
  storageType: StorageType
  storageTypeLabel: string | null
  capacityLimit: number | null
  capacityUnit: CapacityUnit
  capacityUnitLabel: string | null
  amazonReportedUsage: number | null
  calculatedUsage: number | null
  inboundUsage: number | null
  committedUsage: number | null
  availableCapacity: number | null
  calculationSnapshotId: number | null
  source: CapacitySource
  sourceReference: string | null
  enteredBy: string | null
  enteredAt: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  notes: string | null
  supersedesId: number | null
  supersededById: number | null
  supersededAt: string | null
}

export interface CapacityPeriodInput {
  periodStart: string
  periodEnd: string
  storageType: StorageType
  storageTypeLabel?: string | null
  capacityLimit: number
  capacityUnit: CapacityUnit
  capacityUnitLabel?: string | null
  amazonReportedUsage?: number | null
  source: 'SELLER_CENTRAL_MANUAL' | 'IMPORT'
  sourceReference?: string | null
  notes?: string | null
}

export interface CapacityEvent {
  id: number
  periodId: number
  previousPeriodId: number | null
  action: 'CREATED' | 'REVISED' | 'VERIFIED'
  changes: Record<string, unknown>
  actor: string | null
  createdAt: string | null
}

export interface OfficialFigure {
  value: number | null
  status: string
  source: string | null
  asOf: string | null
  confidence: Confidence
}

export interface CalculatedFigure {
  value: number | null
  status: 'ESTIMATE' | 'NO_USAGE_FOR_STORAGE_TYPE' | 'UNIT_NOT_COMPARABLE'
  source: 'CALCULATED'
  asOf: string | null
  confidence: Confidence
  coveragePct: number | null
  isLowerBound: boolean
}

export interface NotCalculated {
  status: 'NOT_CALCULATED_YET'
  reason: string
}

export interface CapacityKpi {
  storageType: StorageType
  period: CapacityPeriod | null
  periodId: number | null
  unit: CapacityUnit | null
  officialCapacity: OfficialFigure
  used: { official: OfficialFigure | null; calculated: CalculatedFigure } | null
  inboundCommitted: { calculated: CalculatedFigure } | null
  available: { official: OfficialFigure | null; calculated: CalculatedFigure } | null
  utilizationPct: { official: OfficialFigure | null; calculated: CalculatedFigure } | null
  requiredByHealthyReplenishment: NotCalculated
  shortfall: NotCalculated
}

export interface UsageTally {
  units: number
  unitsWithVolume: number
  volumeCm3: number
  coveragePct: number | null
  isLowerBound: boolean
}

export interface CapacityHistoryRow extends CapacityPeriod {
  calculatedUsageInPeriod: number | null
  calculatedAt: string | null
  calculatedCoveragePct: number | null
  officialAvailable: number | null
  calculatedAvailable: number | null
  officialUtilizationPct: number | null
  calculatedUtilizationPct: number | null
}

export interface UsageSnapshot {
  id: number
  computedAt: string
  inventorySnapshotAt: string | null
  onHandUnits: number
  onHandUnitsWithVolume: number
  onHandVolumeCm3: number
  inboundWorkingVolumeCm3: number
  inboundShippedVolumeCm3: number
  inboundReceivingVolumeCm3: number
  coveragePct: number | null
  amazonPlanningStorageVolumeM3: number | null
}

export interface CapacityResponse {
  marketplaceKey: string
  today: string
  inventorySnapshotAt: string | null
  listingStatusRefreshedAt: string | null
  thresholds: { warnPct: number; highPct: number; criticalPct: number; coverageMinPct: number }
  officialCapacityApi: { status: string; note: string }
  currentPeriods: CapacityPeriod[]
  kpis: CapacityKpi[]
  usage: {
    source: 'CALCULATED'
    asOf: string | null
    onHand: UsageTally
    inbound: UsageTally
    total: UsageTally
    buckets: Record<string, UsageTally>
    byListingClass: Record<'ACTIVE' | 'INACTIVE' | 'UNFULFILLABLE' | 'OTHER_UNKNOWN', UsageTally>
    byStorageType: Record<string, { onHand: UsageTally; inbound: UsageTally }>
    coveragePct: number | null
    volumeSources: Record<string, number>
    missingVolume: { sellerSku: string; title: string | null; onHandUnits: number; inboundUnits: number; listingClass: string }[]
  }
  amazonPlanningStorageVolume: {
    volumeCm3: number
    skuCount: number
    source: 'AMAZON_REPORT'
    sourceLabel: string
    asOf: string | null
    confidence: 'AMAZON_REPORTED'
    note: string
  } | null
  volumeSourcePriority: { source: string; label: string }[]
  storageTypesWithStock: string[]
  formula: string
  history: CapacityHistoryRow[]
  usageHistory: UsageSnapshot[]
  events: CapacityEvent[]
}

// ---------- inventory health ----------

export type HealthFilter = 'active' | 'inactive_with_stock' | 'suppressed' | 'all'
export type HealthStatus = 'HEALTHY' | 'WATCH' | 'SLOW' | 'EXCESS' | 'AGED' | 'ZERO_SALES' | 'OUT_ZERO_FBA' | 'DATA_INCOMPLETE'

export interface HealthRow {
  id: number
  sellerSku: string
  asin: string | null
  fnsku: string | null
  title: string | null
  fulfillmentChannel: string | null
  listingStatus: AmazonListingStatus | null
  listingStatusRaw: string | null
  listingStatusReason: string | null
  searchSuppressed: boolean | null
  fulfillable: number | null
  reserved: number | null
  inbound: number | null
  unfulfillable: number | null
  researching: number | null
  units7d: number | null
  units30d: number | null
  units90d: number | null
  sales30Source: string | null
  sales90Source: string | null
  velocity7d: number | null
  velocity30d: number | null
  daysOfCover: number | null
  oldestAgeBucket: string | null
  agedUnits: number | null
  ageSnapshotDate: string | null
  lastSaleDate: string | null
  warehouseAvailable: number | null
  mappingStatus: MappingStatus
  mappingIndicator: MappingIndicator
  physicalFbaUnits: number
  unitVolumeCm3: number | null
  volumeSource: string | null
  storageType: string | null
  capacityUsedCm3: number | null
  healthStatus: HealthStatus
  healthReason: string
  flags: string[]
  recommendedAction: string
  amazonRecommendedAction: string | null
  margin: null
  replenishment: { eligible: boolean; reason: string }
}

export interface InventoryHealthResponse {
  marketplaceKey: string
  filter: HealthFilter
  today: string
  thresholds: Record<string, number>
  healthCounts: Record<HealthStatus, number>
  listingStatusCounts: Record<string, number>
  listingStatusRefreshedAt: string | null
  inventorySnapshotAt: string | null
  salesHistoryDays: number
  salesHistoryNote: string | null
  marginNote: string
  total: number
  rows: HealthRow[]
}

export interface InactiveWithStockResponse {
  marketplaceKey: string
  listingStatusRefreshedAt: string | null
  inventorySnapshotAt: string | null
  summary: { skus: number; units: number; estimatedCapacityCm3: number | null; coveragePct: number | null; source: 'CALCULATED'; confidence: 'ESTIMATE' }
  rows: (HealthRow & { inferredReason: string | null })[]
}

export interface ReleaseRow {
  primaryReason: string
  reasons: { reason: string; quantity: number; detail: string }[]
  priority: 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM'
  potentialRemovalQty: number
  capacityPerUnitCm3: number | null
  potentialCapacityReleasedCm3: number | null
  volumeStatus: 'OK' | 'VOLUME_DATA_MISSING'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  sellerSku: string
  asin: string | null
  title: string | null
  listingStatus: AmazonListingStatus | null
  fbaUnits: number
  units30d: number | null
  units90d: number | null
  sales90Source: string | null
  daysOfCover: number | null
  oldestAgeBucket: string | null
  volumeSource: string | null
  mappingIndicator: MappingIndicator
}

export interface CapacityReleaseResponse {
  marketplaceKey: string
  inventorySnapshotAt: string | null
  note: string
  summary: {
    opportunities: number
    potentialRemovalQty: number
    potentialCapacityReleasedCm3: number | null
    volumeMissing: number
    source: 'CALCULATED'
    confidence: 'ESTIMATE'
  }
  rows: ReleaseRow[]
}

export type RemovalStatusFilter = 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'ALL'

export interface RemovalItem {
  id: number
  removalOrderId: string
  requestDate: string | null
  lastUpdatedAt: string | null
  sellerSku: string
  fnsku: string | null
  asin: string | null
  title: string | null
  disposition: string | null
  orderType: string | null
  orderSource: string | null
  orderStatus: string | null
  statusGroup: 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN'
  orderStatusGroup: string
  requestedQuantity: number | null
  shippedQuantity: number | null
  cancelledQuantity: number | null
  disposedQuantity: number | null
  inProcessQuantity: number | null
  completedQuantity: number | null
  removalFee: number | null
  currency: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export interface RemovalOrdersResponse {
  marketplaceKey: string
  status: RemovalStatusFilter
  counts: Record<'OPEN' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN', number>
  source: string
  completedFormula: string
  rows: RemovalItem[]
}

export interface ControlTowerAction {
  id: number
  actionKey: string
  actionType: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  detail: string | null
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown>
  status: 'OPEN' | 'RESOLVED'
  firstSeenAt: string | null
  lastSeenAt: string | null
  resolvedAt: string | null
}

export interface ActionsResponse {
  marketplaceKey: string
  status: 'OPEN' | 'RESOLVED' | 'ALL'
  actions: ControlTowerAction[]
}

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

export function getKsaCapacity(): Promise<CapacityResponse> {
  return api.get(`${BASE}/capacity`)
}

export async function createKsaCapacityPeriod(input: CapacityPeriodInput): Promise<CapacityPeriod> {
  const res: { period: CapacityPeriod } = await api.post(`${BASE}/capacity/periods`, input)
  return res.period
}

export async function reviseKsaCapacityPeriod(id: number, patch: Partial<CapacityPeriodInput>): Promise<CapacityPeriod> {
  const res: { period: CapacityPeriod } = await api.put(`${BASE}/capacity/periods/${id}`, patch)
  return res.period
}

export async function verifyKsaCapacityPeriod(id: number): Promise<CapacityPeriod> {
  const res: { period: CapacityPeriod } = await api.post(`${BASE}/capacity/periods/${id}/verify`, {})
  return res.period
}

export function getKsaInventoryHealth(params: { filter?: HealthFilter; healthStatus?: HealthStatus | ''; search?: string; limit?: number } = {}): Promise<InventoryHealthResponse> {
  const qs = new URLSearchParams()
  if (params.filter) qs.set('filter', params.filter)
  if (params.healthStatus) qs.set('healthStatus', params.healthStatus)
  if (params.search) qs.set('search', params.search)
  if (params.limit) qs.set('limit', String(params.limit))
  return api.get(`${BASE}/inventory-health?${qs.toString()}`)
}

export function getKsaInactiveWithStock(): Promise<InactiveWithStockResponse> {
  return api.get(`${BASE}/inventory-health/inactive-with-stock`)
}

export function getKsaCapacityRelease(): Promise<CapacityReleaseResponse> {
  return api.get(`${BASE}/capacity-release`)
}

export function getKsaRemovalOrders(status: RemovalStatusFilter = 'OPEN'): Promise<RemovalOrdersResponse> {
  return api.get(`${BASE}/removal-orders?status=${status}`)
}

export function getKsaActions(status: 'OPEN' | 'RESOLVED' | 'ALL' = 'OPEN'): Promise<ActionsResponse> {
  return api.get(`${BASE}/actions?status=${status}`)
}

export const isTerminalRunStatus = (status: RunStatus) => !['queued', 'running'].includes(status)
