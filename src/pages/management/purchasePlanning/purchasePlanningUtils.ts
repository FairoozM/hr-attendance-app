import { api, PURCHASE_PLANNING_TIMEOUT_MS } from '../../../api/client'
import { resolveAllPricesRowsFromBundle } from '../allPricesEcommerceUtils'
import { getAllPricesPrefsScope } from '../allPricesMarketScope'
import type {
  BadgeTone,
  EnrichmentPollResult,
  EnrichmentStatus,
  LowStockItem,
  PlanFilters,
  PlanItem,
  PlanReviewSummary,
  PlanStatus,
  PoReadiness,
  PurchasePlan,
  PurchasePlanningView,
  RowBadge,
  SortState,
  StepBlockers,
  StepDefinition,
  StepId,
  StepStatus,
  VigilUpload,
  Workflow,
} from './purchasePlanningTypes'

export const PP_REQUEST_OPTS = { timeoutMs: PURCHASE_PLANNING_TIMEOUT_MS }

export const EMPTY_FILTERS: PlanFilters = {
  search: '',
  matchStatus: '',
  includedStatus: '',
  quick: '',
  stockMin: '',
  stockMax: '',
  wholesaleMin: '',
  wholesaleMax: '',
  salesMin: '',
  salesMax: '',
  bundleMin: '',
  bundleMax: '',
  suggestedMin: '',
  suggestedMax: '',
  finalMin: '',
  finalMax: '',
}

export const PP_STEPS: StepDefinition[] = [
  {
    id: 1,
    key: 'vigil',
    shortTitle: 'Vigil',
    title: 'Upload Vigil Stock',
    description: 'Upload wholesale availability (item code + available quantity). Required before generating a plan.',
  },
  {
    id: 2,
    key: 'lowStock',
    shortTitle: 'Low stock',
    title: 'Upload Low Stock SKUs',
    description: 'Upload the team’s low-stock SKU list. Saving creates pending rows for Zoho enrichment.',
  },
  {
    id: 3,
    key: 'enrich',
    shortTitle: 'Zoho',
    title: 'Match & Enrich from Zoho',
    description: 'Life Smile warehouse stock, 3-month sales, and bundle usage from Zoho Inventory.',
  },
  {
    id: 4,
    key: 'generate',
    shortTitle: 'Draft',
    title: 'Generate Draft Plan',
    description: 'Build a draft purchase plan from pending SKUs, Vigil caps, and usage calculations.',
  },
  {
    id: 5,
    key: 'review',
    shortTitle: 'Review',
    title: 'Review Quantities & Prices',
    description: 'Adjust final quantities, include or exclude lines, and verify All Prices purchase costs.',
  },
  {
    id: 6,
    key: 'po',
    shortTitle: 'Send PO',
    title: 'Create Zoho PO',
    description: 'Confirm totals and send a draft purchase order to Zoho Inventory.',
  },
]

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  not_started: 'Not started',
  ready: 'Ready',
  in_progress: 'In progress',
  completed: 'Done',
  blocked: 'Locked',
  error: 'Needs attention',
}

export const STEP_STATUS_TONES: Record<StepStatus, BadgeTone> = {
  not_started: 'muted',
  ready: 'warning',
  in_progress: 'warning',
  completed: 'success',
  blocked: 'danger',
  error: 'danger',
}

export function ignoreCancelledPurchasePlanningRequest(err: unknown, signal: AbortSignal | null | undefined): boolean {
  return Boolean(signal?.aborted && (err as { code?: string } | null)?.code !== 'REQUEST_TIMEOUT')
}

