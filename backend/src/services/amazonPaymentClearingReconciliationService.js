const { CATEGORY } = require('./amazonPaymentClearingCategoryService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')

const RECONCILIATION_TOLERANCE = 0.01

function sumBy(rows, predicate = () => true) {
  return round2((Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    if (!predicate(row)) return acc
    return acc + (Number(row.total) || 0)
  }, 0))
}

function buildReconciliationSummary({
  matchedOrders = [],
  refundReturnTotal = 0,
  settlementLevelFees = [],
  actualAmazonSettlement = 0,
} = {}) {
  const orderLevelNetBalance = round2(
    (Array.isArray(matchedOrders) ? matchedOrders : []).reduce(
      (acc, row) => acc + (Number(row.netSettlementAmount) || 0),
      0
    )
  )
  const settlementLevelDeductions = sumBy(settlementLevelFees)
  const advertisingFeeTotal = sumBy(settlementLevelFees, (row) => row.category === CATEGORY.ADVERTISING_FEE)
  const premiumServiceFeeTotal = sumBy(settlementLevelFees, (row) => row.category === CATEGORY.PREMIUM_SERVICES_FEE)
  const premiumServiceFeeTaxTotal = sumBy(
    settlementLevelFees,
    (row) => row.category === CATEGORY.PREMIUM_SERVICES_FEE_TAX
  )
  const storageFeeTotal = sumBy(settlementLevelFees, (row) => row.category === CATEGORY.STORAGE_FEE)
  const easyShipChargesTotal = sumBy(settlementLevelFees, (row) => row.category === CATEGORY.EASY_SHIP_CHARGES)
  const knownSettlementFeeTotal = round2(
    advertisingFeeTotal +
      premiumServiceFeeTotal +
      premiumServiceFeeTaxTotal +
      storageFeeTotal +
      easyShipChargesTotal
  )
  const otherSettlementFeeTotal = round2(settlementLevelDeductions - knownSettlementFeeTotal)
  const refundReturnImpact = round2(refundReturnTotal)
  const expectedAmazonDeposit = round2(orderLevelNetBalance + refundReturnImpact + settlementLevelDeductions)
  const actualSettlement = round2(actualAmazonSettlement)
  const reconciliationDifference = round2(actualSettlement - expectedAmazonDeposit)
  const reconciliationStatus =
    Math.abs(reconciliationDifference) <= RECONCILIATION_TOLERANCE ? 'reconciled' : 'mismatch'

  return {
    orderLevelNetBalance,
    refundReturnImpact,
    settlementLevelDeductions,
    advertisingFeeTotal,
    premiumServiceFeeTotal,
    premiumServiceFeeTaxTotal,
    storageFeeTotal,
    easyShipChargesTotal,
    otherSettlementFeeTotal,
    expectedAmazonDeposit,
    actualAmazonSettlement: actualSettlement,
    reconciliationDifference,
    reconciliationStatus,
  }
}

module.exports = {
  RECONCILIATION_TOLERANCE,
  buildReconciliationSummary,
}
