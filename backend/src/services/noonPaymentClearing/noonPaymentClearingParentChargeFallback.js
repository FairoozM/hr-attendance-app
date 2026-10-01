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

function coerceMappedInvoice(inv) {
  if (!inv) return null
  if (inv.zohoInvoiceId || inv.matchKeys) {
    return {
      ...inv,
      zohoInvoiceId: clean(inv.zohoInvoiceId),
      zohoInvoiceNumber: clean(inv.zohoInvoiceNumber),
      zohoOrderNumber: clean(inv.zohoOrderNumber),
      zohoPoNumber: clean(inv.zohoPoNumber),
      matchKeys: Array.isArray(inv.matchKeys)
        ? inv.matchKeys.map(clean).filter(Boolean)
        : [inv.zohoOrderNumber, inv.zohoPoNumber].map(clean).filter(Boolean),
      zohoInvoiceTotal: num(inv.zohoInvoiceTotal),
      zohoCustomerId: clean(inv.zohoCustomerId),
      zohoCustomerName: clean(inv.zohoCustomerName),
    }
  }
  // Raw Zoho Books invoice shape
  const zohoPoNumber = clean(
    inv.reference_number || inv.purchaseorder_number || inv.po_number || inv.poNumber
  )
  const zohoOrderNumber = clean(inv.order_number || inv.orderNumber || inv.salesorder_number)
  return {
    zohoInvoiceId: clean(inv.invoice_id || inv.id),
    zohoInvoiceNumber: clean(inv.invoice_number || inv.number),
    zohoPoNumber,
    zohoOrderNumber,
    matchKeys: [zohoOrderNumber, zohoPoNumber].filter(Boolean),
    zohoInvoiceTotal: num(inv.total ?? inv.invoice_total),
    zohoCustomerId: clean(inv.customer_id || inv.customerId),
    zohoCustomerName: clean(inv.customer_name || inv.customerName),
  }
}

function normalizeInvoiceList(invoices = []) {
  return (Array.isArray(invoices) ? invoices : []).map(coerceMappedInvoice).filter((inv) => inv && inv.zohoInvoiceId)
}

const ASSIGNMENT_REASON = 'parent_order_fallback'
const ASSIGNMENT_REASON_LABEL = 'Parent-order fallback'
const ASSIGNMENT_REASON_ZOHO = 'zoho_invoice_orphan_parent'
const ASSIGNMENT_REASON_ZOHO_LABEL = 'Zoho invoice (not in this statement)'

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

const CAPACITY_TOLERANCE = 0.01

function parentChargeNeed(row) {
  return round2(Math.max(0, -num(row?.total)))
}

function remainingChildCapacity(child, usedCapacity) {
  const used = usedCapacity ? num(usedCapacity.get(matchKey(child.itemOrderId))) : 0
  return round2(num(child.total) - used)
}

/**
 * Lowest-suffix matched child whose statement Total can absorb `need` (a net parent charge
 * larger than the child's Total pushes the payment past its Zoho invoice). When no child
 * can absorb it, the child with the most remaining capacity.
 */
function matchedChildrenForParent(parentOrderId, matchedOrders) {
  const parent = clean(parentOrderId)
  if (!parent) return []
  return sortMatchedChildrenForFallback(matchedOrders).filter((m) =>
    isStrictChildOfParent(parent, m.itemOrderId)
  )
}

function findDeterministicChildForParent(parentOrderId, matchedOrders, need = 0, usedCapacity = null) {
  const children = matchedChildrenForParent(parentOrderId, matchedOrders)
  if (!children.length) return null
  if (num(need) < CAPACITY_TOLERANCE) return children[0]
  const fits = children.find(
    (c) => remainingChildCapacity(c, usedCapacity) + CAPACITY_TOLERANCE >= num(need)
  )
  if (fits) return fits
  return children.reduce((best, c) =>
    remainingChildCapacity(c, usedCapacity) > remainingChildCapacity(best, usedCapacity) ? c : best
  )
}

const SPLIT_AMOUNT_FIELDS = [
  'netProceed',
  'referralFee',
  'fulfillmentFee',
  'shippingCharges',
  'otherOrderFees',
  'orderSubsidies',
  'orderSubscriptionFees',
  'nonOrderFees',
  'nonOrderSubscriptionFees',
  'othersInclVat',
  'total',
]

/**
 * When no single child can absorb a parent charge, divide it across the children in
 * proportion to their remaining capacity. Returns null when the children together
 * cannot absorb it either.
 */
function planProportionalSplit(children, need, usedCapacity) {
  const candidates = children
    .map((child) => ({ child, capacity: remainingChildCapacity(child, usedCapacity) }))
    .filter((c) => c.capacity >= CAPACITY_TOLERANCE)
  if (candidates.length < 2) return null
  const totalCapacity = round2(candidates.reduce((sum, c) => sum + c.capacity, 0))
  if (totalCapacity + CAPACITY_TOLERANCE < need) return null
  return candidates.map((c) => ({ child: c.child, share: c.capacity / totalCapacity }))
}