export function fmt(n: number | string | null | undefined): string {
  const value = Number(n || 0)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function fmtPrice(n: number | string | null | undefined): string {
  const value = Number(n)
  if (!Number.isFinite(value) || value <= 0) return '-'
  return value.toFixed(2)
}

function hasPositivePrice(value: number | null | undefined): boolean {
  const price = Number(value)
  return Number.isFinite(price) && price > 0
}

function hasZohoItem(item: { zohoItemId?: string | null }): boolean {
  return String(item.zohoItemId || '').trim() !== ''
}

export function normalizePriceLookupKey(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[_/]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

interface AllPricesRow {
  itemNo?: string
  purchasePrice?: number | string | null
}

export function buildPurchasePriceLookup(priceRows: AllPricesRow[] | null | undefined): Map<string, number> {
  const lookup = new Map<string, number>()
  for (const row of Array.isArray(priceRows) ? priceRows : []) {
    const key = normalizePriceLookupKey(row.itemNo)
    const price = Number(row.purchasePrice)
    if (!key || !Number.isFinite(price) || price <= 0) continue
    lookup.set(key, price)
  }
  return lookup
}

export function findPurchasePriceForItem(item: PlanItem, lookup: Map<string, number>): number | null {
  const candidates = [item.sku, item.vigilCode, item.itemName]
  for (const candidate of candidates) {
    const key = normalizePriceLookupKey(candidate)
    if (key && lookup.has(key)) return lookup.get(key) ?? null
  }
  return hasPositivePrice(item.purchasePrice) ? Number(item.purchasePrice) : null
}

export function enrichPlanWithPurchasePrices(
  plan: PurchasePlan | null,
  priceRows: AllPricesRow[]
): PurchasePlan | null {
  if (!plan) return plan
  const lookup = buildPurchasePriceLookup(priceRows)
  return {
    ...plan,
    items: (plan.items || []).map((item) => ({
      ...item,
      purchasePrice: findPurchasePriceForItem(item, lookup),
    })),
  }
}

export function resolveAllPriceRows(
  getPref: (key: string, fallback: unknown) => unknown,
  prefsReady: boolean,
  prefsVersion: unknown
): AllPricesRow[] {
  void prefsVersion
  if (!prefsReady) return []
  const bundle = getPref(getAllPricesPrefsScope().ec, null)
  return (resolveAllPricesRowsFromBundle(bundle) as AllPricesRow[] | null) || []
}

export function getStockRemark(item: Pick<PlanItem, 'currentZohoStock'> & { vigilStock?: number; wholesaleAvailableQty?: number }): string {
  const vigilStock = Number(item.vigilStock ?? item.wholesaleAvailableQty ?? 0)
  const zohoStock = Number(item.currentZohoStock || 0)
  return vigilStock <= 0 && zohoStock <= 3 ? 'Out of stock' : ''
}

export function includesAnyText(values: unknown[], filter: string): boolean {
  const needle = String(filter || '').trim().toLowerCase()
  if (!needle) return true
  return values.some((value) => String(value || '').toLowerCase().includes(needle))
}

export function inNumberRange(value: number | null | undefined, min: string, max: string): boolean {
  const n = Number(value || 0)
  const minValue = String(min || '').trim() === '' ? null : Number(min)
  const maxValue = String(max || '').trim() === '' ? null : Number(max)
  if (minValue != null && Number.isFinite(minValue) && n < minValue) return false
  if (maxValue != null && Number.isFinite(maxValue) && n > maxValue) return false
  return true
}

export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: 'asc' }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

export function compareSortValues(a: unknown, b: unknown): number {
  const aNumber = typeof a === 'number' ? a : Number.NaN
  const bNumber = typeof b === 'number' ? b : Number.NaN
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (row: T) => unknown>): T[] {
  const accessor = accessors[sort.key]
  if (!accessor) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => compareSortValues(accessor(a), accessor(b)) * direction)
}

export function getPendingLowStock(lowStock: LowStockItem[] | null | undefined): LowStockItem[] {
  return (lowStock || []).filter((item) => item.status === 'pending')
}

export function getLatestVigilUpload(uploads: VigilUpload[] | null | undefined): VigilUpload | null {
  return uploads && uploads.length > 0 ? uploads[0] : null
}

export function isEditablePlanStatus(status: PlanStatus | null | undefined): boolean {
  return status === 'draft' || status === 'failed'
}

/** Not yet in Zoho: editable drafts/failed sends, plus a send that is in flight. */
export function isOpenPlanStatus(status: PlanStatus | null | undefined): boolean {
  return isEditablePlanStatus(status) || status === 'sending'
}

/** Matches the server: a send older than this is treated as interrupted and may be finished. */
export const PO_SEND_STALE_MS = 10 * 60 * 1000

