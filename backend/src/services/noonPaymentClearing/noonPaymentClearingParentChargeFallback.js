const {
  ROW_CLASS,
  round2,
  num,
  clean,
  normalizeNoonFeeType,
  displayLabelForFeeRow,
  accountingTreatmentForFeeRow,
} = require('./noonPaymentClearingCategoryService')
const { isStrictChildOfParent, parseNoonOrderId, matchKey } = require('./noonOrderIdHelper')

const ASSIGNMENT_REASON = 'parent_order_fallback'
const ASSIGNMENT_REASON_LABEL = 'Parent-order fallback'

/**
 * Deterministic pick: lowest numeric child suffix, then lexicographic item id.
 */
function sortMatchedChildrenForFallback(matchedOrders) {
  return [...(Array.isArray(matchedOrders) ? matchedOrders : [])]
    .filter((m) => m && m.matchStatus === 'matched' && clean(m.itemOrderId))
    .sort((a, b) => {
      const pa = parseNoonOrderId(a.itemOrderId)
      const pb = parseNoonOrderId(b.itemOrderId)
      const sa = Number(pa.itemSuffix)
      const sb = Number(pb.itemSuffix)
      const aNum = Number.isFinite(sa) ? sa : Number.POSITIVE_INFINITY
      const bNum = Number.isFinite(sb) ? sb : Number.POSITIVE_INFINITY
      if (aNum !== bNum) return aNum - bNum
      return clean(a.itemOrderId).localeCompare(clean(b.itemOrderId))
    })
}

function findDeterministicChildForParent(parentOrderId, matchedOrders) {
  const parent = clean(parentOrderId)
  if (!parent) return null
  const children = sortMatchedChildrenForFallback(matchedOrders).filter((m) =>
    isStrictChildOfParent(parent, m.itemOrderId)
  )
  return children[0] || null
}

function needsParentOrderFallback(row) {
  if (!row) return false
  if (row.rowClass !== ROW_CLASS.PARENT_ORDER_CHARGE && row.rowClass !== ROW_CLASS.ORDER_ADJUSTMENT) {
    return false
  }
  const parent = clean(row.parentOrderId)
  if (!parent) return false
  // Only when the Noon row itself has no distinct item-level ID.
  if (clean(row.itemOrderId)) return false
  return Math.abs(num(row.total)) >= 0.01
}

/**
 * Attach parent-level shipping/logistics/other charges to one matched child invoice.
 * Does not change original parent/item order ids on the Noon row; adds assignment fields.
 * Each charge is assigned exactly once.
 */
function applyParentOrderChargeFallback(rows, matchedOrders = []) {
  const list = Array.isArray(rows) ? rows : []
  const assignmentCounts = new Map()

  return list.map((row) => {
    if (!needsParentOrderFallback(row)) {
      return {
        ...row,
        originalParentOrderId: clean(row.parentOrderId) || clean(row.originalParentOrderId),
        assignedItemOrderId: clean(row.assignedItemOrderId),
        assignmentReason: clean(row.assignmentReason),
        assignmentReasonLabel: clean(row.assignmentReasonLabel),
      }
    }

    const originalParentOrderId = clean(row.parentOrderId)
    const child = findDeterministicChildForParent(originalParentOrderId, matchedOrders)
    if (!child) {
      return {
        ...row,
        originalParentOrderId,
        assignedItemOrderId: '',
        assignmentReason: '',
        assignmentReasonLabel: '',
        parentFallbackStatus: 'no_matched_child',
      }
    }

    const assignedItemOrderId = clean(child.itemOrderId)
    const key = `${matchKey(originalParentOrderId)}|${row.rowNumber}`
    if (assignmentCounts.has(key)) {
      // Should never happen per-row; guard against duplicate application.
      return row
    }
    assignmentCounts.set(key, assignedItemOrderId)

    return {
      ...row,
      originalParentOrderId,
      // Keep Noon itemOrderId empty — do not pretend the statement had the child id.
      itemOrderId: '',
      assignedItemOrderId,
      assignedZohoInvoiceId: clean(child.zohoInvoiceId),
      assignedZohoInvoiceNumber: clean(child.zohoInvoiceNumber),
      assignmentReason: ASSIGNMENT_REASON,
      assignmentReasonLabel: ASSIGNMENT_REASON_LABEL,
      parentFallbackStatus: 'assigned',
      normalizedFeeType: row.normalizedFeeType || normalizeNoonFeeType(row),
      displayLabel: displayLabelForFeeRow(row),
      accountingTreatment: accountingTreatmentForFeeRow(row),
      signedAmount: round2(num(row.total)),
    }
  })
}

module.exports = {
  ASSIGNMENT_REASON,
  ASSIGNMENT_REASON_LABEL,
  sortMatchedChildrenForFallback,
  findDeterministicChildForParent,
  needsParentOrderFallback,
  applyParentOrderChargeFallback,
  isStrictChildOfParent,
}
