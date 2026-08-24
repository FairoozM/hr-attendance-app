const { round2, num, clean, ROW_CLASS } = require('./noonPaymentClearingCategoryService')
const {
  buildSaleParentOrderIdSet,
  parentOrderIdForRow,
  positiveAmount,
} = require('./noonPaymentClearingRowPredicates')
const {
  isSettlementAdjustmentSourceRow,
  isZeroSaleCrossWeekLogisticsSettlementRow,
  collectSettlementAdjustmentSourceRows,
} = require('./noonPaymentClearingSettlementAdjustmentService')
const {
  buildNoonReturnFeeBreakdown,
  reclassifyReturnRows,
  returnFulfillment1066Impact,
} = require('./noonPaymentClearingReturnService')

function signedParentRowFulfillment(row) {
  if (Math.abs(num(row.total)) >= 0.01) {
    return round2(num(row.total))
  }
  return round2(
    num(row.fulfillmentFee) +
      num(row.shippingCharges) +
      num(row.otherOrderFees) +
      num(row.othersInclVat) +
      num(row.orderSubsidies)
  )
}

function parentFulfillmentChargeMagnitude(signedNet) {
  return positiveAmount(Math.min(0, round2(num(signedNet))))
}

function rowItemLogisticsFees(row) {
  return round2(num(row.fulfillmentFee) + num(row.shippingCharges))
}

function expected1066Contribution(row, ctx) {
  const { planExclusions, adjSourceByRow, saleParentSet } = ctx
  const total = round2(num(row.total))
  const isAdvertising = row.rowClass === ROW_CLASS.STATEMENT_FEE
  const isSettlementAdj = isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet)
  const adjLine = adjSourceByRow.get(row.rowNumber)

  if (isAdvertising) {
    return round2(-Math.abs(total))
  }
  if (isSettlementAdj) {
    return adjLine ? round2(num(adjLine.undepositedImpact)) : total
  }
  if (row.rowClass === ROW_CLASS.SALE_ITEM) {
    if (num(row.netProceed) < 0.01) {
      return round2(num(row.total))
    }
    // Row Total is the net cash/1066-bound amount; fees route to 1067/1068 via Record Payment.
    return round2(num(row.total))
  }
  if (
    (row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE || row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT) &&
    saleParentSet.has(parentOrderIdForRow(row))
  ) {
    return total
  }
  return total
}