export function isPlanSendStale(plan: Pick<PurchasePlan, 'status' | 'sendStartedAt'> | null | undefined, now = Date.now()): boolean {
  if (plan?.status !== 'sending') return false
  const started = plan.sendStartedAt ? new Date(plan.sendStartedAt).getTime() : Number.NaN
  return !Number.isFinite(started) || now - started >= PO_SEND_STALE_MS
}

export function getLatestSentPlan(plans: PurchasePlan[] | null | undefined): PurchasePlan | null {
  return (plans || []).find((p) => p.status === 'sent_to_zoho') || null
}

function planCreatedMs(plan: Pick<PurchasePlan, 'createdAt'>): number {
  const ms = plan.createdAt ? new Date(plan.createdAt).getTime() : Number.NaN
  return Number.isFinite(ms) ? ms : Number.NaN
}

/**
 * A draft or failed plan created before the latest sent PO was abandoned: it is still listed
 * in Recent plans but never treated as the current plan. In-flight sends always stay current.
 */
export function isLeftoverPlan(plan: PurchasePlan, plans: PurchasePlan[] | null | undefined): boolean {
  if (!isEditablePlanStatus(plan.status)) return false
  const list = plans || []
  const latestSent = getLatestSentPlan(list)
  if (!latestSent) return false
  const planMs = planCreatedMs(plan)
  const sentMs = planCreatedMs(latestSent)
  if (Number.isFinite(planMs) && Number.isFinite(sentMs)) return planMs < sentMs
  return list.indexOf(plan) > list.indexOf(latestSent)
}

/**
 * Vigil stock is uploaded fresh for every purchase cycle: the latest upload only counts if it was
 * made after the last PO was sent to Zoho (sent plans are locked, so `updatedAt` is the send time).
 */
export function getCurrentVigilUpload(
  uploads: VigilUpload[] | null | undefined,
  plans: PurchasePlan[] | null | undefined
): VigilUpload | null {
  const latest = getLatestVigilUpload(uploads)
  if (!latest) return null
  const lastSent = (plans || [])
    .filter((p) => p.status === 'sent_to_zoho')
    .map((p) => new Date(p.updatedAt || p.createdAt).getTime())
    .filter(Number.isFinite)
  if (lastSent.length === 0) return latest
  const uploadedMs = new Date(latest.uploadedAt).getTime()
  return Number.isFinite(uploadedMs) && uploadedMs > Math.max(...lastSent) ? latest : null
}

/** Newest current plan that has not reached Zoho yet (draft, failed send, or send in flight); skips leftovers. */
export function getLatestOpenPlan(plans: PurchasePlan[] | null | undefined): PurchasePlan | null {
  return (plans || []).find((p) => isOpenPlanStatus(p.status) && !isLeftoverPlan(p, plans)) || null
}

interface ViewContext {
  uploads?: VigilUpload[]
  lowStock?: LowStockItem[]
  enrichmentRunning?: boolean
  enrichmentError?: string | null
  plans?: PurchasePlan[]
  selectedPlan?: PurchasePlan | null
}

const OPEN_PLAN_REASONS: Partial<Record<PlanStatus, string>> = {
  failed: 'Last Zoho send failed and can be retried',
  sending: 'Purchase order send in progress',
}