/** Cent remainders land on the part with the largest share so small invoices never overflow. */
function splitRowAmounts(row, plan) {
  const remainderIndex = plan.reduce((best, p, i) => (p.share > plan[best].share ? i : best), 0)
  const parts = plan.map(() => ({}))
  for (const field of SPLIT_AMOUNT_FIELDS) {
    const value = num(row[field])
    let allocated = 0
    plan.forEach((p, i) => {
      if (i === remainderIndex) return
      parts[i][field] = round2(value * p.share)
      allocated = round2(allocated + parts[i][field])
    })
    parts[remainderIndex][field] = round2(value - allocated)
  }
  return parts
}

function splitOriginalAmounts(row) {
  return Object.fromEntries(SPLIT_AMOUNT_FIELDS.map((field) => [field, num(row[field])]))
}

/** Collapse previously split parts back to the original statement row before re-assigning. */
function mergeSplitParentRows(rows) {
  const out = []
  const seen = new Set()
  for (const row of rows) {
    if (!row || !row.splitOriginalAmounts) {
      out.push(row)
      continue
    }
    if (seen.has(row.rowNumber)) continue
    seen.add(row.rowNumber)
    // Exclusions are per part; callers re-apply them by statementRowKey after re-splitting.
    const {
      splitPart,
      splitCount,
      splitShare,
      splitOriginalAmounts: original,
      excludeFromPaymentClearing,
      excludeReason,
      ...rest
    } = row
    out.push({ ...rest, ...original })
  }
  return out
}

/** Unique key for a statement row; split parts share the statement rowNumber. */
function statementRowKey(row) {
  const part = num(row?.splitPart)
  return part ? `${row.rowNumber}#${part}` : String(row?.rowNumber)
}

/**
 * When this statement has no sale child, find Zoho invoices already created for that Noon parent.
 * Prefer item-level IDs (NAEI…-1); fall back to parent-level order id on the invoice.
 */
