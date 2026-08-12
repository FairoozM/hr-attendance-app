const { round2, num, clean, ROW_CLASS } = require('./noonPaymentClearingCategoryService')
const {
  buildSaleParentOrderIdSet,
  parentOrderIdForRow,
  isSettlementAdjustmentSourceRow,
  collectSettlementAdjustmentSourceRows,
} = require('./noonPaymentClearingSettlementAdjustmentService')

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

function positiveAmount(value) {
  return Math.abs(round2(Number(value) || 0))
}

function classifyRowAccounting(row, ctx) {
  const {
    saleParentSet,
    planExclusions,
    adjSourceByRow,
    invoicePaymentByItem,
    advertising1066,
  } = ctx
  const parent = parentOrderIdForRow(row)
  const saleInStatement = saleParentSet.has(parent)
  const isSale = row.rowClass === ROW_CLASS.SALE_ITEM
  const isAdvertising = row.rowClass === ROW_CLASS.STATEMENT_FEE
  const isSettlementAdj = isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet)
  const adjLine = adjSourceByRow.get(row.rowNumber)

  if (isAdvertising) {
    return {
      classification: 'advertising_journal',
      recordPayment1066: 0,
      settlementAdjustment1066: round2(-Math.abs(num(row.total))),
      expected1066: round2(-Math.abs(num(row.total))),
      reason: 'Statement advertising fee journal Cr 1066',
    }
  }
  if (isSettlementAdj) {
    const impact = adjLine ? num(adjLine.undepositedImpact) : round2(num(row.total))
    return {
      classification: adjLine?.paidInvoiceSubsidy
        ? 'settlement_adjustment_paid_invoice_subsidy'
        : 'settlement_adjustment_cross_week',
      recordPayment1066: 0,
      settlementAdjustment1066: impact,
      expected1066: impact,
      reason: 'Cross-week / paid-invoice subsidy settlement adjustment journal',
    }
  }
  if (isSale) {
    const plan = invoicePaymentByItem.get(clean(row.itemOrderId))
    const actual = plan ? num(plan.netBalancePayment?.amount) : 0
    return {
      classification: 'record_payment_sale_1066',
      recordPayment1066: actual,
      settlementAdjustment1066: 0,
      expected1066: actual,
      reason: 'Sale row net undeposited via Record Payment',
    }
  }
  if (
    (row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE || row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT) &&
    saleInStatement
  ) {
    const signed = signedParentRowFulfillment(row)
    return {
      classification: 'in_statement_parent_fold',
      recordPayment1066: signed,
      settlementAdjustment1066: 0,
      expected1066: signed,
      reason:
        'Same-week parent/adjustment folded into sale invoice clearing (signed net, not |total|)',
    }
  }
  return {
    classification: 'UNCLASSIFIED_CASH_EFFECT',
    recordPayment1066: 0,
    settlementAdjustment1066: 0,
    expected1066: round2(num(row.total)),
    reason: 'No accounting destination mapped for this row',
  }
}

function buildUndepositedReconciliation(batch, preview, planExclusions = null) {
  const allRows = batch?.allRows || []
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const saleParentSet = buildSaleParentOrderIdSet(allRows)
  const adjSources = collectSettlementAdjustmentSourceRows(allRows, planExclusions)
  const adjSourceByRow = new Map(adjSources.map((line) => [line.rowNumber, line]))
  const invoicePaymentByItem = new Map(
    (preview?.invoicePayments || []).map((p) => [clean(p.itemOrderId), p])
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
  const plannedBeforeAdvertising = round2(recordPayment1066 + settlementAdjustment1066Impact)
  const difference = round2(targetBeforeAdvertising - plannedBeforeAdvertising)

  const ctx = {
    saleParentSet,
    planExclusions,
    adjSourceByRow,
    invoicePaymentByItem,
    advertising1066,
  }

  const candidateRows = allRows
    .filter((row) => row.rowClass !== ROW_CLASS.STATEMENT_FEE)
    .map((row) => {
      const cls = classifyRowAccounting(row, ctx)
      const plannedContribution = round2(cls.recordPayment1066 + cls.settlementAdjustment1066)
      const expectedContribution = round2(cls.expected1066)
      const delta = round2(expectedContribution - plannedContribution)
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
        assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber),
        logisticsOnly: Boolean(row.logisticsOnly),
        settlementAdjustment: Boolean(adjSourceByRow.has(row.rowNumber)),
        recordPayment: cls.classification.startsWith('record_payment'),
        classification: cls.classification,
        expected1066Contribution: expectedContribution,
        planned1066Contribution: plannedContribution,
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
    },
    candidateRows,
    nonZeroDeltas: candidateRows.filter((row) => Math.abs(num(row.delta)) >= 0.01),
  }
}

module.exports = {
  signedParentRowFulfillment,
  parentFulfillmentChargeMagnitude,
  buildUndepositedReconciliation,
}