export function getDefaultPurchasePlanningView(ctx: ViewContext): PurchasePlanningView {
  const {
    uploads = [],
    lowStock = [],
    enrichmentRunning = false,
    enrichmentError = null,
    plans = [],
    selectedPlan = null,
  } = ctx

  const pending = getPendingLowStock(lowStock)
  const pendingWithoutZoho = pending.filter((item) => !hasZohoItem(item))
  const enrichmentActive = Boolean(enrichmentRunning && pending.length > 0)
  const hasVigil = Boolean(getCurrentVigilUpload(uploads, plans))
  const latestOpen = getLatestOpenPlan(plans)
  const latestSent = getLatestSentPlan(plans)

  if (selectedPlan?.id) {
    if (selectedPlan.status === 'sending') {
      return {
        activeStep: 6,
        mode: 'draft_review',
        selectedPlanId: selectedPlan.id,
        showLatestSentPanel: false,
        reason: 'Purchase order send in progress',
      }
    }
    if (isEditablePlanStatus(selectedPlan.status)) {
      return {
        activeStep: 5,
        mode: 'draft_review',
        selectedPlanId: selectedPlan.id,
        showLatestSentPanel: false,
        reason: 'Restoring open draft plan',
      }
    }
    if (selectedPlan.status === 'sent_to_zoho') {
      return {
        activeStep: 5,
        mode: 'sent_review',
        selectedPlanId: selectedPlan.id,
        showLatestSentPanel: true,
        reason: 'Restoring open sent plan',
      }
    }
  }

  if (enrichmentActive) {
    return {
      activeStep: 3,
      mode: 'workflow',
      selectedPlanId: latestOpen?.id || null,
      showLatestSentPanel: false,
      reason: 'Zoho enrichment is still running',
    }
  }

  if (latestOpen) {
    return {
      activeStep: latestOpen.status === 'sending' ? 6 : 5,
      mode: 'draft_review',
      selectedPlanId: latestOpen.id,
      showLatestSentPanel: false,
      reason: OPEN_PLAN_REASONS[latestOpen.status] || 'Active draft plan exists',
    }
  }

  if (!hasVigil) {
    return {
      activeStep: 1,
      mode: 'workflow',
      selectedPlanId: null,
      showLatestSentPanel: Boolean(latestSent),
      reason: 'Vigil upload required',
    }
  }

  if (enrichmentError || pendingWithoutZoho.length > 0) {
    return {
      activeStep: 3,
      mode: 'workflow',
      selectedPlanId: null,
      showLatestSentPanel: Boolean(latestSent),
      reason: 'Zoho enrichment required or in progress',
    }
  }

  if (!pending.length) {
    return {
      activeStep: 2,
      mode: 'workflow',
      selectedPlanId: null,
      showLatestSentPanel: Boolean(latestSent),
      reason: latestSent
        ? 'Latest PO is in Zoho; ready for a new low-stock batch'
        : 'Upload low-stock SKUs to start a batch',
    }
  }

  return {
    activeStep: 4,
    mode: 'workflow',
    selectedPlanId: null,
    showLatestSentPanel: Boolean(latestSent),
    reason: 'Pending SKUs are enriched and ready to generate a draft plan',
  }
}

interface WorkflowContext {
  uploads?: VigilUpload[]
  lowStock?: LowStockItem[]
  enrichmentRunning?: boolean
  enrichmentError?: string | null
  activePlan?: PurchasePlan | null
  activePlanWithPrices?: PurchasePlan | null
  plans?: PurchasePlan[]
  currentStep?: number | null
  pricesReady?: boolean
}