function findZohoInvoiceForOrphanParent(parentOrderId, invoices = []) {
  const parent = clean(parentOrderId)
  if (!parent) return null
  const list = normalizeInvoiceList(invoices)
  const childHits = []
  const parentHits = []

  for (const inv of list) {
    const keys = [
      ...(Array.isArray(inv.matchKeys) ? inv.matchKeys : []),
      inv.zohoOrderNumber,
      inv.zohoPoNumber,
      inv.itemOrderId,
    ]
      .map(clean)
      .filter(Boolean)

    for (const key of keys) {
      if (isStrictChildOfParent(parent, key)) {
        childHits.push({
          ...inv,
          itemOrderId: key,
          parentOrderId: parent,
          matchStatus: 'matched',
          matchType: ASSIGNMENT_REASON_ZOHO,
          logisticsOnly: true,
          netProceed: 0,
          referralFee: 0,
          fulfillmentFee: 0,
          shippingCharges: 0,
          zohoCustomerId: inv.zohoCustomerId || '',
          zohoCustomerName: inv.zohoCustomerName || '',
        })
        break
      }
      if (matchKey(key) === matchKey(parent)) {
        parentHits.push({
          ...inv,
          itemOrderId: parent,
          parentOrderId: parent,
          matchStatus: 'matched',
          matchType: `${ASSIGNMENT_REASON_ZOHO}_parent_id`,
          logisticsOnly: true,
          netProceed: 0,
          referralFee: 0,
          fulfillmentFee: 0,
          shippingCharges: 0,
          zohoCustomerId: inv.zohoCustomerId || '',
          zohoCustomerName: inv.zohoCustomerName || '',
        })
        break
      }
    }
  }

  const pool = childHits.length ? childHits : parentHits
  if (!pool.length) return null

  // Dedupe by invoice id, prefer lowest child suffix.
  const byInvoice = new Map()
  for (const hit of pool) {
    const id = clean(hit.zohoInvoiceId)
    if (!id) continue
    if (!byInvoice.has(id)) byInvoice.set(id, hit)
  }
  return sortMatchedChildrenForFallback(Array.from(byInvoice.values()))[0] || null
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

function assignParentRow(row, child, reason, reasonLabel, status) {
  const originalParentOrderId = clean(row.parentOrderId)
  const assignedItemOrderId = clean(child.itemOrderId)
  return {
    ...row,
    originalParentOrderId,
    itemOrderId: '',
    assignedItemOrderId,
    assignedZohoInvoiceId: clean(child.zohoInvoiceId),
    assignedZohoInvoiceNumber: clean(child.zohoInvoiceNumber),
    assignmentReason: reason,
    assignmentReasonLabel: reasonLabel,
    parentFallbackStatus: status,
    normalizedFeeType: row.normalizedFeeType || normalizeNoonFeeType(row),
    displayLabel: displayLabelForFeeRow(row),
    accountingTreatment: accountingTreatmentForFeeRow(row),
    signedAmount: round2(num(row.total)),
  }
}

/**
 * Attach parent-level shipping/logistics/other charges to one matched child invoice.
 * 1) Prefer a child sale already matched in this statement.
 * 2) Else match Zoho invoices for that parent order (item-level or parent id).
 *
 * Returns { rows, syntheticMatchedOrders } — synthetic entries are Zoho invoices
 * needed for logistics-only payments when the sale is not in this statement.
 */
function applyParentOrderChargeFallbackWithSynthetics(rows, matchedOrders = [], zohoInvoices = []) {
  const list = mergeSplitParentRows(Array.isArray(rows) ? rows : [])
  const assignmentCounts = new Map()
  const syntheticMatched = []
  const syntheticByItem = new Map()
  const usedCapacity = new Map()

  const annotated = list.flatMap((row) => {
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
    const need = parentChargeNeed(row)
    let child = findDeterministicChildForParent(originalParentOrderId, matchedOrders, need, usedCapacity)
    const splitPlan =
      child && remainingChildCapacity(child, usedCapacity) + CAPACITY_TOLERANCE < need
        ? planProportionalSplit(
            matchedChildrenForParent(originalParentOrderId, matchedOrders),
            need,
            usedCapacity
          )
        : null
    if (splitPlan) {
      const original = splitOriginalAmounts(row)
      const amounts = splitRowAmounts(row, splitPlan)
      return splitPlan.map((p, i) => {
        const childKey = matchKey(p.child.itemOrderId)
        const partNeed = parentChargeNeed(amounts[i])
        usedCapacity.set(childKey, round2(num(usedCapacity.get(childKey)) + partNeed))
        return assignParentRow(
          {
            ...row,
            ...amounts[i],
            splitPart: i + 1,
            splitCount: splitPlan.length,
            splitShare: round2(p.share * 10000) / 10000,
            splitOriginalAmounts: original,
          },
          p.child,
          ASSIGNMENT_REASON,
          `${ASSIGNMENT_REASON_LABEL} (split ${i + 1}/${splitPlan.length})`,
          'assigned_split'
        )
      })
    }
    if (child) {
      const childKey = matchKey(child.itemOrderId)
      usedCapacity.set(childKey, round2(num(usedCapacity.get(childKey)) + need))
    }
    let reason = ASSIGNMENT_REASON
    let reasonLabel = ASSIGNMENT_REASON_LABEL
    let status = 'assigned'

    if (!child) {
      child = findZohoInvoiceForOrphanParent(originalParentOrderId, zohoInvoices)
      if (child) {
        reason = ASSIGNMENT_REASON_ZOHO
        reasonLabel = ASSIGNMENT_REASON_ZOHO_LABEL
        status = 'assigned_zoho_orphan'
        const itemKey = matchKey(child.itemOrderId)
        if (itemKey && !syntheticByItem.has(itemKey)) {
          // Avoid duplicating a statement-matched child.
          const alreadyMatched = (matchedOrders || []).some(
            (m) => matchKey(m.itemOrderId) === itemKey || matchKey(m.zohoInvoiceId) === matchKey(child.zohoInvoiceId)
          )
          if (!alreadyMatched) {
            syntheticByItem.set(itemKey, child)
            syntheticMatched.push(child)
          }
        }
      }
    }

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

    const key = `${matchKey(originalParentOrderId)}|${row.rowNumber}`
    if (assignmentCounts.has(key)) {
      return row
    }
    assignmentCounts.set(key, clean(child.itemOrderId))
    return assignParentRow(row, child, reason, reasonLabel, status)
  })

  return {
    rows: annotated,
    syntheticMatchedOrders: syntheticMatched,
  }
}

/** Back-compat: returns annotated rows only. */
function applyParentOrderChargeFallback(rows, matchedOrders = [], zohoInvoices = []) {
  return applyParentOrderChargeFallbackWithSynthetics(rows, matchedOrders, zohoInvoices).rows
}

module.exports = {
  ASSIGNMENT_REASON,
  ASSIGNMENT_REASON_LABEL,
  ASSIGNMENT_REASON_ZOHO,
  ASSIGNMENT_REASON_ZOHO_LABEL,
  sortMatchedChildrenForFallback,
  findDeterministicChildForParent,
  findZohoInvoiceForOrphanParent,
  needsParentOrderFallback,
  mergeSplitParentRows,
  statementRowKey,
  applyParentOrderChargeFallback,
  applyParentOrderChargeFallbackWithSynthetics,
  isStrictChildOfParent,
}
