const {
  ROW_CLASS,
  round2,
  num,
  clean,
  hasProductSaleSignal,
  normalizeTransactionType,
} = require('./noonPaymentClearingCategoryService')
const {
  buildSaleParentOrderIdSet,
  parentOrderIdForRow,
  itemOrderIdForRow,
} = require('./noonPaymentClearingRowPredicates')
const { applyVatPolicy, VAT_POLICY } = require('./lineTypes/noonLineTypeVatPolicy')

const RETURN_BLOCK_CODES = Object.freeze({
  RETURN_CREDIT_NOTE_MISSING: 'RETURN_CREDIT_NOTE_MISSING',
  RETURN_CREDIT_NOTE_MULTIPLE_MATCHES: 'RETURN_CREDIT_NOTE_MULTIPLE_MATCHES',
  RETURN_INVOICE_MISSING: 'RETURN_INVOICE_MISSING',
  RETURN_INVOICE_MULTIPLE_MATCHES: 'RETURN_INVOICE_MULTIPLE_MATCHES',
  RETURN_CREDIT_NOTE_AMOUNT_MISMATCH: 'RETURN_CREDIT_NOTE_AMOUNT_MISMATCH',
  RETURN_CREDIT_NOTE_ALREADY_REFUNDED: 'RETURN_CREDIT_NOTE_ALREADY_REFUNDED',
})

const TOLERANCE = 0.01

/** Net Proceeds materially negative — not zero-sale logistics. */
function isNegativeNetProceedRow(row) {
  return num(row.netProceed) <= -TOLERANCE
}

function isApproximatelyZeroNetProceed(row) {
  return num(row.netProceed) > -TOLERANCE && num(row.netProceed) < TOLERANCE
}

function isNoonReturnRow(row) {
  return row?.rowClass === ROW_CLASS.RETURN
}

/**
 * Cross-week product return: negative Net Proceeds, item-level ID, no sale-bearing parent in statement.
 */
function isNoonCrossWeekReturnRow(row, saleParentSet) {
  if (!row || row.excludeFromPaymentClearing) return false
  if (!isNegativeNetProceedRow(row)) return false
  const itemId = itemOrderIdForRow(row)
  if (!itemId || !itemId.includes('-')) return false
  const parent = parentOrderIdForRow(row)
  const parents = saleParentSet || buildSaleParentOrderIdSet([])
  if (parent && parents.has(parent)) return false
  const tx = normalizeTransactionType(row.transactionType)
  return hasProductSaleSignal(row) || tx === 'order_update' || tx === 'order'
}

/**
 * Same-week product return: the refunded order also sold in this statement.
 *
 * The accounting is identical to a cross-week return — Noon deducts the refund
 * from this payout either way — so it clears through the same credit note and
 * fee reversal journals. Previously these rows matched no consumer at all and
 * showed up only as an unexplained undeposited planning difference.
 */
function isNoonSameWeekReturnRow(row, saleParentSet) {
  if (!row || row.excludeFromPaymentClearing) return false
  if (!isNegativeNetProceedRow(row)) return false
  // A refund reduces the settlement. Negative proceeds alongside a positive
  // Total is a subsidy shape and belongs to the settlement adjustment journal.
  if (num(row.total) >= TOLERANCE) return false
  const itemId = itemOrderIdForRow(row)
  if (!itemId || !itemId.includes('-')) return false
  const parent = parentOrderIdForRow(row)
  const parents = saleParentSet || buildSaleParentOrderIdSet([])
  if (!parent || !parents.has(parent)) return false
  const tx = normalizeTransactionType(row.transactionType)
  return hasProductSaleSignal(row) || tx === 'order_update' || tx === 'order'
}

function returnTimingForRow(row, saleParentSet) {
  if (isNoonCrossWeekReturnRow(row, saleParentSet)) return 'cross_week'
  if (isNoonSameWeekReturnRow(row, saleParentSet)) return 'same_week'
  return ''
}

function reclassifyReturnRows(rows = [], saleParentSet = null) {
  const parents = saleParentSet || buildSaleParentOrderIdSet(rows)
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const timing = returnTimingForRow(row, parents)
    if (!timing) return row
    return {
      ...row,
      rowClass: ROW_CLASS.RETURN,
      normalizedFeeType: 'RETURN',
      returnTiming: timing,
      reclassifiedFrom: row.rowClass || 'order_adjustment',
    }
  })
}