export function computeWorkflow(ctx: WorkflowContext): Workflow {
  const {
    uploads = [],
    lowStock = [],
    enrichmentRunning = false,
    enrichmentError = null,
    activePlan = null,
    activePlanWithPrices = null,
    plans = [],
    currentStep = null,
    pricesReady = true,
  } = ctx

  const pending = getPendingLowStock(lowStock)
  const pendingWithZoho = pending.filter(hasZohoItem)
  const pendingWithoutZoho = pending.filter((item) => !hasZohoItem(item))
  const hasVigil = Boolean(getCurrentVigilUpload(uploads, plans))
  const hasPendingUpload = pending.length > 0
  const openPlan = isOpenPlanStatus(activePlan?.status) ? activePlan : getLatestOpenPlan(plans)
  const hasOpenPlan = Boolean(openPlan)
  const planSending = openPlan?.status === 'sending'
  const hasDraft =
    plans.some((plan) => plan.status === 'draft' && !isLeftoverPlan(plan, plans)) || activePlan?.status === 'draft'
  const planSent = activePlan?.status === 'sent_to_zoho'
  const batchConsumed = !hasPendingUpload && (hasOpenPlan || planSent)
  const enrichmentActive = Boolean(enrichmentRunning && hasPendingUpload)
  const poSource = activePlanWithPrices || activePlan
  const poReadiness = poSource ? computePoReadiness(poSource, { pricesReady }) : null
  const poReady = Boolean(hasOpenPlan && poReadiness?.ready)
  const stepNum = Number(currentStep) > 0 ? Number(currentStep) : 0
  const blockers: StepBlockers = {}

  const focus = (status: StepStatus, stepId: StepId): StepStatus =>
    stepNum === stepId && (status === 'ready' || status === 'not_started') ? 'in_progress' : status

  let step1: StepStatus = hasVigil ? 'completed' : 'not_started'
  if (!hasVigil && stepNum === 1) step1 = 'in_progress'
  if (!hasVigil) {
    blockers[1] = uploads.length
      ? 'Upload this cycle\'s Vigil stock — the previous file belongs to an earlier PO.'
      : 'Upload Vigil stock to start.'
  }

  let step2: StepStatus
  if (hasPendingUpload || batchConsumed) {
    step2 = 'completed'
  } else if (!hasVigil) {
    step2 = 'blocked'
    blockers[2] = 'Upload Vigil stock first.'
  } else {
    step2 = 'ready'
  }

  let step3: StepStatus
  if (batchConsumed) {
    step3 = 'completed'
  } else if (!hasPendingUpload) {
    step3 = 'blocked'
    blockers[3] = 'Upload low-stock SKUs in Step 2.'
  } else if (enrichmentActive) {
    step3 = 'in_progress'
    blockers[3] = pendingWithZoho.length
      ? 'Zoho items are matched. Sales and bundle usage are still loading.'
      : 'Zoho enrichment is still running.'
  } else if (enrichmentError || pendingWithoutZoho.length > 0) {
    step3 = enrichmentError ? 'error' : 'blocked'
    blockers[3] = pendingWithoutZoho.length
      ? `${pendingWithoutZoho.length} SKU(s) still need a Zoho match. Remove them or refresh Zoho.`
      : 'Zoho enrichment failed. Refresh and try again.'
  } else {
    step3 = 'completed'
  }

  let step4: StepStatus
  if (!hasVigil) {
    step4 = 'blocked'
    blockers[4] = 'Upload this cycle\'s Vigil stock in Step 1 first.'
  } else if (batchConsumed) {
    step4 = 'completed'
  } else if (!hasPendingUpload) {
    step4 = 'blocked'
    blockers[4] = 'Upload low-stock SKUs first.'
  } else if (enrichmentActive) {
    step4 = 'blocked'
    blockers[4] = 'Wait until Zoho enrichment finishes.'
  } else if (pendingWithoutZoho.length > 0 || enrichmentError) {
    step4 = 'blocked'
    blockers[4] = blockers[3] || 'Finish Zoho matching before generating a plan.'
  } else if (hasOpenPlan) {
    step4 = 'completed'
  } else {
    step4 = 'ready'
  }

  let step5: StepStatus = 'blocked'
  if (planSent) step5 = 'completed'
  else if (hasOpenPlan) step5 = stepNum === 6 ? 'completed' : 'ready'
  else blockers[5] = 'Generate a draft plan before reviewing lines.'

  let step6: StepStatus = 'blocked'
  if (planSent) step6 = 'completed'
  else if (!hasOpenPlan) blockers[6] = 'Open a draft plan before creating a purchase order.'
  else if (planSending) {
    step6 = 'in_progress'
    blockers[6] = isPlanSendStale(openPlan)
      ? 'The last send was interrupted. Open this step to finish it safely.'
      : 'Sending the purchase order to Zoho…'
  } else if (poReady) step6 = 'ready'
  else {
    blockers[6] = poReadiness?.reasons?.[0] || 'Review quantities and prices before creating a purchase order.'
  }

  step2 = focus(step2, 2)
  step3 = step3 === 'in_progress' ? 'in_progress' : focus(step3, 3)
  step4 = focus(step4, 4)
  step5 = focus(step5, 5)
  step6 = focus(step6, 6)

  let suggestedStep: StepId
  if (!hasVigil) suggestedStep = 1
  else if (enrichmentActive || (hasPendingUpload && (pendingWithoutZoho.length > 0 || enrichmentError))) suggestedStep = 3
  else if (planSending) suggestedStep = 6
  else if (hasOpenPlan) suggestedStep = stepNum === 6 ? 6 : 5
  else if (hasPendingUpload) suggestedStep = 4
  else if (planSent) suggestedStep = 5
  else suggestedStep = 2

  return {
    stepStatuses: { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6 },
    suggestedStep,
    blockers,
    pending,
    pendingWithZoho,
    pendingWithoutZoho,
    hasVigil,
    hasPendingUpload,
    hasDraft,
    hasOpenPlan,
    batchConsumed,
    poReadiness,
  }
}

