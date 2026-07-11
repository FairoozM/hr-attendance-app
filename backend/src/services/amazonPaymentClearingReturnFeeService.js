const { round2, isSettlementReturnRow } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')

const TOLERANCE = 0.01

/** @deprecated Prefer marketplace-aware accounts from getPaymentClearingMarketplaceConfig */
const RETURN_FEE_ACCOUNTS = Object.freeze({
  UNDEPOSITED: { accountCode: '1024', accountName: 'KSA-Amazon Undeposited Funds' },
  COMMISSION: { accountCode: '1026', accountName: 'KSA-Amazon Uncleared Commission Exp' },
  SHIPPING_FBA: { accountCode: '1028', accountName: 'KSA-Amazon Uncleared Shipping Exp' },
})

function returnFeeAccountsFor(marketplace) {
  return getPaymentClearingMarketplaceConfig(marketplace).returnFeeAccounts
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isRefundTransactionRow(row) {
  const tx = clean(row?.transactionType).toLowerCase()
  return tx.includes('refund') || tx.includes('return')
}

function emptyReturnBreakdown(orderId = '') {
  return {
    orderId,
    customerRefundAmount: 0,
    principalRefundAmount: 0,
    commissionReversal: 0,
    shippingFbaRetained: 0,
    otherFeeDelta: 0,
    netReturnSettlement: 0,
    rowCount: 0,
  }
}

/**
 * Break down Amazon Refund/Return transaction rows for one order.
 * Separates customer refund principal from partial fee reversals vs retained fees.
 */
function buildReturnFeeBreakdown(orderRows) {
  const rows = Array.isArray(orderRows) ? orderRows.filter(isRefundTransactionRow) : []
  const orderId = clean(rows[0]?.orderId)
  const breakdown = emptyReturnBreakdown(orderId)
  breakdown.rowCount = rows.length

  for (const row of rows) {
    const amount = num(row.amount)
    breakdown.netReturnSettlement = round2(breakdown.netReturnSettlement + amount)
    const amountType = clean(row.amountType)
    const amountDesc = clean(row.amountDescription)

    if (amountType === 'ItemPrice' && amountDesc.toLowerCase() === 'principal') {
      breakdown.principalRefundAmount = round2(breakdown.principalRefundAmount + amount)
    }
    if (amountType === 'ItemPrice' && ['principal', 'tax', 'shipping', 'shipping tax'].includes(amountDesc.toLowerCase())) {
      breakdown.customerRefundAmount = round2(breakdown.customerRefundAmount + amount)
      continue
    }
    if (amountType === 'ItemFees' && amountDesc === 'Commission') {
      breakdown.commissionReversal = round2(breakdown.commissionReversal + amount)
      continue
    }
    if (
      amountType === 'ItemFees' &&
      ['FBAPerUnitFulfillmentFee', 'VariableClosingFee', 'ShippingChargeback'].includes(amountDesc)
    ) {
      breakdown.shippingFbaRetained = round2(breakdown.shippingFbaRetained + amount)
      continue
    }
    if (amountType === 'Promotion' && amountDesc === 'Shipping') {
      breakdown.shippingFbaRetained = round2(breakdown.shippingFbaRetained + amount)
      continue
    }
    breakdown.otherFeeDelta = round2(breakdown.otherFeeDelta + amount)
  }

  return breakdown
}

function groupReturnRowsByOrder(allRows) {
  const groups = new Map()
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (!isRefundTransactionRow(row)) continue
    const orderId = clean(row.orderId)
    if (!orderId) continue
    if (!groups.has(orderId)) groups.set(orderId, [])
    groups.get(orderId).push(row)
  }
  return groups
}

function collectReturnOrderIds(batch, allRows = []) {
  const ids = new Set()
  for (const row of batch?.matchedReturns || []) {
    if (row?.orderId) ids.add(clean(row.orderId))
  }
  for (const row of batch?.netNegativeReturnOrders || []) {
    if (row?.orderId) ids.add(clean(row.orderId))
  }
  for (const row of allRows) {
    if (isSettlementReturnRow(row) && row.orderId) ids.add(clean(row.orderId))
  }
  return Array.from(ids).sort()
}

