function clean(value) {
  return String(value == null ? '' : value).trim()
}

function round2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function emptyBreakdown() {
  return {
    principalTotal: 0,
    shippingCollectedTotal: 0,
    commissionTotal: 0,
    fulfillmentFeeTotal: 0,
    closingFeeTotal: 0,
    shippingPromotionTotal: 0,
    refundTotal: 0,
    otherAmazonFeeTotal: 0,
    amazonOrderTotal: 0,
    grossAmazonTotal: 0,
    totalFees: 0,
    netSettlementAmount: 0,
  }
}

function isFeeLike(row) {
  const hay = [
    row?.transactionType,
    row?.amountType,
    row?.amountDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return (
    hay.includes('fee') ||
    hay.includes('charge') ||
    hay.includes('commission') ||
    hay.includes('fulfillment') ||
    hay.includes('fulfilment') ||
    hay.includes('closing') ||
    hay.includes('storage') ||
    hay.includes('promotion') ||
    hay.includes('promo') ||
    hay.includes('withheld')
  )
}

/**
 * Map one settlement row to a breakdown bucket using exact Amazon amount-type/description rules.
 * @returns {string|null} bucket key or null when the row only contributes to net total
 */
function classifyOrderRowBucket(row) {
  const tx = clean(row?.transactionType).toLowerCase()
  const amountType = clean(row?.amountType)
  const amountDesc = clean(row?.amountDescription)
  const amount = num(row?.amount)

  if (tx.includes('refund')) return 'refundTotal'

  if (amountType === 'ItemPrice' && amountDesc === 'Principal') return 'principalTotal'
  if (amountType === 'ItemPrice' && amountDesc === 'Shipping') return 'shippingCollectedTotal'
  if (amountType === 'ItemFees' && amountDesc === 'Commission') return 'commissionTotal'
  if (amountType === 'ItemFees' && amountDesc === 'FBAPerUnitFulfillmentFee') return 'fulfillmentFeeTotal'
  if (amountType === 'ItemFees' && amountDesc === 'VariableClosingFee') return 'closingFeeTotal'
  if (amountType === 'Promotion' && amountDesc === 'Shipping') return 'shippingPromotionTotal'

  if (amount < 0 && isFeeLike(row)) return 'otherAmazonFeeTotal'

  return null
}

const { ROW_CLASS, CATEGORY, isNonOrderLinkedAmazonFee } = require('./amazonPaymentClearingCategoryService')

const NET_NEGATIVE_ORDER_TOLERANCE = 0.01

function isRefundReturnLikeRow(row) {
  const tx = clean(row?.transactionType).toLowerCase()
  return (
    row?.rowClass === ROW_CLASS.REFUND ||
    row?.rowClass === ROW_CLASS.RETURN ||
    tx.includes('refund') ||
    tx.includes('return')
  )
}

function isSettlementReturnRow(row) {
  if (!row) return false
  if (isRefundReturnLikeRow(row)) return true
  const category = clean(row?.category).toLowerCase()
  const rowClass = clean(row?.rowClass).toLowerCase()
  return (
    category === String(CATEGORY.REFUND).toLowerCase() ||
    category === String(CATEGORY.RETURN).toLowerCase() ||
    rowClass === 'refund' ||
    rowClass === 'return'
  )
}

function collectSettlementReturnOrderIds(allRows, options = {}) {
  const ids = new Set()
  for (const row of detectNetNegativeOrderRefundRows(allRows)) {
    if (row?.orderId) ids.add(clean(row.orderId))
  }
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (isSettlementReturnRow(row) && row.orderId) ids.add(clean(row.orderId))
  }
  for (const key of ['matchedReturns', 'refundReturnRows', 'creditNoteBlockingRows', 'missingCreditNotes', 'netNegativeReturnOrders']) {
    for (const row of options[key] || []) {
      if (row?.orderId) ids.add(clean(row.orderId))
    }
  }
  return ids
}

function isNetNegativeOrderReturn(breakdown) {
  const principal = round2(Number(breakdown?.principalTotal) || 0)
  const net = round2(Number(breakdown?.netSettlementAmount) || 0)
  return principal < -NET_NEGATIVE_ORDER_TOLERANCE && net < -NET_NEGATIVE_ORDER_TOLERANCE
}

function buildSyntheticRefundReturnFromOrder(orderId, breakdown) {
  const principal = round2(breakdown.principalTotal)
  const net = round2(breakdown.netSettlementAmount)
  return {
    orderId,
    rowClass: ROW_CLASS.RETURN,
    category: CATEGORY.RETURN,
    transactionType: 'SettlementNetNegative',
    amountType: 'ItemPrice',
    amountDescription: 'Principal',
    amount: principal,
    settlementDerivedReturn: true,
    netSettlementAmount: net,
    principalTotal: principal,
  }
}

function detectNetNegativeOrderRefundRows(rows) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const orderId = clean(row?.orderId)
    if (!orderId || isNonOrderLinkedAmazonFee(row) || isRefundReturnLikeRow(row)) continue
    if (!groups.has(orderId)) groups.set(orderId, [])
    groups.get(orderId).push(row)
  }
  const synthetic = []
  for (const [orderId, orderRows] of groups.entries()) {
    const breakdown = buildOrderFeeBreakdown(orderRows)
    if (isNetNegativeOrderReturn(breakdown)) {
      synthetic.push(buildSyntheticRefundReturnFromOrder(orderId, breakdown))
    }
  }
  return synthetic.sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)))
}

function buildOrderFeeBreakdown(orderRows) {
  const breakdown = emptyBreakdown()
  for (const row of Array.isArray(orderRows) ? orderRows : []) {
    const amount = num(row?.amount)
    breakdown.netSettlementAmount = round2(breakdown.netSettlementAmount + amount)
    const bucket = classifyOrderRowBucket(row)
    if (bucket) {
      breakdown[bucket] = round2(breakdown[bucket] + amount)
    }
  }

  breakdown.amazonOrderTotal = breakdown.principalTotal
  breakdown.grossAmazonTotal = round2(
    breakdown.principalTotal + breakdown.shippingCollectedTotal
  )
  breakdown.totalFees = round2(
    breakdown.commissionTotal +
      breakdown.fulfillmentFeeTotal +
      breakdown.closingFeeTotal +
      breakdown.shippingPromotionTotal +
      breakdown.otherAmazonFeeTotal
  )

  return breakdown
}

module.exports = {
  emptyBreakdown,
  classifyOrderRowBucket,
  buildOrderFeeBreakdown,
  isFeeLike,
  isRefundReturnLikeRow,
  isSettlementReturnRow,
  collectSettlementReturnOrderIds,
  isNetNegativeOrderReturn,
  buildSyntheticRefundReturnFromOrder,
  detectNetNegativeOrderRefundRows,
  NET_NEGATIVE_ORDER_TOLERANCE,
  round2,
}
