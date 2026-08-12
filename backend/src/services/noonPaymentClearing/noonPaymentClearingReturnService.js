const {
  ROW_CLASS,
  round2,
  num,
  clean,
  hasProductSaleSignal,
  normalizeTransactionType,
} = require('./noonPaymentClearingCategoryService')
const { resolveNoonOrderIds } = require('./noonOrderIdHelper')
const { buildSaleParentOrderIdSet } = require('./noonPaymentClearingSettlementAdjustmentService')
const { extractVatFromNoonRow } = require('./noonPaymentClearingVatService')

const RETURN_BLOCK_CODES = Object.freeze({
  RETURN_CREDIT_NOTE_MISSING: 'RETURN_CREDIT_NOTE_MISSING',
  RETURN_CREDIT_NOTE_MULTIPLE_MATCHES: 'RETURN_CREDIT_NOTE_MULTIPLE_MATCHES',
  RETURN_INVOICE_MISSING: 'RETURN_INVOICE_MISSING',
  RETURN_INVOICE_MULTIPLE_MATCHES: 'RETURN_INVOICE_MULTIPLE_MATCHES',
  RETURN_CREDIT_NOTE_AMOUNT_MISMATCH: 'RETURN_CREDIT_NOTE_AMOUNT_MISMATCH',
  RETURN_CREDIT_NOTE_ALREADY_REFUNDED: 'RETURN_CREDIT_NOTE_ALREADY_REFUNDED',
})

const TOLERANCE = 0.01

function parentOrderIdForRow(row) {
  return clean(
    row.originalParentOrderId || row.parentOrderId || resolveNoonOrderIds(row).parentOrderId
  ).toLowerCase()
}

function itemOrderIdForRow(row) {
  return clean(row.itemOrderId || resolveNoonOrderIds(row).itemOrderId)
}

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

function reclassifyReturnRows(rows = [], saleParentSet = null) {
  const parents = saleParentSet || buildSaleParentOrderIdSet(rows)
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!isNoonCrossWeekReturnRow(row, parents)) return row
    return {
      ...row,
      rowClass: ROW_CLASS.RETURN,
      normalizedFeeType: 'RETURN',
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

  let commissionReversalNet = commissionReversalGross
  let commissionReversalVat = 0
  if (commissionReversalGross >= TOLERANCE) {
    const vat = extractVatFromNoonRow({ referralFee: commissionReversalGross, total: commissionReversalGross })
    commissionReversalNet = round2(Math.abs(vat.netAmount))
    commissionReversalVat = round2(Math.abs(vat.vatAmount))
  }

  let fulfillmentReversalNet = fulfillmentReversalGross
  let fulfillmentReversalVat = 0
  if (fulfillmentReversalGross >= TOLERANCE) {
    const gross = -fulfillmentReversalGross
    const vat = extractVatFromNoonRow({
      fulfillmentFee: gross,
      shippingCharges: 0,
      total: gross,
    })
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

module.exports = {
  RETURN_BLOCK_CODES,
  TOLERANCE,
  parentOrderIdForRow,
  itemOrderIdForRow,
  isNegativeNetProceedRow,
  isApproximatelyZeroNetProceed,
  isNoonReturnRow,
  isNoonCrossWeekReturnRow,
  reclassifyReturnRows,
  collectReturnRows,
  buildNoonReturnFeeBreakdown,
  buildReturnDescription,
}
