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
    title: 'Upload Vigil Stock',
    description: 'Upload wholesale availability (item code + available quantity). Required before generating a plan.',
  },
  {
    id: 2,
    key: 'lowStock',
    title: 'Upload Low Stock SKUs',
    description: 'Upload the team’s low-stock SKU list. Saving creates pending rows for Zoho enrichment.',
  },
  {
    id: 3,
    key: 'enrich',
    title: 'Match & Enrich from Zoho',
    description: 'Life Smile warehouse stock, 3-month sales, and bundle usage from Zoho Inventory.',
  },
  {
    id: 4,
    key: 'generate',
    title: 'Generate Draft Plan',
    description: 'Build a draft purchase plan from pending SKUs, Vigil caps, and usage calculations.',
  },
  {
    id: 5,
    key: 'review',
    title: 'Review Quantities & Prices',
    description: 'Adjust final quantities, include/exclude lines, and verify All Prices purchase costs.',
  },
  {
    id: 6,
    key: 'po',
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

export function getLatestDraftPlan(plans) {
  return (plans || []).find((p) => p.status === 'draft') || null
}

export function getLastSentPlan(plans) {
  return (plans || []).find((p) => p.status === 'sent_to_zoho') || null
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
    plans = [],
  } = ctx

  const pending = getPendingLowStock(lowStock)
  const pendingWithZoho = pending.filter((item) => String(item.zohoItemId || '').trim())
  const pendingWithoutZoho = pending.filter((item) => !String(item.zohoItemId || '').trim())
  const hasVigil = uploads.length > 0
  const hasPendingUpload = pending.length > 0
  const draftPlans = (plans || []).filter((p) => p.status === 'draft')
  const hasDraft = draftPlans.length > 0 || activePlan?.status === 'draft'
  const planSent = activePlan?.status === 'sent_to_zoho'

  const blockers = {}

  let step1 = hasVigil ? 'completed' : 'not_started'
  let step2 = !hasVigil ? 'blocked' : hasPendingUpload ? 'completed' : 'ready'
  let step3 = 'not_started'
  if (!hasVigil) step3 = 'blocked'
  else if (!hasPendingUpload) step3 = 'blocked'
  else if (enrichmentRunning) step3 = 'in_progress'
  else if (enrichmentError) step3 = 'error'
  else if (pendingWithoutZoho.length > 0) step3 = 'blocked'
  else step3 = 'completed'

  let step4 = 'not_started'
  if (!hasVigil) {
    step4 = 'blocked'
    blockers[4] = 'Upload Vigil stock first (Step 1).'
  } else if (!hasPendingUpload) {
    step4 = 'blocked'
    blockers[4] = 'Upload low-stock SKUs first (Step 2).'
  } else if (enrichmentRunning) {
    step4 = 'blocked'
    blockers[4] = 'Wait for Zoho enrichment to finish (Step 3).'
  } else if (pendingWithoutZoho.length > 0) {
    step4 = 'blocked'
    blockers[4] = `${pendingWithoutZoho.length} SKU(s) still unmatched in Zoho (Step 3).`
  } else if (hasDraft || planSent) {
    step4 = 'completed'
  } else {
    step4 = 'ready'
  }

  let step5 = 'not_started'
  if (planSent) step5 = 'completed'
  else if (activePlan?.status === 'draft') step5 = 'in_progress'
  else if (hasDraft) step5 = 'ready'
  else step5 = 'blocked'

  let step6 = 'not_started'
  if (planSent) step6 = 'completed'
  else if (activePlan?.status === 'draft') step6 = 'ready'
  else step6 = 'blocked'

  if (!hasVigil) blockers[2] = 'Complete Step 1 first.'
  if (!hasPendingUpload && hasVigil) blockers[3] = 'Upload low-stock SKUs in Step 2.'
  if (enrichmentRunning) blockers[3] = 'Enrichment in progress…'
  if (pendingWithoutZoho.length > 0 && !enrichmentRunning) {
    blockers[3] = `${pendingWithoutZoho.length} SKU(s) need Zoho match or manual review.`
  }

  let suggestedStep = 1
  if (!hasVigil) suggestedStep = 1
  else if (!hasPendingUpload) suggestedStep = 2
  else if (enrichmentRunning || pendingWithoutZoho.length > 0 || enrichmentError) suggestedStep = 3
  else if (!hasDraft && activePlan?.status !== 'draft' && !planSent) suggestedStep = 4
  else if (activePlan?.status === 'draft') suggestedStep = 5
  else if (planSent) suggestedStep = 6
  else if (hasDraft) suggestedStep = 5
  else suggestedStep = 4

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
    cappedByVigilCount: cappedByVigil.length,
  }
}

export function computePoReadiness(plan) {
  const summary = computePlanReviewSummary(plan)
  const includedLines = (plan?.items || []).filter(
    (item) => item.included && Number(item.finalQty || 0) > 0 && String(item.zohoItemId || '').trim()
  )
  const invalidQty = includedLines.filter((item) => Number(item.finalQty || 0) <= 0)
  const reasons = []
  if (plan?.status === 'sent_to_zoho') reasons.push('This plan was already sent to Zoho.')
  if (plan?.status !== 'draft') reasons.push('Only draft plans can create a purchase order.')
  if (includedLines.length === 0) reasons.push('No included lines with quantity greater than zero.')
  if (invalidQty.length > 0) reasons.push('Some included lines have invalid quantity.')
  if (summary.missingPricesCount > 0) {
    reasons.push(`${summary.missingPricesCount} included line(s) missing purchase price in All Prices.`)
  }
  return { ready: reasons.length === 0, reasons, includedLines, summary }
}

export function getPlanRowBadges(item) {
  const badges = []
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
  if (badges.length === 0 && item.included && Number(item.finalQty || 0) > 0) {
    badges.push({ key: 'ready', label: 'Ready', tone: 'success' })
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

export async function pollLowStockEnrichment({ onTick, deadlineMs = 180_000 }) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const statusRes = await api.get('/api/purchase-planning/low-stock/enrichment-status', PP_REQUEST_OPTS)
    const listRes = await api.get('/api/purchase-planning/low-stock', PP_REQUEST_OPTS)
    const result = {
      running: Boolean(statusRes.running),
      lastError: statusRes.lastError || null,
      lastSummary: statusRes.lastSummary || null,
      items: listRes.items || [],
    }
    if (onTick) await onTick(result)
    if (!result.running) return result
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  const err = new Error('Zoho enrichment is taking longer than expected. Try Refresh Zoho Data again.')
  err.code = 'ENRICHMENT_TIMEOUT'
  throw err
}