function collectReturnRows(allRows = [], saleParentSet = null) {
  const parents = saleParentSet || buildSaleParentOrderIdSet(allRows)
  return reclassifyReturnRows(allRows, parents).filter((row) => isNoonReturnRow(row))
}

/**
 * Decompose a Noon return row into product refund vs marketplace fee reversals.
 */
function buildNoonReturnFeeBreakdown(row) {
  const itemOrderId = itemOrderIdForRow(row)
  const parentOrderId = clean(row.parentOrderId || row.originalParentOrderId)
  const netProceed = round2(num(row.netProceed))
  const productRefundAmount = round2(Math.abs(Math.min(0, netProceed)))
  const commissionReversalGross = round2(Math.max(0, num(row.referralFee)))
  const fulfillmentReversalGross = round2(
    Math.abs(Math.min(0, round2(num(row.fulfillmentFee) + num(row.shippingCharges))))
  )
  const netSettlementEffect = round2(num(row.total))

  // Fee reversals are COMPONENT_SUM. The product principal above is deliberately
  // untouched: a refund of goods carries no service-fee VAT.
  let commissionReversalNet = commissionReversalGross
  let commissionReversalVat = 0
  if (commissionReversalGross >= TOLERANCE) {
    const vat = applyVatPolicy(
      { referralFee: commissionReversalGross, total: commissionReversalGross },
      VAT_POLICY.COMPONENT_SUM
    )
    commissionReversalNet = round2(Math.abs(vat.netAmount))
    commissionReversalVat = round2(Math.abs(vat.vatAmount))
  }

  let fulfillmentReversalNet = fulfillmentReversalGross
  let fulfillmentReversalVat = 0
  if (fulfillmentReversalGross >= TOLERANCE) {
    const gross = -fulfillmentReversalGross
    const vat = applyVatPolicy(
      { fulfillmentFee: gross, shippingCharges: 0, total: gross },
      VAT_POLICY.COMPONENT_SUM
    )
    fulfillmentReversalNet = round2(Math.abs(vat.netAmount))
    fulfillmentReversalVat = round2(Math.abs(vat.vatAmount))
  }

  return {
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId,
    productRefundAmount,
    commissionReversalGross,
    commissionReversalNet,
    commissionReversalVat,
    fulfillmentReversalGross,
    fulfillmentReversalNet,
    fulfillmentReversalVat,
    netSettlementEffect,
    netProceed,
    referralFee: round2(num(row.referralFee)),
    fulfillmentFee: round2(num(row.fulfillmentFee)),
    shippingCharges: round2(num(row.shippingCharges)),
  }
}

function buildReturnDescription(row, metadata = {}, kind = 'return') {
  const ref = clean(metadata.referenceNr) || clean(metadata.statementId) || 'Noon settlement'
  const item = itemOrderIdForRow(row)
  const gross = round2(Math.abs(num(row.netProceed)))
  if (kind === 'commission') {
    const g = round2(Math.max(0, num(row.referralFee)))
    return `Noon commission reversal | ${item} | ${ref} | Gross ${g}`
  }
  if (kind === 'vat') {
    const g = round2(Math.max(0, num(row.referralFee)))
    return `Noon VAT reversal | ${item} | ${ref} | Gross ${g}`
  }
  return `Noon return | ${item} | ${ref} | Gross ${gross}`
}

/**
 * Residual 1066 effect for a matched return after CN principal and commission reversal.
 * Noon row Total is authoritative; this captures fulfillment/shipping and any other fee
 * components not covered by commissionReversalGross alone.
 */
function returnFulfillment1066Impact(row, breakdown, matched) {
  if (!matched || matched.status !== 'matched') return 0
  return round2(
    num(row.total) + num(breakdown.productRefundAmount) - num(breakdown.commissionReversalGross)
  )
}

module.exports = {
  RETURN_BLOCK_CODES,
  TOLERANCE,
  parentOrderIdForRow,
  itemOrderIdForRow,
  isNegativeNetProceedRow,
  isApproximatelyZeroNetProceed,
  isNoonReturnRow,
  isNoonCrossWeekReturnRow,
  isNoonSameWeekReturnRow,
  returnTimingForRow,
  reclassifyReturnRows,
  collectReturnRows,
  buildNoonReturnFeeBreakdown,
  buildReturnDescription,
  returnFulfillment1066Impact,
}