function classifyRowAccounting(row, ctx) {
  const { saleParentSet, planExclusions, adjSourceByRow, invoicePaymentByItem, matchedReturnsByItem } = ctx
  const parent = parentOrderIdForRow(row)
  const saleInStatement = saleParentSet.has(parent)
  const isSale = row.rowClass === ROW_CLASS.SALE_ITEM
  const isReturn = row.rowClass === ROW_CLASS.RETURN
  const isAdvertising = row.rowClass === ROW_CLASS.STATEMENT_FEE
  const isSettlementAdj = isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet)
  const adjLine = adjSourceByRow.get(row.rowNumber)
  const expected1066 = expected1066Contribution(row, ctx)

  if (isReturn) {
    const breakdown = buildNoonReturnFeeBreakdown(row)
    const matched = matchedReturnsByItem.get(clean(row.itemOrderId))
    const blocked = matched?.status === 'blocked' || Boolean(matched?.blockCode)
    const cnRefund1066 = matched?.status === 'matched' ? round2(-breakdown.productRefundAmount) : 0
    const commissionRev1066 = breakdown.commissionReversalGross
    const fulfillment1066 = returnFulfillment1066Impact(row, breakdown, matched)
    const planned1066 = round2(cnRefund1066 + commissionRev1066 + fulfillment1066)
    const hasFulfillment1066 = Math.abs(fulfillment1066) >= 0.01
    return {
      classification: blocked ? 'return_blocked' : 'return_settlement',
      recordPayment1066: 0,
      recordPayment1068: 0,
      settlementAdjustment1066: 0,
      returnCreditNote1066: cnRefund1066,
      returnCommissionReversal1066: commissionRev1066,
      returnFulfillment1066: fulfillment1066,
      expected1066,
      reason: blocked
        ? matched?.blockCode || 'RETURN_BLOCKED'
        : hasFulfillment1066
          ? 'Product refund via CN + commission / fulfillment return journals'
          : 'Product refund via CN + commission reversal journal',
      planned1066Contribution: planned1066,
    }
  }

  if (isAdvertising) {
    return {
      classification: 'advertising_journal',
      recordPayment1066: 0,
      recordPayment1068: 0,
      settlementAdjustment1066: round2(-Math.abs(num(row.total))),
      expected1066,
      reason: 'Statement advertising fee journal Cr 1066',
      planned1066Contribution: round2(-Math.abs(num(row.total))),
    }
  }

  const zeroSaleLogistics =
    isSale && num(row.netProceed) < 0.01 && isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet)
  const plan = isSale ? invoicePaymentByItem.get(clean(row.itemOrderId)) : null
  const rp1066FromPlan = plan ? round2(num(plan.netBalancePayment?.amount)) : 0
  const rp1068FromPlan = plan ? round2(num(plan.fulfillmentPayment?.amount)) : 0

  if (
    zeroSaleLogistics &&
    plan &&
    rp1068FromPlan >= 0.01 &&
    Math.abs(rp1066FromPlan) < 0.01 &&
    !adjSourceByRow.has(row.rowNumber)
  ) {
    return {
      classification: 'zero_sale_logistics_misrouted_to_record_payment',
      recordPayment1066: rp1066FromPlan,
      recordPayment1068: rp1068FromPlan,
      settlementAdjustment1066: 0,
      expected1066,
      reason: 'ZERO_SALE_LOGISTICS_ROUTED_TO_1068',
      planned1066Contribution: rp1066FromPlan,
    }
  }

  if (isSettlementAdj) {
    const impact = adjLine ? num(adjLine.undepositedImpact) : round2(num(row.total))
    const isZeroSaleLogistics = isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet)
    return {
      classification: adjLine?.paidInvoiceSubsidy
        ? 'settlement_adjustment_paid_invoice_subsidy'
        : isZeroSaleLogistics
          ? 'settlement_adjustment_zero_sale_logistics'
          : 'settlement_adjustment_cross_week',
      recordPayment1066: 0,
      recordPayment1068: 0,
      settlementAdjustment1066: impact,
      expected1066,
      reason: isZeroSaleLogistics
        ? 'ZERO_SALE_LOGISTICS_SETTLEMENT_ADJUSTMENT'
        : 'Cross-week / paid-invoice subsidy settlement adjustment journal',
      planned1066Contribution: impact,
    }
  }
  if (isSale) {
    return {
      classification: 'record_payment_sale_1066',
      recordPayment1066: rp1066FromPlan,
      recordPayment1068: rp1068FromPlan,
      settlementAdjustment1066: 0,
      expected1066,
      reason: 'Sale row net undeposited via Record Payment',
      planned1066Contribution: rp1066FromPlan,
    }
  }
  if (
    (row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE || row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT) &&
    saleInStatement
  ) {
    return {
      classification: 'in_statement_parent_fold',
      recordPayment1066: 0,
      recordPayment1068: 0,
      settlementAdjustment1066: 0,
      expected1066,
      reason:
        'Same-week parent/adjustment folded into assigned sale invoice clearing (1066 via child net balance)',
      planned1066Contribution: 0,
    }
  }
  return {
    classification: 'UNCLASSIFIED_CASH_EFFECT',
    recordPayment1066: 0,
    recordPayment1068: 0,
    settlementAdjustment1066: 0,
    expected1066,
    reason: 'No accounting destination mapped for this row',
    planned1066Contribution: 0,
  }
}

function filterActionableNonZeroDeltas(candidateRows = []) {
  const foldGroupDelta = new Map()
  for (const row of candidateRows) {
    if (Math.abs(num(row.delta)) < 0.01) continue
    if (row.classification === 'in_statement_parent_fold') {
      const key = clean(row.assignedItemOrderId || row.itemOrderId)
      if (!key) continue
      foldGroupDelta.set(key, round2((foldGroupDelta.get(key) || 0) + num(row.delta)))
    }
    if (row.classification === 'record_payment_sale_1066') {
      const key = clean(row.itemOrderId)
      if (!key) continue
      foldGroupDelta.set(key, round2((foldGroupDelta.get(key) || 0) + num(row.delta)))
    }
  }

  return candidateRows.filter((row) => {
    if (Math.abs(num(row.delta)) < 0.01) return false
    if (row.reason === 'ZERO_SALE_LOGISTICS_ROUTED_TO_1068') return true
    if (row.classification === 'return_blocked') return true
    if (row.classification === 'UNCLASSIFIED_CASH_EFFECT') return true
    if (row.classification === 'in_statement_parent_fold') return false
    if (row.classification === 'record_payment_sale_1066') {
      const key = clean(row.itemOrderId)
      const groupNet = key ? foldGroupDelta.get(key) : null
      if (groupNet != null && Math.abs(groupNet) < 0.01) return false
    }
    return true
  })
}

