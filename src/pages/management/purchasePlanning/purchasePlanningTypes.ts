/** Shapes returned by /api/purchase-planning and used across the Purchase Planning page. */

export type PlanStatus = 'draft' | 'reviewed' | 'sending' | 'sent_to_zoho' | 'failed'
export type LowStockStatus = 'pending' | 'planned' | 'ordered' | 'ignored'
export type MatchType = 'exact' | 'parent' | 'not_found'
export type BadgeTone = 'muted' | 'success' | 'warning' | 'danger'
export type StepId = 1 | 2 | 3 | 4 | 5 | 6
export type StepStatus = 'not_started' | 'ready' | 'in_progress' | 'completed' | 'blocked' | 'error'
export type PurchasePlanningViewMode = 'workflow' | 'draft_review' | 'sent_review' | 'history'

export interface PlanItem {
  id: number
  purchasePlanId?: number
  sku: string
  itemName: string
  zohoItemId: string | null
  zohoItemActive: boolean | null
  currentZohoStock: number
  vigilCode?: string
  wholesaleAvailableQty: number
  matchType: MatchType
  totalSalesLast3Months: number
  totalBundleUsageLast3Months: number
  totalUsageLast3Months: number
  averageMonthlyUsage?: number
  suggestedQty: number
  finalQty: number
  purchasePrice: number | null
  included: boolean
  notes: string
}

export type PlanItemPatch = Partial<Pick<PlanItem, 'finalQty' | 'included' | 'purchasePrice' | 'notes'>>

export interface PurchasePlan {
  id: number
  planNumber: string
  createdBy?: number | null
  createdAt: string
  updatedAt?: string
  status: PlanStatus
  zohoPurchaseOrderId: string | null
  purchaseOrderNumber: string | null
  zohoError: string | null
  sendStartedAt?: string | null
  sourceUploadId?: number | null
  items?: PlanItem[]
  itemsCount?: number
  includedCount?: number
  totalFinalQty?: number
  estimatedTotalValue?: number
}

export interface LowStockItem {
  id: number
  sku: string
  itemName: string
  zohoItemId: string | null
  zohoItemActive: boolean | null
  currentZohoStock: number
  totalSalesLast3Months: number
  totalBundleUsageLast3Months: number
  status: LowStockStatus
  vigilStock?: number
  wholesaleAvailableQty?: number
}

export interface VigilUpload {
  id: number
  fileName: string
  uploadedAt: string
  rowsCount: number
  validRows?: number
}

export interface EnrichmentSummary {
  refreshed: number
  matched: number
  unmatched: number
}

export interface EnrichmentStatus {
  running: boolean
  queuedAgain?: boolean
  status?: string | null
  progress?: string | null
  startedAt?: string | null
  attempts?: number
  lastError: string | null
  lastCompletedAt?: string | null
  lastSummary: EnrichmentSummary | null
}

export interface EnrichmentPollResult {
  running: boolean
  progress: string | null
  resumed: boolean
  lastError: string | null
  lastSummary: EnrichmentSummary | null
  items: LowStockItem[]
}

export interface PlanFilters {
  search: string
  matchStatus: '' | MatchType
  includedStatus: '' | 'included' | 'ignored'
  quick: '' | 'need-order' | 'missing-price' | 'no-wholesale' | 'composite-used'
  stockMin: string
  stockMax: string
  wholesaleMin: string
  wholesaleMax: string
  salesMin: string
  salesMax: string
  bundleMin: string
  bundleMax: string
  suggestedMin: string
  suggestedMax: string
  finalMin: string
  finalMax: string
}

export interface SortState {
  key: string
  direction: 'asc' | 'desc'
}

export interface StepDefinition {
  id: StepId
  key: string
  shortTitle: string
  title: string
  description: string
}

export interface RowBadge {
  key: string
  label: string
  tone: BadgeTone
}

export interface PlanReviewSummary {
  totalSkus: number
  includedCount: number
  excludedCount: number
  totalFinalQty: number
  estimatedValue: number
  missingPricesCount: number
  missingPrices: PlanItem[]
  inactiveCount: number
  inactiveItems: PlanItem[]
  cappedByVigilCount: number
}

export interface PoReadiness {
  ready: boolean
  reasons: string[]
  includedLines: PlanItem[]
  summary: PlanReviewSummary
}

export type StepStatuses = Record<StepId, StepStatus>
export type StepBlockers = Partial<Record<StepId, string>>

export interface Workflow {
  stepStatuses: StepStatuses
  suggestedStep: StepId
  blockers: StepBlockers
  pending: LowStockItem[]
  pendingWithZoho: LowStockItem[]
  pendingWithoutZoho: LowStockItem[]
  hasVigil: boolean
  hasPendingUpload: boolean
  hasDraft: boolean
  hasOpenPlan: boolean
  batchConsumed: boolean
  poReadiness: PoReadiness | null
}

export interface PurchasePlanningView {
  activeStep: StepId
  mode: PurchasePlanningViewMode
  selectedPlanId: number | null
  showLatestSentPanel: boolean
  reason: string
}

export interface UploadPreviewRow {
  rowNumber: number
  valid: boolean
  errors: string[]
  sku?: string
  itemCode?: string
  availableStock?: number
}

export interface UploadPreview {
  summary: {
    validRows: number
    invalidRows: number
    skuHeader?: string | null
    itemCodeHeader?: string | null
    stockHeader?: string | null
  }
  rows: UploadPreviewRow[]
}

export interface LowStockUploadResponse {
  saved: boolean
  preview: UploadPreview
  items?: LowStockItem[]
  enrichmentQueued?: boolean
  summary?: { uploaded?: number; matched?: number; unmatched?: number }
}

export interface CreatePoResponse {
  success: boolean
  reconciled?: boolean
  zohoPurchaseOrderId: string
  purchaseOrderNumber?: string
  sentLines: number
  skippedLines: number
}

/** Errors thrown by api/client carry the server code and JSON body. */
export interface ApiError extends Error {
  code?: string
  body?: {
    code?: string
    preview?: UploadPreview
    details?: { unmatchedCount?: number }
  }
}

export function asApiError(err: unknown): ApiError {
  return err instanceof Error ? (err as ApiError) : (new Error(String(err)) as ApiError)
}
