/**
 * The derived state every line-type decision needs, built once per batch.
 *
 * Before this existed, `buildSaleParentOrderIdSet` was recomputed at roughly six
 * call sites and each one chose its own input rows — sometimes the raw rows,
 * sometimes the reclassified ones. That is how a row ended up being a return to
 * one consumer and a payable sale to another.
 */
const { clean, num } = require('../noonPaymentClearingCategoryService')
const {
  buildSaleParentOrderIdSet,
  itemOrderMatchKey,
} = require('../noonPaymentClearingRowPredicates')

/** Merged exclusion sets: open-balance snapshot + row flags + matched-order flags. */
function collectExclusions(batch) {
  const excludedInvoiceIds = new Set(
    (batch?.reportSnapshot?.openBalanceReconcile?.excludedInvoiceIds || [])
      .map((id) => clean(id))
      .filter(Boolean)
  )
  const excludedItemOrderIds = new Set(
    (batch?.reportSnapshot?.openBalanceReconcile?.excludedItemOrderIds || [])
      .map((id) => itemOrderMatchKey(id))
      .filter(Boolean)
  )
  for (const m of batch?.matchedOrders || []) {
    if (!m?.excludeFromPaymentClearing) continue
    const inv = clean(m.zohoInvoiceId)
    const item = itemOrderMatchKey(m.itemOrderId)
    if (inv) excludedInvoiceIds.add(inv)
    if (item) excludedItemOrderIds.add(item)
  }
  for (const row of batch?.allRows || []) {
    if (!row?.excludeFromPaymentClearing) continue
    const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const item = itemOrderMatchKey(row.assignedItemOrderId || row.itemOrderId)
    if (inv) excludedInvoiceIds.add(inv)
    if (item) excludedItemOrderIds.add(item)
  }
  return { excludedInvoiceIds, excludedItemOrderIds }
}

/**
 * Item orders already claimed by the return workflow. Returns clear through
 * credit notes and return fee journals only, never through Record Payment, so
 * this set is the authoritative veto for the payment path.
 */
function collectReturnItemOrderIds(batch, classifiedRows) {
  const ids = new Set()
  for (const row of classifiedRows || []) {
    if (row?.rowClass !== 'return') continue
    const key = itemOrderMatchKey(row.itemOrderId)
    if (key) ids.add(key)
  }
  for (const row of [...(batch?.matchedReturns || []), ...(batch?.refundReturnRows || [])]) {
    const key = itemOrderMatchKey(row?.itemOrderId)
    if (key) ids.add(key)
  }
  return ids
}

/**
 * @param {object} batch stored clearing batch
 * @param {object} [options] `rows` overrides `batch.allRows` (pass reclassified rows),
 *   `ignoreExclusions` drops the exclusion sets for open-balance detection
 */
function buildRowContext(batch, options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : batch?.allRows || []
  const saleParentSet = buildSaleParentOrderIdSet(rows)
  const exclusions = options.ignoreExclusions
    ? { excludedInvoiceIds: new Set(), excludedItemOrderIds: new Set() }
    : collectExclusions(batch)
  return {
    rows,
    saleParentSet,
    planExclusions: options.ignoreExclusions ? null : exclusions,
    excludedInvoiceIds: exclusions.excludedInvoiceIds,
    excludedItemOrderIds: exclusions.excludedItemOrderIds,
    returnItemOrderIds: collectReturnItemOrderIds(batch, rows),
    matchedReturnsByItem: new Map(
      (batch?.matchedReturns || []).map((row) => [itemOrderMatchKey(row?.itemOrderId), row])
    ),
    vatRate: num(options.vatRate) || 0.05,
  }
}

module.exports = {
  buildRowContext,
  collectExclusions,
  collectReturnItemOrderIds,
}