export function computePlanReviewSummary(plan: PurchasePlan | null | undefined): PlanReviewSummary {
  const items = plan?.items || []
  const included = items.filter((item) => item.included)
  const ordered = included.filter((item) => Number(item.finalQty || 0) > 0)
  const missingPrices = ordered.filter((item) => !hasPositivePrice(item.purchasePrice))
  const inactiveIncluded = ordered.filter((item) => item.zohoItemActive === false)
  const cappedByVigil = included.filter(
    (item) =>
      Number(item.suggestedQty || 0) > Number(item.wholesaleAvailableQty || 0) &&
      Number(item.wholesaleAvailableQty || 0) > 0
  )
  return {
    totalSkus: items.length,
    includedCount: included.length,
    excludedCount: items.length - included.length,
    totalFinalQty: included.reduce((sum, item) => sum + Number(item.finalQty || 0), 0),
    estimatedValue: included.reduce(
      (sum, item) => sum + Number(item.finalQty || 0) * Number(item.purchasePrice || 0),
      0
    ),
    missingPricesCount: missingPrices.length,
    missingPrices,
    inactiveCount: inactiveIncluded.length,
    inactiveItems: inactiveIncluded,
    cappedByVigilCount: cappedByVigil.length,
  }
}

export function computePoReadiness(
  plan: PurchasePlan | null | undefined,
  options: { pricesReady?: boolean } = {}
): PoReadiness {
  const pricesReady = options.pricesReady !== false
  const summary = computePlanReviewSummary(plan)
  const includedLines = (plan?.items || []).filter(
    (item) => item.included && Number(item.finalQty || 0) > 0 && hasZohoItem(item)
  )
  const reasons: string[] = []
  if (!plan) reasons.push('Open a draft plan before creating a purchase order.')
  if (plan?.status === 'sent_to_zoho') reasons.push('This plan was already sent to Zoho.')
  if (plan?.status === 'sending') reasons.push('This plan is being sent to Zoho.')
  if (plan && !isOpenPlanStatus(plan.status) && plan.status !== 'sent_to_zoho') {
    reasons.push('Only draft plans can create a purchase order.')
  }
  if (plan && includedLines.length === 0) reasons.push('No included lines with quantity greater than zero.')
  if (!pricesReady) {
    reasons.push('Purchase prices are still loading.')
  } else if (summary.missingPricesCount > 0) {
    reasons.push(`${summary.missingPricesCount} included line(s) missing purchase price in All Prices.`)
  }
  if (summary.inactiveCount > 0) {
    reasons.push(
      `${summary.inactiveCount} included line(s) are inactive or deleted in Zoho: ${summary.inactiveItems
        .slice(0, 5)
        .map((item) => item.sku)
        .join(', ')}${summary.inactiveCount > 5 ? '…' : ''}`
    )
  }
  return { ready: reasons.length === 0, reasons, includedLines, summary }
}

export interface VigilFollowUpLine {
  sku: string
  itemName: string
  neededQty: number
  orderedQty: number
  vigilQty: number
  shortfallQty: number
  reason: 'Vigil capped' | 'No Vigil match' | 'Zero wholesale stock'
}

export interface VigilFollowUp {
  capped: VigilFollowUpLine[]
  unavailable: VigilFollowUpLine[]
}