function journalLineAmount(value) {
  return Math.abs(round2(num(value)))
}

function buildReturnFeeJournalLinesForBreakdown(breakdown, batch, opts = {}) {
  const lines = []
  const marketplace = opts.marketplace || batch?.marketplace || 'KSA'
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  const accounts = returnFeeAccountsFor(marketplace)
  const settlementReference = buildSettlementReference(batch)
  const orderId = breakdown.orderId

  const commissionAmt = journalLineAmount(breakdown.commissionReversal)
  if (commissionAmt > TOLERANCE && breakdown.commissionReversal > 0) {
    const entry = buildEntryReference(settlementReference, 'return_commission_reversal', `Order ${orderId}`)
    lines.push({
      key: `return-commission-${orderId}`,
      orderId,
      feeType: 'return_commission_reversal',
      normalizedFeeType: 'RETURN_COMMISSION_REVERSAL',
      amount: commissionAmt,
      debit: { ...accounts.UNDEPOSITED, amount: commissionAmt },
      credit: { ...accounts.COMMISSION, amount: commissionAmt },
      referenceNumber: entry.referenceNumber,
      notes: entry.description || `Amazon return commission reversal ${orderId}`,
      status: 'ready',
    })
  }

  const shippingAmt = journalLineAmount(breakdown.shippingFbaRetained)
  if (shippingAmt > TOLERANCE && breakdown.shippingFbaRetained < 0) {
    const entry = buildEntryReference(settlementReference, 'return_shipping_retained', `Order ${orderId}`)
    lines.push({
      key: `return-shipping-${orderId}`,
      orderId,
      feeType: 'return_shipping_retained',
      normalizedFeeType: 'RETURN_SHIPPING_RETAINED',
      amount: shippingAmt,
      debit: { ...accounts.SHIPPING_FBA, amount: shippingAmt },
      credit: { ...accounts.UNDEPOSITED, amount: shippingAmt },
      referenceNumber: entry.referenceNumber,
      notes: entry.description || `Amazon return shipping/FBA retained ${orderId}`,
      status: 'ready',
    })
  }

  const otherAmt = journalLineAmount(breakdown.otherFeeDelta)
  if (otherAmt > TOLERANCE) {
    const entry = buildEntryReference(settlementReference, 'return_other_fee', `Order ${orderId}`)
    const isDebitUndeposited = breakdown.otherFeeDelta < 0
    lines.push({
      key: `return-other-${orderId}`,
      orderId,
      feeType: 'return_other_fee',
      normalizedFeeType: 'RETURN_OTHER_FEE',
      amount: otherAmt,
      debit: isDebitUndeposited
        ? { ...accounts.SHIPPING_FBA, amount: otherAmt }
        : { ...accounts.UNDEPOSITED, amount: otherAmt },
      credit: isDebitUndeposited
        ? { ...accounts.UNDEPOSITED, amount: otherAmt }
        : { ...accounts.SHIPPING_FBA, amount: otherAmt },
      referenceNumber: entry.referenceNumber,
      notes: entry.description || `Amazon return other fee delta ${orderId}`,
      status: 'ready',
    })
  }

  const feeJournalNet = round2(
    (breakdown.commissionReversal > 0 ? breakdown.commissionReversal : 0) +
      breakdown.shippingFbaRetained +
      breakdown.otherFeeDelta
  )
  const residual = round2(breakdown.netReturnSettlement - breakdown.customerRefundAmount - feeJournalNet)
  const varianceAccountId = clean(opts.returnVarianceAccountId ?? cfg.returnVarianceAccountId)
  if (Math.abs(residual) > TOLERANCE) {
    if (!varianceAccountId && !opts.allowVarianceWithoutAccount) {
      lines.push({
        key: `return-variance-${orderId}`,
        orderId,
        feeType: 'return_variance',
        normalizedFeeType: 'RETURN_VARIANCE',
        amount: Math.abs(residual),
        residual,
        status: 'needs_mapping',
        blockingReason: `Return fee residual exceeds tolerance. Set ${cfg.returnVarianceAccountIdEnv} or review Amazon rows.`,
      })
    } else if (varianceAccountId) {
      const entry = buildEntryReference(settlementReference, 'return_variance', `Order ${orderId}`)
      const amt = Math.abs(residual)
      const varianceAccount = {
        accountCode: 'variance',
        accountName: 'Amazon Return Fee Variance',
        accountId: varianceAccountId,
      }
      lines.push({
        key: `return-variance-${orderId}`,
        orderId,
        feeType: 'return_variance',
        normalizedFeeType: 'RETURN_VARIANCE',
        amount: amt,
        debit: residual < 0
          ? { ...accounts.UNDEPOSITED, accountId: varianceAccountId, amount: amt }
          : { ...varianceAccount, amount: amt },
        credit: residual < 0
          ? { ...varianceAccount, amount: amt }
          : { ...accounts.UNDEPOSITED, accountId: varianceAccountId, amount: amt },
        referenceNumber: entry.referenceNumber,
        notes: entry.description || `Amazon return fee variance ${orderId}`,
        status: 'ready',
      })
    }
  }

  return lines
}

