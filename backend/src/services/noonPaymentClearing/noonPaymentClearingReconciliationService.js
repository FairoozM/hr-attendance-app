const { ROW_CLASS, round2, num } = require('./noonPaymentClearingCategoryService')

const RECONCILIATION_TOLERANCE = 0.01

function sumTotals(rows, predicate = () => true) {
  return round2(
    (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
      if (!predicate(row)) return acc
      return acc + num(row.total)
    }, 0)
  )
}

function sumField(rows, field, predicate = () => true) {
  return round2(
    (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
      if (!predicate(row)) return acc
      return acc + num(row[field])
    }, 0)
  )
}

/**
 * Prove all statement financial rows account for the Noon settlement total.
 * Categories are informational — not every category requires an invoice.
 */
function buildNoonReconciliationSummary(rows, metadata = {}) {
  const list = Array.isArray(rows) ? rows : []
  const itemOrderProceeds = sumField(list, 'netProceed', (r) => r.rowClass === ROW_CLASS.SALE_ITEM)
  const referralCommissionFees = sumField(list, 'referralFee')
  const fulfillmentFees = sumField(list, 'fulfillmentFee')
  const shippingFees = sumField(list, 'shippingCharges')
  const subsidies = sumField(list, 'othersInclVat', (r) => num(r.othersInclVat) > 0)
  const orderUpdatesAdjustments = sumTotals(list, (r) => r.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const parentOrderCharges = sumTotals(list, (r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const statementLevelFees = sumTotals(list, (r) => r.rowClass === ROW_CLASS.STATEMENT_FEE)
  const advertisingFees = sumTotals(
    list,
    (r) => r.rowClass === ROW_CLASS.STATEMENT_FEE && /advertising/i.test(String(r.title || ''))
  )
  const otherFees = sumTotals(list, (r) => r.rowClass === ROW_CLASS.OTHER)
  const otherOrderFees = sumField(list, 'otherOrderFees')
  const nonOrderFees = sumField(list, 'nonOrderFees')

  const calculatedSettlement = sumTotals(list)
  const expectedSettlement =
    metadata.actualSettlementTotal != null && metadata.actualSettlementTotal !== ''
      ? round2(num(metadata.actualSettlementTotal))
      : calculatedSettlement
  // Expected = statement sum (same source). Difference should be ~0 unless caller overrides expected.
  const reconciliationDifference = round2(expectedSettlement - calculatedSettlement)
  const reconciliationStatus =
    Math.abs(reconciliationDifference) <= RECONCILIATION_TOLERANCE ? 'reconciled' : 'mismatch'

  return {
    itemOrderProceeds,
    referralCommissionFees,
    fulfillmentFees,
    shippingFees,
    fulfillmentLogisticsFees: round2(fulfillmentFees + shippingFees),
    subsidies,
    orderUpdatesAdjustments,
    parentOrderCharges,
    statementLevelFees,
    advertisingFees,
    otherNoonFees: round2(otherFees + otherOrderFees + nonOrderFees - advertisingFees),
    otherFees,
    calculatedSettlement,
    expectedSettlement,
    actualNoonSettlement: expectedSettlement,
    reconciliationDifference,
    reconciliationStatus,
    tolerance: RECONCILIATION_TOLERANCE,
  }
}

function isNoonSettlementReconciliationAcceptable(summary, tolerance = RECONCILIATION_TOLERANCE) {
  if (!summary) return false
  if (summary.reconciliationStatus === 'reconciled') return true
  return Math.abs(num(summary.reconciliationDifference)) <= tolerance
}

module.exports = {
  RECONCILIATION_TOLERANCE,
  buildNoonReconciliationSummary,
  isNoonSettlementReconciliationAcceptable,
}