/** Lines Vigil could not fully cover: ordered short (capped) or not orderable at all. */
export function computeVigilFollowUp(plan: PurchasePlan | null | undefined): VigilFollowUp {
  const capped: VigilFollowUpLine[] = []
  const unavailable: VigilFollowUpLine[] = []
  for (const item of plan?.items || []) {
    const needed = Number(item.suggestedQty || 0)
    const vigil = Number(item.wholesaleAvailableQty || 0)
    const ordered = item.included ? Number(item.finalQty || 0) : 0
    const base = { sku: item.sku, itemName: item.itemName, neededQty: needed, orderedQty: ordered, vigilQty: vigil }
    if (needed <= 0) continue
    if (item.matchType === 'not_found') {
      unavailable.push({ ...base, shortfallQty: needed - ordered, reason: 'No Vigil match' })
    } else if (vigil <= 0) {
      unavailable.push({ ...base, shortfallQty: needed - ordered, reason: 'Zero wholesale stock' })
    } else if (needed > vigil) {
      capped.push({ ...base, shortfallQty: Math.max(0, needed - ordered), reason: 'Vigil capped' })
    }
  }
  const bySku = (a: VigilFollowUpLine, b: VigilFollowUpLine) => a.sku.localeCompare(b.sku)
  return { capped: capped.sort(bySku), unavailable: unavailable.sort(bySku) }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function vigilFollowUpToCsv(followUp: VigilFollowUp): string {
  const header = ['Issue', 'SKU', 'Product', 'Needed', 'Ordered', 'Vigil available', 'Shortfall']
  const rows = [...followUp.capped, ...followUp.unavailable].map((line) => [
    line.reason,
    line.sku,
    line.itemName,
    line.neededQty,
    line.orderedQty,
    line.vigilQty,
    line.shortfallQty,
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

export function getPlanRowBadges(item: PlanItem): RowBadge[] {
  const badges: RowBadge[] = []
  const wholesale = Number(item.wholesaleAvailableQty || 0)
  if (item.zohoItemActive === false) badges.push({ key: 'inactive-zoho', label: 'Inactive in Zoho', tone: 'danger' })
  if (item.matchType === 'not_found') badges.push({ key: 'no-vigil', label: 'No Vigil Match', tone: 'danger' })
  if (wholesale <= 0) badges.push({ key: 'zero-wholesale', label: 'Zero Wholesale Stock', tone: 'danger' })
  if (item.matchType !== 'not_found' && Number(item.suggestedQty || 0) > wholesale && wholesale > 0) {
    badges.push({ key: 'vigil-capped', label: 'Vigil Capped', tone: 'warning' })
  }
  if (item.included && Number(item.finalQty || 0) > 0 && !hasPositivePrice(item.purchasePrice)) {
    badges.push({ key: 'missing-price', label: 'Missing Price', tone: 'danger' })
  }
  return badges
}

export function formatUploadDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The server gives up on a run after 20 minutes; allow for one queued run ahead of it. */
const ENRICHMENT_POLL_DEADLINE_MS = 25 * 60 * 1000

interface PollOptions {
  onTick?: (result: EnrichmentPollResult) => void | Promise<void>
  signal?: AbortSignal
  deadlineMs?: number
}

/** Polls enrichment status until the server job finishes; resolves null if the signal aborts. */
export async function pollLowStockEnrichment({
  onTick,
  signal,
  deadlineMs = ENRICHMENT_POLL_DEADLINE_MS,
}: PollOptions): Promise<EnrichmentPollResult | null> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (signal?.aborted) return null
    const statusRes: EnrichmentStatus = await api.get('/api/purchase-planning/low-stock/enrichment-status', PP_REQUEST_OPTS)
    const listRes: { items?: LowStockItem[] } = await api.get('/api/purchase-planning/low-stock', PP_REQUEST_OPTS)
    const result: EnrichmentPollResult = {
      running: Boolean(statusRes.running),
      progress: statusRes.progress || null,
      resumed: Number(statusRes.attempts || 0) > 1,
      lastError: statusRes.lastError || null,
      lastSummary: statusRes.lastSummary || null,
      items: listRes.items || [],
    }
    if (signal?.aborted) return null
    if (onTick) await onTick(result)
    if (!result.running) return result
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  const err = new Error('Zoho enrichment is taking longer than expected. Try Refresh Zoho Data again.') as Error & {
    code?: string
  }
  err.code = 'ENRICHMENT_TIMEOUT'
  throw err
}