function aggregateReturnFeeJournalLines(journalLines) {
  const groups = new Map()
  for (const line of Array.isArray(journalLines) ? journalLines : []) {
    if (line.status !== 'ready') continue
    const key = line.normalizedFeeType || line.feeType
    const existing = groups.get(key) || {
      ...line,
      amount: 0,
      orderIds: [],
      keys: [],
    }
    existing.amount = round2(existing.amount + journalLineAmount(line.amount))
    if (line.orderId) existing.orderIds.push(line.orderId)
    existing.keys.push(line.key)
    groups.set(key, existing)
  }
  return Array.from(groups.values())
}

function buildReturnFeePlan(batch, allRows = []) {
  const returnOrderIds = collectReturnOrderIds(batch, allRows)
  const groups = groupReturnRowsByOrder(allRows)
  const breakdowns = []
  const journalLines = []

  for (const orderId of returnOrderIds) {
    const orderRows = groups.get(orderId) || []
    const breakdown = orderRows.length
      ? buildReturnFeeBreakdown(orderRows)
      : emptyReturnBreakdown(orderId)
    breakdowns.push(breakdown)
    journalLines.push(...buildReturnFeeJournalLinesForBreakdown(breakdown, batch))
  }

  const summary = breakdowns.reduce(
    (acc, row) => {
      acc.orderCount += 1
      acc.customerRefundTotal = round2(acc.customerRefundTotal + Math.abs(row.customerRefundAmount))
      acc.commissionReversalTotal = round2(acc.commissionReversalTotal + Math.max(0, row.commissionReversal))
      acc.shippingRetainedTotal = round2(acc.shippingRetainedTotal + Math.abs(Math.min(0, row.shippingFbaRetained)))
      acc.netReturnSettlementTotal = round2(acc.netReturnSettlementTotal + row.netReturnSettlement)
      return acc
    },
    {
      orderCount: 0,
      customerRefundTotal: 0,
      commissionReversalTotal: 0,
      shippingRetainedTotal: 0,
      netReturnSettlementTotal: 0,
      journalLineCount: 0,
      varianceBlockerCount: 0,
    }
  )
  summary.journalLineCount = journalLines.length
  summary.varianceBlockerCount = journalLines.filter((row) => row.status === 'needs_mapping').length
  summary.aggregatedJournalCount = aggregateReturnFeeJournalLines(journalLines).length

  return {
    batchId: batch?.batchId,
    breakdowns,
    journalLines,
    aggregatedJournalLines: aggregateReturnFeeJournalLines(journalLines),
    summary,
    warnings: summary.varianceBlockerCount
      ? [`${summary.varianceBlockerCount} return order(s) have fee residuals that need a variance account or manual review.`]
      : [],
  }
}

module.exports = {
  TOLERANCE,
  RETURN_FEE_ACCOUNTS,
  buildReturnFeeBreakdown,
  buildReturnFeeJournalLinesForBreakdown,
  aggregateReturnFeeJournalLines,
  buildReturnFeePlan,
  collectReturnOrderIds,
  groupReturnRowsByOrder,
  isRefundTransactionRow,
}
