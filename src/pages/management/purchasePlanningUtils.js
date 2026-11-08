import { api, PURCHASE_PLANNING_TIMEOUT_MS } from '../../api/client'
import { resolveAllPricesRowsFromBundle } from './allPricesEcommerceUtils'
import { getAllPricesPrefsScope } from './allPricesMarketScope'

export const PP_REQUEST_OPTS = { timeoutMs: PURCHASE_PLANNING_TIMEOUT_MS }

export const EMPTY_FILTERS = {
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
  avgMin: '',
  avgMax: '',
  suggestedMin: '',
  suggestedMax: '',
  finalMin: '',
  finalMax: '',
}

export const PP_STEPS = [
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

export function ignoreCancelledPurchasePlanningRequest(err, signal) {
  return Boolean(signal?.aborted && err?.code !== 'REQUEST_TIMEOUT')
}

export function fmt(n) {
  const value = Number(n || 0)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function fmtPrice(n) {
  const value = Number(n)
  if (!Number.isFinite(value) || value <= 0) return '-'
  return value.toFixed(2)
}

export function normalizePriceLookupKey(value) {
  return String(value || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[_/]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

export function buildPurchasePriceLookup(priceRows) {
  const lookup = new Map()
  for (const row of Array.isArray(priceRows) ? priceRows : []) {
    const key = normalizePriceLookupKey(row.itemNo)
    const price = Number(row.purchasePrice)
    if (!key || !Number.isFinite(price) || price <= 0) continue
    lookup.set(key, price)
  }
  return lookup
}

export function findPurchasePriceForItem(item, lookup) {
  const candidates = [item.sku, item.vigilCode, item.itemName]
  for (const candidate of candidates) {
    const key = normalizePriceLookupKey(candidate)
    if (key && lookup.has(key)) return lookup.get(key)
  }
  return Number.isFinite(Number(item.purchasePrice)) && Number(item.purchasePrice) > 0
    ? Number(item.purchasePrice)
    : null
}

export function enrichPlanWithPurchasePrices(plan, priceRows) {
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

export function resolveAllPriceRows(getPref, prefsReady, prefsVersion) {
  void prefsVersion
  if (!prefsReady) return []
  const bundle = getPref(getAllPricesPrefsScope().ec, null)
  return resolveAllPricesRowsFromBundle(bundle) || []
}

export function getStockRemark(item) {
  const vigilStock = Number(item.vigilStock ?? item.wholesaleAvailableQty ?? 0)
  const zohoStock = Number(item.currentZohoStock || 0)
  return vigilStock <= 0 && zohoStock <= 3 ? 'Out of stock' : ''
}

export function includesAnyText(values, filter) {
  const needle = String(filter || '').trim().toLowerCase()
  if (!needle) return true
  return values.some((value) => String(value || '').toLowerCase().includes(needle))
}

export function inNumberRange(value, min, max) {
  const n = Number(value || 0)
  const minValue = String(min || '').trim() === '' ? null : Number(min)
  const maxValue = String(max || '').trim() === '' ? null : Number(max)
  if (minValue != null && Number.isFinite(minValue) && n < minValue) return false
  if (maxValue != null && Number.isFinite(maxValue) && n > maxValue) return false
  return true
}

export function nextSort(current, key) {
  if (current.key !== key) return { key, direction: 'asc' }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

export function compareSortValues(a, b) {
  const aNumber = typeof a === 'number' ? a : Number.NaN
  const bNumber = typeof b === 'number' ? b : Number.NaN
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows(rows, sort, accessors) {
  const accessor = accessors[sort.key]
  if (!accessor) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => compareSortValues(accessor(a), accessor(b)) * direction)
}

export function getPendingLowStock(lowStock) {
  return (lowStock || []).filter((item) => item.status === 'pending')
}

export function getLatestVigilUpload(uploads) {
  return uploads && uploads.length > 0 ? uploads[0] : null
}

export function isEditablePlanStatus(status) {
  return status === 'draft' || status === 'failed'
}

/** Not yet in Zoho: editable drafts/failed sends, plus a send that is in flight. */
export function isOpenPlanStatus(status) {
  return isEditablePlanStatus(status) || status === 'sending'
}

/** Matches the server: a send older than this is treated as interrupted and may be finished. */
export const PO_SEND_STALE_MS = 10 * 60 * 1000

export function isPlanSendStale(plan, now = Date.now()) {
  if (plan?.status !== 'sending') return false
  const started = plan.sendStartedAt ? new Date(plan.sendStartedAt).getTime() : Number.NaN
  return !Number.isFinite(started) || now - started >= PO_SEND_STALE_MS
}

export function getLatestDraftPlan(plans) {
  return (plans || []).find((p) => p.status === 'draft') || null
}

/** Newest plan that has not reached Zoho yet (draft, failed send, or send in flight). */
export function getLatestOpenPlan(plans) {
  return (plans || []).find((p) => isOpenPlanStatus(p.status)) || null
}

export function getLatestSentPlan(plans) {
  return (plans || []).find((p) => p.status === 'sent_to_zoho') || null
}

/** @deprecated Use getLatestSentPlan */
export function getLastSentPlan(plans) {
  return getLatestSentPlan(plans)
}

export function enrichPlanListSummary(plan, priceRows) {
  if (!plan) return plan
  if (!priceRows?.length) return plan
  const lookup = buildPurchasePriceLookup(priceRows)
  const items = Array.isArray(plan.items) ? plan.items : []
  let estimatedTotalValue = Number(plan.estimatedTotalValue || 0)
  if (items.length > 0) {
    estimatedTotalValue = items
      .filter((item) => item.included)
      .reduce((sum, item) => {
        const price = findPurchasePriceForItem(item, lookup) ?? Number(item.purchasePrice || 0)
        return sum + Number(item.finalQty || 0) * price
      }, 0)
  }
  return { ...plan, estimatedTotalValue }
}

/**
 * @typedef {'workflow'|'draft_review'|'sent_review'|'history'} PurchasePlanningViewMode
 */

/**
 * @param {object} ctx
 * @returns {{
 *   activeStep: number,
 *   mode: PurchasePlanningViewMode,
 *   selectedPlanId: number|null,
 *   showLatestSentPanel: boolean,
 *   reason: string
 * }}
 */
export function getDefaultPurchasePlanningView(ctx) {
  const {
    uploads = [],
    lowStock = [],
    enrichmentRunning = false,
    enrichmentError = null,
    plans = [],
    selectedPlan = null,
  } = ctx

  const pending = getPendingLowStock(lowStock)
  const pendingWithoutZoho = pending.filter((item) => !String(item.zohoItemId || '').trim())
  const enrichmentActive = Boolean(enrichmentRunning && pending.length > 0)
  const hasVigil = uploads.length > 0
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
    const reasons = {
      failed: 'Last Zoho send failed and can be retried',
      sending: 'Purchase order send in progress',
    }
    return {
      activeStep: latestOpen.status === 'sending' ? 6 : 5,
      mode: 'draft_review',
      selectedPlanId: latestOpen.id,
      showLatestSentPanel: false,
      reason: reasons[latestOpen.status] || 'Active draft plan exists',
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

  if (enrichmentActive || enrichmentError || pendingWithoutZoho.length > 0) {
    return {
      activeStep: 3,
      mode: 'workflow',
      selectedPlanId: null,
      showLatestSentPanel: Boolean(latestSent),
      reason: 'Zoho enrichment required or in progress',
    }
  }

  if (!pending.length) {
    if (latestSent) {
      return {
        activeStep: 5,
        mode: 'sent_review',
        selectedPlanId: latestSent.id,
        showLatestSentPanel: true,
        reason: 'Latest plan was sent to Zoho; no active draft',
      }
    }
    return {
      activeStep: 2,
      mode: 'workflow',
      selectedPlanId: null,
      showLatestSentPanel: false,
      reason: 'Upload low-stock SKUs to start a batch',
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

/** @typedef {'not_started'|'ready'|'in_progress'|'completed'|'blocked'|'error'} StepStatus */

/**
 * @param {object} ctx
 * @returns {{ stepStatuses: Record<number, StepStatus>, suggestedStep: number, blockers: Record<number, string> }}
 */
export function computeWorkflow(ctx) {
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
  const pendingWithZoho = pending.filter((item) => String(item.zohoItemId || '').trim())
  const pendingWithoutZoho = pending.filter((item) => !String(item.zohoItemId || '').trim())
  const hasVigil = uploads.length > 0
  const hasPendingUpload = pending.length > 0
  const openFromList = getLatestOpenPlan(plans)
  const activeIsOpen = isOpenPlanStatus(activePlan?.status)
  const openPlan = activeIsOpen ? activePlan : openFromList
  const hasOpenPlan = Boolean(openPlan)
  const planSending = openPlan?.status === 'sending'
  const hasDraft = (plans || []).some((plan) => plan.status === 'draft') || activePlan?.status === 'draft'
  const planSent = activePlan?.status === 'sent_to_zoho'
  const batchConsumed = !hasPendingUpload && (hasOpenPlan || planSent)
  const enrichmentActive = Boolean(enrichmentRunning && hasPendingUpload)
  const poSource = activePlanWithPrices || activePlan
  const poReadiness = poSource ? computePoReadiness(poSource, { pricesReady }) : null
  const poReady = Boolean(hasOpenPlan && poReadiness?.ready)
  const stepNum = Number(currentStep) > 0 ? Number(currentStep) : 0
  const blockers = {}

  const focus = (status, stepId) =>
    stepNum === stepId && (status === 'ready' || status === 'not_started') ? 'in_progress' : status

  let step1 = hasVigil ? 'completed' : 'not_started'
  if (!hasVigil && stepNum === 1) step1 = 'in_progress'

  let step2 = 'not_started'
  if (!hasVigil) {
    step2 = 'blocked'
    blockers[2] = 'Upload Vigil stock first.'
  } else if (hasPendingUpload || batchConsumed) {
    step2 = 'completed'
  } else {
    step2 = 'ready'
  }

  let step3 = 'not_started'
  if (!hasVigil) {
    step3 = 'blocked'
  } else if (batchConsumed && !hasPendingUpload) {
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

  let step4 = 'not_started'
  if (!hasVigil) {
    step4 = 'blocked'
    blockers[4] = 'Upload Vigil stock first.'
  } else if (batchConsumed && !hasPendingUpload) {
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

  let step5 = 'blocked'
  if (planSent) step5 = 'completed'
  else if (hasOpenPlan) step5 = stepNum === 6 ? 'completed' : 'ready'
  else blockers[5] = 'Generate a draft plan before reviewing lines.'

  let step6 = 'blocked'
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

  let suggestedStep = 1
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

export function computePlanReviewSummary(plan) {
  const items = plan?.items || []
  const included = items.filter((item) => item.included)
  const excluded = items.filter((item) => !item.included)
  const totalFinalQty = included.reduce((sum, item) => sum + Number(item.finalQty || 0), 0)
  const missingPrices = included.filter(
    (item) => Number(item.finalQty || 0) > 0 && (!Number.isFinite(Number(item.purchasePrice)) || Number(item.purchasePrice) <= 0)
  )
  const inactiveIncluded = included.filter(
    (item) => Number(item.finalQty || 0) > 0 && item.zohoItemActive === false
  )
  const cappedByVigil = items.filter(
    (item) =>
      item.included &&
      Number(item.suggestedQty || 0) > Number(item.wholesaleAvailableQty || 0) &&
      Number(item.wholesaleAvailableQty || 0) > 0
  )
  const estimatedValue = included.reduce(
    (sum, item) => sum + Number(item.finalQty || 0) * Number(item.purchasePrice || 0),
    0
  )
  return {
    totalSkus: items.length,
    includedCount: included.length,
    excludedCount: excluded.length,
    totalFinalQty,
    estimatedValue,
    missingPricesCount: missingPrices.length,
    missingPrices,
    inactiveCount: inactiveIncluded.length,
    inactiveItems: inactiveIncluded,
    cappedByVigilCount: cappedByVigil.length,
  }
}

export function computePoReadiness(plan, options = {}) {
  const pricesReady = options.pricesReady !== false
  const summary = computePlanReviewSummary(plan)
  const includedLines = (plan?.items || []).filter(
    (item) => item.included && Number(item.finalQty || 0) > 0 && String(item.zohoItemId || '').trim()
  )
  const invalidQty = includedLines.filter((item) => Number(item.finalQty || 0) <= 0)
  const reasons = []
  if (!plan) reasons.push('Open a draft plan before creating a purchase order.')
  if (plan?.status === 'sent_to_zoho') reasons.push('This plan was already sent to Zoho.')
  if (plan?.status === 'sending') reasons.push('This plan is being sent to Zoho.')
  if (plan && !isOpenPlanStatus(plan.status) && plan.status !== 'sent_to_zoho') {
    reasons.push('Only draft plans can create a purchase order.')
  }
  if (plan && includedLines.length === 0) reasons.push('No included lines with quantity greater than zero.')
  if (invalidQty.length > 0) reasons.push('Some included lines have invalid quantity.')
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

export function getPlanRowBadges(item) {
  const badges = []
  if (item.zohoItemActive === false) badges.push({ key: 'inactive-zoho', label: 'Inactive in Zoho', tone: 'danger' })
  if (item.matchType === 'not_found') badges.push({ key: 'no-vigil', label: 'No Vigil Match', tone: 'danger' })
  if (Number(item.wholesaleAvailableQty || 0) <= 0) badges.push({ key: 'zero-wholesale', label: 'Zero Wholesale Stock', tone: 'danger' })
  if (
    item.included &&
    Number(item.suggestedQty || 0) > Number(item.wholesaleAvailableQty || 0) &&
    Number(item.wholesaleAvailableQty || 0) > 0
  ) {
    badges.push({ key: 'vigil-capped', label: 'Vigil Capped', tone: 'warning' })
  }
  if (item.included && Number(item.finalQty || 0) > 0 && (!Number.isFinite(Number(item.purchasePrice)) || Number(item.purchasePrice) <= 0)) {
    badges.push({ key: 'missing-price', label: 'Missing Price', tone: 'danger' })
  }
  return badges
}

export function formatUploadDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(value)
  }
}

/** The server gives up on a run after 20 minutes; allow for one queued run ahead of it. */
const ENRICHMENT_POLL_DEADLINE_MS = 25 * 60 * 1000

export async function pollLowStockEnrichment({ onTick, signal, deadlineMs = ENRICHMENT_POLL_DEADLINE_MS }) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (signal?.aborted) return null
    const statusRes = await api.get('/api/purchase-planning/low-stock/enrichment-status', PP_REQUEST_OPTS)
    const listRes = await api.get('/api/purchase-planning/low-stock', PP_REQUEST_OPTS)
    const result = {
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
  const err = new Error('Zoho enrichment is taking longer than expected. Try Refresh Zoho Data again.')
  err.code = 'ENRICHMENT_TIMEOUT'
  throw err
}
