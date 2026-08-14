/**
 * Shared row helpers for the Noon clearing pipeline.
 *
 * These used to be copy-pasted across the return, settlement adjustment, payment
 * preview and reclass services. Keeping one copy here matters because the
 * duplicates were free to drift: a row could be "same week" to one service and
 * "cross week" to another purely because the two computed the sale-parent set
 * from different row arrays.
 *
 * Depends only on the category service and the order-id helper, so every other
 * clearing module can import it without creating a cycle.
 */
const { ROW_CLASS, round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { resolveNoonOrderIds, matchKey } = require('./noonOrderIdHelper')

const PAID_INVOICE_SUBSIDY_REASON = 'open_balance_short_already_paid'
const ORPHAN_PARENT_ASSIGNMENT_REASON = 'zoho_invoice_orphan_parent'

/** Normalized item-order key used for every exclusion / matching set in the module. */
function itemOrderMatchKey(value) {
  return matchKey(value)
}

/** Lower-cased parent order id, preferring the pre-fallback original. */
function parentOrderIdForRow(row) {
  if (!row) return ''
  return clean(
    row.originalParentOrderId || row.parentOrderId || resolveNoonOrderIds(row).parentOrderId
  ).toLowerCase()
}

function itemOrderIdForRow(row) {
  if (!row) return ''
  return clean(row.itemOrderId || resolveNoonOrderIds(row).itemOrderId)
}

function positiveAmount(value) {
  return Math.abs(round2(num(value)))
}

/** A sale line carrying real proceeds — zero-sale logistics rows do not count. */
function isSaleBearingSaleRow(row) {
  return row?.rowClass === ROW_CLASS.SALE_ITEM && num(row.netProceed) >= 0.01
}

/**
 * Parents with a genuine sale line in this statement. Drives every same-week vs
 * cross-week decision, so it must always be built from the same row array the
 * caller is about to classify.
 */
function buildSaleParentOrderIdSet(rows = []) {
  const set = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isSaleBearingSaleRow(row)) continue
    const parent = parentOrderIdForRow(row)
    if (parent) set.add(parent)
  }
  return set
}

function hasMarketplaceLogisticsCharge(row) {
  if (!row) return false
  return (
    Math.abs(num(row.fulfillmentFee)) >= 0.005 ||
    Math.abs(num(row.shippingCharges)) >= 0.005 ||
    Math.abs(num(row.otherOrderFees)) >= 0.005 ||
    Math.abs(num(row.othersInclVat)) >= 0.005
  )
}

/** Parent/adjustment logistics with no sale in this statement — clears via 1068, not 1066. */
function isOrphanParentLogisticsRow(row) {
  if (!row) return false
  if (clean(row.assignmentReason) === ORPHAN_PARENT_ASSIGNMENT_REASON) return true
  if (clean(row.parentFallbackStatus) === 'assigned_zoho_orphan') return true
  return false
}

/**
 * Accepts both plain GL accounts and Record Payment "depositTo" shaped accounts,
 * which is why callers can share one normalizer.
 */
function normalizeGlAccount(account = null, fallbackName = '') {
  if (!account) return { accountId: '', accountName: fallbackName, accountCode: '' }
  return {
    accountId: clean(account.accountId || account.depositToAccountId),
    accountName: clean(account.accountName || account.depositToAccountName) || fallbackName,
    accountCode: clean(account.accountCode || account.depositToAccountCode),
  }
}

/** True when the row was pulled out of Record Payment by an open-balance exclusion. */
function isExcludedRow(row, planExclusions = null) {
  if (!row) return false
  if (row.excludeFromPaymentClearing) return true
  const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
  const item = itemOrderMatchKey(row.assignedItemOrderId || row.itemOrderId)
  if (planExclusions?.excludedInvoiceIds && inv && planExclusions.excludedInvoiceIds.has(inv)) {
    return true
  }
  if (planExclusions?.excludedItemOrderIds && item && planExclusions.excludedItemOrderIds.has(item)) {
    return true
  }
  return false
}

module.exports = {
  PAID_INVOICE_SUBSIDY_REASON,
  ORPHAN_PARENT_ASSIGNMENT_REASON,
  itemOrderMatchKey,
  parentOrderIdForRow,
  itemOrderIdForRow,
  positiveAmount,
  isSaleBearingSaleRow,
  buildSaleParentOrderIdSet,
  hasMarketplaceLogisticsCharge,
  isOrphanParentLogisticsRow,
  normalizeGlAccount,
  isExcludedRow,
}