function buildUndepositedReconciliation(batch, preview, planExclusions = null) {
  const rawRows = batch?.allRows || []
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const saleParentSet = buildSaleParentOrderIdSet(rawRows)
  const allRows = reclassifyReturnRows(rawRows, saleParentSet)
  const adjSources = collectSettlementAdjustmentSourceRows(allRows, planExclusions)
  const adjSourceByRow = new Map(
    (preview?.settlementAdjustmentJournal?.sourceLines || []).map((line) => [line.rowNumber, line])
  )
  const invoicePaymentByItem = new Map(
    (preview?.invoicePayments || []).map((p) => [clean(p.itemOrderId), p])
  )
  const matchedReturnsByItem = new Map(
    (preview?.matchedReturns || batch?.matchedReturns || []).map((row) => [clean(row.itemOrderId), row])
  )

  const expectedBankPayout = round2(num(preview?.summary?.expectedNoonSettlement))
  const advertising1066 = round2(
    (preview?.feeJournalLines || []).reduce((sum, line) => sum + Math.abs(num(line.amount)), 0)
  )
  const targetBeforeAdvertising = round2(
    num(preview?.summary?.targetUndeposited1066) ||
      allRows
        .filter((row) => row.rowClass !== ROW_CLASS.STATEMENT_FEE)
        .reduce((sum, row) => sum + num(row.total), 0)
  )
  const recordPayment1066 = round2(num(preview?.summary?.recordPayment1066))
  const settlementAdjustment1066Impact = round2(num(preview?.summary?.settlementAdjustment1066))
  const returnPrincipal1066 = round2(num(preview?.summary?.returnPrincipal1066))
  const returnFeeReversal1066 = round2(num(preview?.summary?.returnFeeReversal1066))
  const returnFulfillment1066 = round2(num(preview?.summary?.returnFulfillment1066))
  const plannedBeforeAdvertising = round2(
    recordPayment1066 +
      settlementAdjustment1066Impact +
      returnPrincipal1066 +
      returnFeeReversal1066 +
      returnFulfillment1066
  )
  const difference = round2(targetBeforeAdvertising - plannedBeforeAdvertising)

  const ctx = {
    saleParentSet,
    planExclusions,
    adjSourceByRow,
    invoicePaymentByItem,
    matchedReturnsByItem,
    advertising1066,
  }

  const candidateRows = allRows
    .filter((row) => row.rowClass !== ROW_CLASS.STATEMENT_FEE)
    .map((row) => {
      const cls = classifyRowAccounting(row, ctx)
      const planned1066Contribution = round2(
        cls.planned1066Contribution != null
          ? cls.planned1066Contribution
          : cls.recordPayment1066 + cls.settlementAdjustment1066
      )
      const expected1066Contribution = round2(cls.expected1066)
      const delta = round2(expected1066Contribution - planned1066Contribution)
      return {
        rowNumber: row.rowNumber,
        rowClass: row.rowClass,
        transactionType: clean(row.transactionType),
        parentOrderId: parentOrderIdForRow(row),
        itemOrderId: clean(row.itemOrderId),
        assignedItemOrderId: clean(row.assignedItemOrderId),
        sku: clean(row.sku || row.partnerSku),
        rawTotal: round2(num(row.total)),
        signedAmount: round2(num(row.total)),
        saleInStatement: saleParentSet.has(parentOrderIdForRow(row)),
        sameWeekVsCrossWeek: saleParentSet.has(parentOrderIdForRow(row))
          ? 'same_week'
          : row.rowClass === ROW_CLASS.SALE_ITEM
            ? 'sale'
            : 'cross_week',
        assignedZohoInvoiceId: clean(row.assignedZohoInvoiceId || row.zohoInvoiceId),
        assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber || row.zohoInvoiceNumber),
        logisticsOnly: Boolean(row.logisticsOnly),
        settlementAdjustment: Boolean(adjSourceByRow.has(row.rowNumber)),
        recordPayment: cls.classification.startsWith('record_payment'),
        classification: cls.classification,
        expected1066Contribution,
        planned1066Contribution,
        recordPayment1066: round2(cls.recordPayment1066),
        recordPayment1068: round2(cls.recordPayment1068),
        settlementAdjustment1066: round2(cls.settlementAdjustment1066),
        returnCreditNote1066: round2(cls.returnCreditNote1066 || 0),
        returnCommissionReversal1066: round2(cls.returnCommissionReversal1066 || 0),
        returnFulfillment1066: round2(cls.returnFulfillment1066 || 0),
        delta,
        reason: cls.reason,
      }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const deltaSum = round2(candidateRows.reduce((sum, row) => sum + num(row.delta), 0))

  return {
    statementReference: clean(metadata.referenceNr),
    targetBeforeAdvertising,
    plannedBeforeAdvertising,
    difference,
    deltaSum,
    reconcilesToDifference: Math.abs(round2(deltaSum - difference)) < 0.01,
    targetComponents: {
      expectedBankPayout,
      advertising1066,
      statementSubtotalNonFee: targetBeforeAdvertising,
    },
    plannedComponents: {
      recordPayment1066,
      settlementAdjustment1066Impact,
      returnPrincipal1066,
      returnFeeReversal1066,
      returnFulfillment1066,
    },
    candidateRows,
    nonZeroDeltas: filterActionableNonZeroDeltas(candidateRows),
  }
}

module.exports = {
  signedParentRowFulfillment,
  parentFulfillmentChargeMagnitude,
  expected1066Contribution,
  classifyRowAccounting,
  buildUndepositedReconciliation,
}
