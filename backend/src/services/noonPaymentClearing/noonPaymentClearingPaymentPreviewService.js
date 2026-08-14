const {
  round2,
  num,
  clean,
  ROW_CLASS,
  isUnclearedInvoicePaymentBucketRow,
} = require('./noonPaymentClearingCategoryService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { isNoonSettlementReconciliationAcceptable, RECONCILIATION_TOLERANCE } = require('./noonPaymentClearingReconciliationService')
const { buildFeeJournalPreviewLines } = require('./noonPaymentClearingPreviewService')
const { buildUnclearedReclassJournals } = require('./noonPaymentClearingUnclearedReclassService')
const { resolveNoonFeeJournalSides } = require('./noonPaymentClearingJournalDirection')
const {
  buildSaleParentOrderIdSet,
  isSettlementAdjustmentSourceRow,
  isPaidInvoiceSubsidyAdjustmentRow,
  isZeroSaleCrossWeekLogisticsSettlementRow,
  buildSettlementAdjustmentJournal,
  collectSettlementAdjustmentSourceRows,
} = require('./noonPaymentClearingSettlementAdjustmentService')
const {
  signedParentRowFulfillment,
  parentFulfillmentChargeMagnitude,
  buildUndepositedReconciliation,
} = require('./noonPaymentClearingUndepositedReconciliationService')
const {
  collectReturnRows,
  buildNoonReturnFeeBreakdown,
  reclassifyReturnRows,
} = require('./noonPaymentClearingReturnService')
const { summarizeReturnFeeReversals } = require('./noonPaymentClearingReturnFeeService')

const ORPHAN_PARENT_ASSIGNMENT_REASON = 'zoho_invoice_orphan_parent'
const PAYMENT_PREVIEW_TOLERANCE = RECONCILIATION_TOLERANCE

function positiveAmount(value) {
  return Math.abs(round2(Number(value) || 0))
}

/** Parent/adjustment logistics with no sale in this statement — still clears via 1068 (uncleared), not 1066. */
function isOrphanParentLogisticsRow(row) {
  if (!row) return false
  if (clean(row.assignmentReason) === ORPHAN_PARENT_ASSIGNMENT_REASON) return true
  if (clean(row.parentFallbackStatus) === 'assigned_zoho_orphan') return true
  return false
}

/** Same normalization as noonOrderIdHelper.matchKey — keeps exclusions comparable. */
function itemOrderMatchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
}

/** Statement row netProceed wins when set — matchedOrders can retain stale invoice-match sale gross. */
function effectiveNetProceedForPlan(row, item) {
  if (row && row.netProceed != null && row.netProceed !== '') {
    const rowNet = num(row.netProceed)
    if (rowNet <= -0.01) return rowNet
    if (rowNet > -0.01 && rowNet < 0.01) return rowNet
  }
  return num(item.netProceed)
}

/** Sales returns clear only via return steps — never Record Payment or open-balance plans. */
function buildReturnItemOrderIdSet(batch, classifiedRows = null) {
  const rawRows = batch?.allRows || []
  const saleParentSet = buildSaleParentOrderIdSet(rawRows)
  const rows = classifiedRows || reclassifyReturnRows(rawRows, saleParentSet)
  const ids = new Set()
  for (const row of collectReturnRows(rows, saleParentSet)) {
    const key = itemOrderMatchKey(row.itemOrderId)
    if (key) ids.add(key)
  }
  for (const row of [...(batch?.matchedReturns || []), ...(batch?.refundReturnRows || [])]) {
    const key = itemOrderMatchKey(row.itemOrderId)
    if (key) ids.add(key)
  }
  return ids
}

function isSalesReturnItemOrderId(itemOrderId, returnItemOrderIds) {
  const key = itemOrderMatchKey(itemOrderId)
  return Boolean(key && returnItemOrderIds.has(key))
}

/** Positive subsidy on a Zoho-paid invoice — settlement adjustment journal only (not Record Payment). */
function isPaidInvoiceSubsidyRow(row, planExclusions = null) {
  return isPaidInvoiceSubsidyAdjustmentRow(row, planExclusions)
}

function collectPaidInvoiceSubsidyLines(allRows = [], planExclusions = null) {
  return (Array.isArray(allRows) ? allRows : [])
    .filter((row) => isPaidInvoiceSubsidyRow(row, planExclusions))
    .map((row) => ({
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
      assignedItemOrderId: clean(row.assignedItemOrderId) || clean(row.itemOrderId),
      assignedZohoInvoiceId: clean(row.assignedZohoInvoiceId || row.zohoInvoiceId),
      assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber),
      signedAmount: round2(num(row.total)),
      amount: round2(num(row.total)),
      displayLabel: row.displayLabel || row.title || 'Noon shipping subsidy',
    }))
}

/** One journal for all paid-invoice subsidies: Dr Undeposited (1066) / Cr Shipping expense. */
function buildPaidInvoiceSubsidyJournal(subsidyLines = [], accountOverrides = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const amount = round2(
    (Array.isArray(subsidyLines) ? subsidyLines : []).reduce((sum, line) => sum + num(line.amount), 0)
  )
  if (amount < 0.01) return null

  const undeposited = accountOverrides.undepositedFundsAccount || cfg.undepositedFundsAccount
  const shippingExpense = accountOverrides.shippingExpenseAccount || cfg.shippingExpenseAccount

  return {
    paymentType: 'paid_invoice_subsidy',
    feeType: 'PAID_INVOICE_SUBSIDY',
    normalizedFeeType: 'PAID_INVOICE_SUBSIDY',
    displayLabel: 'Noon shipping subsidy — already-paid invoice(s)',
    accountingTreatment: 'Dr Undeposited (1066) / Cr Shipping Exp',
    rowClass: 'paid_invoice_subsidy',
    amount,
    signedAmount: amount,
    sourceLineCount: subsidyLines.length,
    sourceLines: subsidyLines,
    zohoAccountId: undeposited.accountId,
    zohoAccountName: undeposited.accountName,
    zohoAccountCode: undeposited.accountCode,
    clearingAccountId: shippingExpense.accountId,
    clearingAccountName: shippingExpense.accountName,
    clearingAccountCode: shippingExpense.accountCode,
    debit: {
      accountId: undeposited.accountId,
      accountName: undeposited.accountName,
      accountCode: undeposited.accountCode,
    },
    credit: {
      accountId: shippingExpense.accountId,
      accountName: shippingExpense.accountName,
      accountCode: shippingExpense.accountCode,
    },
    lineItems: [
      {
        debitOrCredit: 'debit',
        accountId: undeposited.accountId,
        accountName: undeposited.accountName,
        accountCode: undeposited.accountCode,
        amount,
      },
      {
        debitOrCredit: 'credit',
        accountId: shippingExpense.accountId,
        accountName: shippingExpense.accountName,
        accountCode: shippingExpense.accountCode,
        amount,
      },
    ],
    accountingPreview: {
      debit: `${undeposited.accountName || 'Undeposited'} (1066)`,
      credit: `${shippingExpense.accountName || 'Shipping Exp'} (reduce expense)`,
      lines: [
        { side: 'debit', account: undeposited.accountName, amount },
        { side: 'credit', account: shippingExpense.accountName, amount },
      ],
    },
    previewNote:
      'Subsidy on Zoho-paid invoice — excluded from Record Payment; money is in this statement payout.',
    mappingStatus: 'mapped',
  }
}

function requireBatchForPaymentPreview(batch) {
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'approved' && batch.status !== 'posted') {
    const err = new Error('Payment preview requires an approved Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary, PAYMENT_PREVIEW_TOLERANCE)) {
    const err = new Error('Payment preview requires a reconciled Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Payment preview requires zero unmatched item orders.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.multipleMatchItems) && batch.multipleMatchItems.length > 0) {
    const err = new Error('Payment preview requires zero multiple invoice matches.')
    err.code = 'NOON_PAYMENT_CLEARING_MULTIPLE_MATCHES'
    err.status = 422
    throw err
  }
}

/**
 * Parent / adjustment logistics assigned to a child invoice.
 * All parent / adjustment folds → 1067 / 1068 (uncleared). Orphans use the same 1068 path so
 * settlement deductions already in the Noon payout are not double-counted on Undeposited (1066).
 *
 * Do NOT add orderSubsidies on top of othersInclVat — the parser already merges
 * subsidies into othersInclVat (double-count produced bogus 22.68 from -37.8+7.56+7.56).
 */
function collectAssignedUnclearedPaymentAddOns(allRows = [], planExclusions = null, options = {}) {
  const byItem = new Map()
  const saleParentSet = buildSaleParentOrderIdSet(allRows)
  const exInv = planExclusions?.excludedInvoiceIds
  const exItem = planExclusions?.excludedItemOrderIds
  const returnItemOrderIds = options.returnItemOrderIds || null
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (!options.ignoreExclusions && row.excludeFromPaymentClearing) continue
    // Settlement adjustments and paid-invoice subsidies never belong on Record Payment — even when
    // ignoreExclusions is true for open-balance detection (avoids false shortfalls on paid invoices).
    if (isPaidInvoiceSubsidyRow(row, planExclusions)) continue
    if (isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet)) continue
    if (!isUnclearedInvoicePaymentBucketRow(row)) continue
    if (row.rowClass === ROW_CLASS.RETURN) continue
    const itemId = clean(row.assignedItemOrderId) || clean(row.itemOrderId)
    if (!itemId) continue
    if (returnItemOrderIds && isSalesReturnItemOrderId(itemId, returnItemOrderIds)) continue
    const rowInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const rowItemKey = itemOrderMatchKey(itemId)
    if (exInv && rowInv && exInv.has(rowInv)) continue
    if (exItem && rowItemKey && exItem.has(rowItemKey)) continue

    const entry = byItem.get(itemId) || {
      commission: 0,
      fulfillment: 0,
      fulfillmentOrphan: 0,
      sourceRowNumbers: [],
      sourceBreakdown: [],
    }

    const referral = positiveAmount(row.referralFee)
    // Use signed statement Total so same-week subsidies (+) net against charges (-).
    const fulfillmentSigned = signedParentRowFulfillment(row)

    entry.commission = round2(entry.commission + referral)
    entry.fulfillment = round2(entry.fulfillment + fulfillmentSigned)
    if (isOrphanParentLogisticsRow(row)) {
      entry.fulfillmentOrphan = round2((entry.fulfillmentOrphan || 0) + fulfillmentSigned)
    }
    entry.sourceRowNumbers.push(row.rowNumber)
    entry.sourceBreakdown.push({
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      total: round2(num(row.total)),
      fulfillmentFee: round2(num(row.fulfillmentFee)),
      shippingCharges: round2(num(row.shippingCharges)),
      othersInclVat: round2(num(row.othersInclVat)),
      appliedFulfillment: fulfillmentSigned,
      appliedCommission: referral,
      orphanLogistics: isOrphanParentLogisticsRow(row),
    })
    byItem.set(itemId, entry)
  }
  return byItem
}

/** Merged exclusion sets: snapshot + row flags + matched-order flags. */
function collectPlanExclusions(batch) {
  const excludedInvoiceIds = new Set(
    (batch?.reportSnapshot?.openBalanceReconcile?.excludedInvoiceIds || [])
      .map((id) => clean(id))
      .filter(Boolean)
  )
  const excludedItemOrderIds = new Set(
    (batch?.reportSnapshot?.openBalanceReconcile?.excludedItemOrderIds || [])
      .map((id) => itemOrderMatchKey(id))
      .filter(Boolean)
  )
  for (const m of batch?.matchedOrders || []) {
    if (!m?.excludeFromPaymentClearing) continue
    const inv = clean(m.zohoInvoiceId)
    const item = itemOrderMatchKey(m.itemOrderId)
    if (inv) excludedInvoiceIds.add(inv)
    if (item) excludedItemOrderIds.add(item)
  }
  for (const row of batch?.allRows || []) {
    if (!row?.excludeFromPaymentClearing) continue
    const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const item = itemOrderMatchKey(row.assignedItemOrderId || row.itemOrderId)
    if (inv) excludedInvoiceIds.add(inv)
    if (item) excludedItemOrderIds.add(item)
  }
  return { excludedInvoiceIds, excludedItemOrderIds }
}

/** Sum planned clearing per Zoho invoice — open balance is per invoice, not per item line. */
function aggregatePaymentPlansByInvoice(plans = []) {
  const byInv = new Map()
  for (const p of Array.isArray(plans) ? plans : []) {
    const invId = clean(p.zohoInvoiceId)
    if (!invId) continue
    const cur = byInv.get(invId)
    if (!cur) {
      byInv.set(invId, {
        ...p,
        itemOrderId: clean(p.itemOrderId) || '',
        itemOrderIds: clean(p.itemOrderId) ? [clean(p.itemOrderId)] : [],
      })
      continue
    }
    const items = new Set(cur.itemOrderIds || [])
    if (clean(p.itemOrderId)) items.add(clean(p.itemOrderId))
    cur.itemOrderIds = [...items]
    cur.itemOrderId = cur.itemOrderIds.join(', ')
    cur.totalClearingAmount = round2(
      positiveAmount(cur.totalClearingAmount) + positiveAmount(p.totalClearingAmount)
    )
    cur.netBalancePayment = {
      ...(cur.netBalancePayment || {}),
      amount: round2(positiveAmount(cur.netBalancePayment?.amount) + positiveAmount(p.netBalancePayment?.amount)),
    }
    cur.commissionPayment = {
      ...(cur.commissionPayment || {}),
      amount: round2(positiveAmount(cur.commissionPayment?.amount) + positiveAmount(p.commissionPayment?.amount)),
    }
    cur.fulfillmentPayment = {
      ...(cur.fulfillmentPayment || {}),
      amount: round2(positiveAmount(cur.fulfillmentPayment?.amount) + positiveAmount(p.fulfillmentPayment?.amount)),
    }
    cur.parentLogisticsAddOn = round2(
      positiveAmount(cur.parentLogisticsAddOn) + positiveAmount(p.parentLogisticsAddOn)
    )
    cur.parentLogisticsOrphanAddOn = round2(
      positiveAmount(cur.parentLogisticsOrphanAddOn) + positiveAmount(p.parentLogisticsOrphanAddOn)
    )
  }
  return [...byInv.values()]
}

/** Invoice payment plans for balance checks — works before approval. */
function buildInvoicePaymentPlansFromBatch(batch, accountOverrides = {}, options = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const accounts = {
    ...cfg.paymentPreviewAccounts,
    ...(accountOverrides.paymentPreviewAccounts || {}),
  }
  const planExclusions = options.ignoreExclusions ? null : collectPlanExclusions(batch)
  const { excludedInvoiceIds, excludedItemOrderIds } = planExclusions || {
    excludedInvoiceIds: new Set(),
    excludedItemOrderIds: new Set(),
  }
  const rawRows = batch.allRows || []
  const saleParentSet = buildSaleParentOrderIdSet(rawRows)
  const classifiedRows = reclassifyReturnRows(rawRows, saleParentSet)
  const returnItemOrderIds = buildReturnItemOrderIdSet(batch, classifiedRows)
  const matched = (Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []).filter((item) => {
    if (isSalesReturnItemOrderId(item.itemOrderId, returnItemOrderIds)) return false
    if (!options.ignoreExclusions && item.logisticsOnly) return false
    if (!options.ignoreExclusions && item.excludeFromPaymentClearing) return false
    if (!options.ignoreExclusions && excludedInvoiceIds.has(clean(item.zohoInvoiceId))) return false
    if (!options.ignoreExclusions && excludedItemOrderIds.has(itemOrderMatchKey(item.itemOrderId))) return false
    return true
  })
  const addOnsByItem = collectAssignedUnclearedPaymentAddOns(classifiedRows, planExclusions, {
    ignoreExclusions: options.ignoreExclusions,
    returnItemOrderIds,
  })
  return matched
    .filter((item) => {
      if (isSalesReturnItemOrderId(item.itemOrderId, returnItemOrderIds)) return false
      const row = classifiedRows.find(
        (r) => clean(r.itemOrderId).toLowerCase() === clean(item.itemOrderId).toLowerCase()
      )
      if (row?.rowClass === ROW_CLASS.RETURN) return false
      if (row && row.netProceed != null && row.netProceed !== '' && num(row.netProceed) <= -0.01) {
        return false
      }
      const effectiveNetProceed = effectiveNetProceedForPlan(row, item)
      if (effectiveNetProceed < 0.01) return false
      if (row && isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet)) return false
      if (options.ignoreExclusions) return true
      return true
    })
    .map((item) =>
      buildInvoicePaymentPlan(item, accounts, addOnsByItem.get(clean(item.itemOrderId)) || null)
    )
}

function buildInvoicePaymentPlan(item, accounts, addOns = null) {
  // Noon CSV "Net Proceeds" is sale/invoice gross (Amazon principal) — NOT cash after fees.
  // Example: Net Proceeds 759 / Referral -119.54 / Fulfillment -33.6 / Total 605.86
  // Record Payments that clear a 759 invoice:
  //   1066 undeposited = 605.86, 1067 commission = 119.54, 1068 shipping = 33.6
  const saleGross = positiveAmount(item.netProceed)
  const itemCommission = positiveAmount(item.referralFee)
  const itemFulfillment = positiveAmount(round2(num(item.fulfillmentFee) + num(item.shippingCharges)))
  const parentCommission = positiveAmount(addOns?.commission)
  const parentFulfillmentSigned = round2(num(addOns?.fulfillment))
  const parentFulfillmentChargeSigned = round2(Math.min(0, parentFulfillmentSigned))
  const parentFulfillmentTo1068 = parentFulfillmentChargeMagnitude(parentFulfillmentSigned)
  const parentOrphanFulfillmentSigned = round2(num(addOns?.fulfillmentOrphan))
  const parentOrphanChargeSigned = round2(Math.min(0, parentOrphanFulfillmentSigned))
  const parentOrphanFulfillmentTo1068 = parentFulfillmentChargeMagnitude(parentOrphanFulfillmentSigned)
  const parentInStatementChargeSigned = round2(
    parentFulfillmentChargeSigned - parentOrphanChargeSigned
  )
  const parentInStatementFulfillment = parentFulfillmentChargeMagnitude(
    parentInStatementChargeSigned
  )
  const commission = round2(itemCommission + parentCommission)
  const fulfillmentShipping = round2(
    (item.logisticsOnly ? 0 : itemFulfillment) +
      parentFulfillmentTo1068 +
      (item.logisticsOnly ? itemFulfillment : 0)
  )
  let invoiceClearingNetBalance = 0
  if (!item.logisticsOnly) {
    const statementTotal = num(item.total)
    if (Math.abs(statementTotal) >= 0.01) {
      // Statement Total nets item fees; parent folds apply as signed net (subsidy + charge).
      invoiceClearingNetBalance = round2(
        Math.max(0, statementTotal - parentCommission + parentFulfillmentChargeSigned)
      )
    } else {
      invoiceClearingNetBalance = round2(Math.max(0, saleGross - commission - fulfillmentShipping))
    }
  }
  const netBalancePayment = {
    amount: invoiceClearingNetBalance,
    paymentType: 'net_balance',
    ...accounts.NET_BALANCE,
  }
  const commissionPayment = {
    amount: commission,
    paymentType: 'commission',
    ...accounts.COMMISSION,
  }
  const fulfillmentPayment = {
    amount: fulfillmentShipping,
    paymentType: 'fulfillment_shipping',
    ...accounts.FULFILLMENT_SHIPPING,
  }
  const totalClearingAmount = round2(
    netBalancePayment.amount + commissionPayment.amount + fulfillmentPayment.amount
  )
  const invoiceTotal = round2(num(item.zohoInvoiceTotal))
  const remainingDifference = round2(invoiceTotal - totalClearingAmount)
  const exceedsInvoiceTotal =
    totalClearingAmount >= 0.01 &&
    (invoiceTotal < 0.01 || totalClearingAmount > invoiceTotal + PAYMENT_PREVIEW_TOLERANCE)
  return {
    itemOrderId: item.itemOrderId || '',
    parentOrderId: item.parentOrderId || '',
    sku: item.sku || '',
    partnerSku: item.partnerSku || '',
    zohoInvoiceId: item.zohoInvoiceId || '',
    zohoInvoiceNumber: item.zohoInvoiceNumber || '',
    zohoPoNumber: item.zohoPoNumber || '',
    customerId: item.zohoCustomerId || '',
    customerName: item.zohoCustomerName || '',
    invoiceTotal,
    /** Sale gross from Noon Net Proceeds (not the 1066 payment amount). */
    netProceed: saleGross,
    saleGross,
    invoiceClearingNetBalance,
    referralFee: commission,
    fulfillmentShipping,
    parentLogisticsAddOn: parentInStatementFulfillment,
    parentLogisticsOrphanAddOn: parentOrphanFulfillmentTo1068,
    parentCommissionAddOn: positiveAmount(addOns?.commission),
    parentLogisticsSources: Array.isArray(addOns?.sourceBreakdown) ? addOns.sourceBreakdown : [],
    netBalancePayment,
    commissionPayment,
    fulfillmentPayment,
    totalClearingAmount,
    remainingDifference,
    exceedsInvoiceTotal,
    paymentAction: 'record_payment',
  }
}

function collectInvoiceOverpayments(invoicePayments = []) {
  return (Array.isArray(invoicePayments) ? invoicePayments : [])
    .filter((p) => p && p.exceedsInvoiceTotal)
    .map((p) => ({
      itemOrderId: p.itemOrderId || '',
      zohoInvoiceId: p.zohoInvoiceId || '',
      zohoInvoiceNumber: p.zohoInvoiceNumber || '',
      invoiceTotal: positiveAmount(p.invoiceTotal),
      totalClearingAmount: positiveAmount(p.totalClearingAmount),
      overBy: round2(positiveAmount(p.totalClearingAmount) - positiveAmount(p.invoiceTotal)),
      netBalance: positiveAmount(p.netBalancePayment?.amount ?? p.invoiceClearingNetBalance),
      commission: positiveAmount(p.commissionPayment?.amount ?? p.referralFee),
      shipping: positiveAmount(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping),
      parentLogisticsAddOn: positiveAmount(p.parentLogisticsAddOn),
    }))
}

function assertNoStatementOverpayments(paymentPreview) {
  const overpayments = Array.isArray(paymentPreview?.invoiceOverpayments)
    ? paymentPreview.invoiceOverpayments
    : collectInvoiceOverpayments(paymentPreview?.invoicePayments)
  if (!overpayments.length) return
  const sample = overpayments
    .slice(0, 5)
    .map(
      (o) =>
        `${o.zohoInvoiceNumber || o.itemOrderId}: clearing ${o.totalClearingAmount} > invoice ${o.invoiceTotal} (over by ${o.overBy})`
    )
    .join('; ')
  const more = overpayments.length > 5 ? ` (+${overpayments.length - 5} more)` : ''
  const err = new Error(
    `Payment preview blocked: ${overpayments.length} invoice(s) have payments totaling more than the Zoho invoice. Fix statement matching / parent logistics in Step 6. ${sample}${more}`
  )
  err.code = 'NOON_PAYMENT_CLEARING_INVOICE_OVERPAYMENT'
  err.status = 422
  err.details = { invoiceOverpayments: overpayments }
  throw err
}

/** @deprecated Open-balance issues are gated in Step 6 only — use assertNoStatementOverpayments for invoice-total checks. */
function assertNoInvoiceOverpayments(paymentPreview) {
  assertNoStatementOverpayments(paymentPreview)
  const balanceShortfalls = Array.isArray(paymentPreview?.invoiceBalanceShortfalls)
    ? paymentPreview.invoiceBalanceShortfalls
    : []
  if (!balanceShortfalls.length) return
  const sample = balanceShortfalls
    .slice(0, 5)
    .map(
      (o) =>
        `${o.zohoInvoiceNumber || o.itemOrderId}: clearing ${o.totalClearingAmount} > open balance ${o.openBalance} (over by ${o.overBy})`
    )
    .join('; ')
  const more = balanceShortfalls.length > 5 ? ` (+${balanceShortfalls.length - 5} more)` : ''
  const err = new Error(
    `Payment preview blocked: ${balanceShortfalls.length} invoice(s) do not have enough open Zoho balance. Fix in Step 6 (exclude already-paid logistics). ${sample}${more}`
  )
  err.code = 'NOON_PAYMENT_CLEARING_INVOICE_BALANCE_SHORT'
  err.status = 422
  err.details = { invoiceBalanceShortfalls: balanceShortfalls }
  throw err
}

/**
 * Compare planned clearing to live Zoho open balance (and invoice total).
 * Catches orphan logistics on already-paid invoices before Zoho 24016.
 */
function annotateInvoicePaymentsWithLiveBalances(invoicePayments = [], invoiceById = new Map()) {
  const { invoiceBalanceDue } = require('../../integrations/zoho/zohoBooksClient')
  const balanceShortfalls = []
  const annotated = (Array.isArray(invoicePayments) ? invoicePayments : []).map((p) => {
    const invId = clean(p.zohoInvoiceId)
    const invoice = invId ? invoiceById.get(invId) : null
    let openBalance = null
    if (invoice) {
      openBalance = positiveAmount(invoiceBalanceDue(invoice))
    }
    const clearing = positiveAmount(p.totalClearingAmount)
    const exceedsOpenBalance =
      openBalance != null && clearing >= 0.01 && clearing > openBalance + PAYMENT_PREVIEW_TOLERANCE
    const next = {
      ...p,
      openBalance,
      exceedsOpenBalance,
    }
    if (exceedsOpenBalance) {
      balanceShortfalls.push({
        itemOrderId: p.itemOrderId || '',
        zohoInvoiceId: invId,
        zohoInvoiceNumber: p.zohoInvoiceNumber || '',
        invoiceTotal: positiveAmount(p.invoiceTotal),
        openBalance,
        totalClearingAmount: clearing,
        overBy: round2(clearing - openBalance),
        netBalance: positiveAmount(p.netBalancePayment?.amount ?? p.invoiceClearingNetBalance),
        commission: positiveAmount(p.commissionPayment?.amount ?? p.referralFee),
        shipping: positiveAmount(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping),
        parentLogisticsAddOn: positiveAmount(p.parentLogisticsAddOn),
        reason:
          openBalance < 0.01
            ? 'Zoho invoice has zero open balance (already paid) — cannot clear shipping/commission onto it'
            : 'Planned payments exceed live Zoho balance due',
      })
    }
    return next
  })
  return { invoicePayments: annotated, invoiceBalanceShortfalls: balanceShortfalls }
}

async function attachLiveZohoBalancesToPaymentPreview(paymentPreview, fetchByIds) {
  if (!paymentPreview || !Array.isArray(paymentPreview.invoicePayments)) return paymentPreview
  const fetchInvoices =
    fetchByIds ||
    require('../../integrations/zoho/zohoBooksClient').fetchInvoicesByIds
  const ids = paymentPreview.invoicePayments.map((p) => p.zohoInvoiceId).filter(Boolean)
  let invoiceById = new Map()
  try {
    invoiceById = await fetchInvoices(ids)
  } catch (err) {
    console.warn('[noon-payment-clearing] live balance fetch failed:', err?.message || err)
    return {
      ...paymentPreview,
      balanceCheckWarning: err?.message || 'Could not fetch Zoho invoice balances',
    }
  }
  const { invoicePayments, invoiceBalanceShortfalls } = annotateInvoicePaymentsWithLiveBalances(
    paymentPreview.invoicePayments,
    invoiceById
  )
  const blocked =
    Boolean(paymentPreview.summary?.blocked) ||
    invoiceBalanceShortfalls.length > 0 ||
    (paymentPreview.invoiceOverpayments || []).length > 0
  return {
    ...paymentPreview,
    invoicePayments,
    invoiceBalanceShortfalls,
    status: blocked ? 'blocked' : paymentPreview.status,
    summary: {
      ...paymentPreview.summary,
      invoiceBalanceShortfallCount: invoiceBalanceShortfalls.length,
      blocked,
      blockedReason: invoiceBalanceShortfalls.length
        ? 'One or more invoices lack open Zoho balance for the planned payments.'
        : paymentPreview.summary?.blockedReason || null,
    },
  }
}

function computeStatementUndepositedTarget(allRows = []) {
  return round2(
    (Array.isArray(allRows) ? allRows : [])
      .filter((row) => row.rowClass !== ROW_CLASS.STATEMENT_FEE)
      .reduce((sum, row) => sum + num(row.total), 0)
  )
}

/**
 * Orphan parent/adjustment rows clear via 1068 but are already deducted from the Noon payout.
 * When planned 1066 exceeds the statement subtotal (pre-advertising), post a bridge journal Cr 1066.
 */
function buildUndepositedSettlementBridgeJournal(
  invoicePayments,
  allRows,
  accountOverrides = {},
  options = {}
) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const targetUndeposited = computeStatementUndepositedTarget(allRows)
  const recordPayment1066 = round2(
    (Array.isArray(invoicePayments) ? invoicePayments : []).reduce(
      (sum, p) => sum + num(p.netBalancePayment?.amount),
      0
    )
  )
  const subsidyTo1066 = round2(num(options.paidInvoiceSubsidyAmount))
  const plannedUndeposited = round2(recordPayment1066 + subsidyTo1066)
  const excessUndeposited = round2(plannedUndeposited - targetUndeposited)
  if (excessUndeposited < 0.01) return null

  const expense = accountOverrides.shippingExpenseAccount || cfg.shippingExpenseAccount
  const undeposited = accountOverrides.undepositedFundsAccount || cfg.undepositedFundsAccount
  const signedAmount = round2(-excessUndeposited)
  const sides = resolveNoonFeeJournalSides({
    feeAccountId: expense.accountId,
    feeAccountName: expense.accountName,
    feeAccountCode: expense.accountCode,
    clearingAccountId: undeposited.accountId,
    clearingAccountName: undeposited.accountName,
    clearingAccountCode: undeposited.accountCode,
    signedAmount,
    netAmount: signedAmount,
    vatAmount: 0,
    vatInclusive: false,
  })

  return {
    paymentType: 'undeposited_settlement_bridge',
    feeType: 'UNDEPOSITED_SETTLEMENT_BRIDGE',
    normalizedFeeType: 'UNDEPOSITED_SETTLEMENT_BRIDGE',
    displayLabel: 'Settlement bridge — orphan logistics already in Noon payout',
    accountingTreatment: 'Dr Shipping Exp / Cr Undeposited (1066)',
    rowClass: 'settlement_bridge',
    signedAmount,
    amount: excessUndeposited,
    targetUndeposited1066: targetUndeposited,
    plannedUndeposited1066: plannedUndeposited,
    recordPayment1066,
    paidInvoiceSubsidy1066: subsidyTo1066,
    zohoAccountId: expense.accountId,
    zohoAccountName: expense.accountName,
    zohoAccountCode: expense.accountCode,
    clearingAccountId: undeposited.accountId,
    clearingAccountName: undeposited.accountName,
    clearingAccountCode: undeposited.accountCode,
    debit: sides.debit,
    credit: sides.credit,
    lineItems: sides.lineItems || [],
    accountingPreview: {
      debit: sides.preview?.debitLabel,
      credit: sides.preview?.creditLabel,
      lines: sides.preview?.lines || [],
      expenseAccount: expense.accountName,
      clearingAccount: undeposited.accountName,
    },
    previewNote:
      `Planned undeposited ${plannedUndeposited} exceeds statement subtotal ${targetUndeposited} — ` +
      'orphan parent/adjustment logistics already deducted from Noon payout.',
    mappingStatus: 'mapped',
  }
}

function buildFoldedUnclearedChargeSummaries(allRows = [], planExclusions = null) {
  const saleParentSet = buildSaleParentOrderIdSet(allRows)
  return (Array.isArray(allRows) ? allRows : [])
    .filter((row) => isUnclearedInvoicePaymentBucketRow(row))
    .map((row) => {
      const settlementAdjustment = isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet)
      return {
        rowNumber: row.rowNumber,
        rowClass: row.rowClass,
        feeType: row.normalizedFeeType || '',
        displayLabel: row.displayLabel || row.title || '',
        accountingTreatment: settlementAdjustment
          ? isPaidInvoiceSubsidyRow(row, planExclusions)
            ? 'Settlement adjustment journal — Dr 1066 / Cr expense (+ VAT)'
            : 'Settlement adjustment journal — Dr expense (+ VAT) / Cr 1066'
          : 'Invoice Record Payment → uncleared (first entry)',
        signedAmount: round2(num(row.total)),
        amount: Math.abs(round2(num(row.total))),
        parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
        assignedItemOrderId: clean(row.assignedItemOrderId) || clean(row.itemOrderId),
        assignedZohoInvoiceId: clean(row.assignedZohoInvoiceId || row.zohoInvoiceId),
        assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber),
        previewNote: settlementAdjustment
          ? isPaidInvoiceSubsidyRow(row, planExclusions)
            ? `Paid-invoice subsidy ${round2(num(row.total))} AED on ${clean(row.assignedZohoInvoiceNumber) || clean(row.assignedItemOrderId)} → settlement adjustment journal (no Record Payment)`
            : `Cross-week charge on ${clean(row.originalParentOrderId || row.parentOrderId)} — sale not in this statement → settlement adjustment journal (invoice link is audit-only)`
          : clean(row.assignedItemOrderId)
            ? `Folded into invoice payment for ${clean(row.assignedItemOrderId)} → uncleared GL`
            : clean(row.itemOrderId)
              ? `Cleared via invoice payment for ${clean(row.itemOrderId)} → uncleared GL`
              : 'Uncleared via invoice payment (no child assignment — no Zoho invoice for this Noon parent order)',
        clearingPath: settlementAdjustment ? 'settlement_adjustment_journal' : 'invoice_payment_uncleared',
      }
    })
}

function summarizeShippingBreakup(invoicePayments = []) {
  let orphanShippingToUncleared = 0
  let inStatementShippingToUncleared = 0
  let orphanShippingInvoiceCount = 0
  let inStatementShippingLineCount = 0
  let shippingToUncleared1068 = 0
  for (const p of Array.isArray(invoicePayments) ? invoicePayments : []) {
    const orphan = positiveAmount(p.parentLogisticsOrphanAddOn)
    const shipping = positiveAmount(p.fulfillmentPayment?.amount)
    const inStatement = round2(Math.max(0, shipping - orphan))
    if (orphan >= 0.01) orphanShippingInvoiceCount += 1
    if (inStatement >= 0.01) inStatementShippingLineCount += 1
    orphanShippingToUncleared = round2(orphanShippingToUncleared + orphan)
    inStatementShippingToUncleared = round2(inStatementShippingToUncleared + inStatement)
    shippingToUncleared1068 = round2(shippingToUncleared1068 + shipping)
  }
  return {
    /** Orphan parent logistics — same 1068 uncleared path (reclass journal after payment). */
    orphanShippingToUncleared,
    /** @deprecated use orphanShippingToUncleared */
    orphanShippingToUndeposited: orphanShippingToUncleared,
    orphanShippingInvoiceCount,
    /** In-statement shipping — clears via fulfillment_shipping / 1068, then reclass journal. */
    inStatementShippingToUncleared,
    inStatementShippingLineCount,
    /** Matches uncleared shipping reclass journal gross (all 1068 fulfillment payments). */
    shippingReclassJournalGross: shippingToUncleared1068,
  }
}

function buildPaymentPreviewFromBatch(batch, mappingRules = [], inputVatAccount = null, accountOverrides = {}) {
  requireBatchForPaymentPreview(batch)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const rawRows = batch.allRows || []
  const saleParentSetForReturns = buildSaleParentOrderIdSet(rawRows)
  const allRows = reclassifyReturnRows(rawRows, saleParentSetForReturns)
  const planExclusions = collectPlanExclusions(batch)
  const metadata = batch.reportSnapshot || batch.metadata || {}
  const settlementAdjustmentJournal = buildSettlementAdjustmentJournal(
    allRows,
    {
      ...metadata,
      zohoCustomerId: clean(batch.zohoCustomerId),
    },
    {
      undepositedFundsAccount: accountOverrides.undepositedFundsAccount || cfg.undepositedFundsAccount,
      inputVatAccount: inputVatAccount || batch.inputVatAccount || accountOverrides.inputVatAccount || cfg.inputVatAccount,
      vatRate: accountOverrides.vatRate ?? cfg.vatRate,
    },
    planExclusions
  )
  const settlementAdjustmentLines = settlementAdjustmentJournal?.sourceLines || []
  const paidInvoiceSubsidyLines = settlementAdjustmentLines.filter((line) => line.paidInvoiceSubsidy)
  const invoicePayments = buildInvoicePaymentPlansFromBatch(batch, accountOverrides)
  const feeJournalLines = buildFeeJournalPreviewLines(
    allRows,
    mappingRules,
    inputVatAccount || batch.inputVatAccount || accountOverrides.inputVatAccount || null,
    {
      clearingAccount:
        accountOverrides.undepositedFundsAccount || accountOverrides.settlementBridgeAccount || null,
      advertisingExpenseAccount: accountOverrides.advertisingExpenseAccount || null,
    }
  )
  const foldedUnclearedCharges = buildFoldedUnclearedChargeSummaries(allRows, planExclusions)
  const parentChargeLines = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const adjustmentFolded = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const statementFeeLines = feeJournalLines.filter((l) => l.rowClass === 'statement_fee')
  // Non-logistics adjustments that still journal (rare) stay as journal clearings.
  const adjustmentJournalLines = feeJournalLines.filter((l) => l.rowClass === 'order_adjustment')

  const totalInvoicePayments = round2(invoicePayments.reduce((a, p) => a + p.totalClearingAmount, 0))
  const totalFeeJournals = round2(feeJournalLines.reduce((a, l) => a + l.amount, 0))
  const expectedSettlement = round2(batch.reconciliationSummary?.expectedSettlement || 0)
  const settlementReference = buildSettlementReference(metadata)

  const basePreview = {
    batchId: batch.batchId || batch.id,
    status: 'previewed',
    settlementReference,
    postingReferences: {
      netBalance: buildEntryReference(metadata, 'Net Undeposited'),
      commission: buildEntryReference(metadata, 'Commission'),
      fulfillmentShipping: buildEntryReference(metadata, 'Fulfillment'),
    },
    invoicePayments,
    parentLevelCharges: parentChargeLines,
    statementLevelCharges: statementFeeLines,
    adjustmentClearings: [...adjustmentFolded, ...adjustmentJournalLines],
    feeJournalLines,
  }

  const reclass = buildUnclearedReclassJournals(basePreview, {
    commissionExpenseAccount: accountOverrides.commissionExpenseAccount || cfg.commissionExpenseAccount,
    shippingExpenseAccount: accountOverrides.shippingExpenseAccount || cfg.shippingExpenseAccount,
    unclearedCommissionAccount:
      accountOverrides.unclearedCommissionAccount || cfg.unclearedCommissionAccount,
    unclearedShippingAccount: accountOverrides.unclearedShippingAccount || cfg.unclearedShippingAccount,
    inputVatAccount: inputVatAccount || batch.inputVatAccount || accountOverrides.inputVatAccount || cfg.inputVatAccount,
    vatRate: accountOverrides.vatRate ?? cfg.vatRate,
  })
  const totalReclassJournals = round2(reclass.lines.reduce((a, l) => a + l.amount, 0))
  const invoiceOverpayments = collectInvoiceOverpayments(invoicePayments)
  const blocked = invoiceOverpayments.length > 0
  const shippingBreakup = summarizeShippingBreakup(invoicePayments)
  const adjustmentSummary = settlementAdjustmentJournal?.summary || {}
  const subsidy1066 = round2(
    paidInvoiceSubsidyLines.reduce((sum, line) => sum + num(line.undepositedImpact), 0)
  )
  const undepositedSettlementBridgeJournal = null
  const targetUndeposited1066 = computeStatementUndepositedTarget(allRows)
  const recordPayment1066 = round2(
    invoicePayments.reduce((sum, p) => sum + num(p.netBalancePayment?.amount), 0)
  )
  const settlementAdjustment1066 = round2(num(adjustmentSummary.netUndepositedImpact))
  const returnFeeReversals = summarizeReturnFeeReversals(allRows)
  const matchedReturns = batch.matchedReturns || []
  const returnRows = collectReturnRows(allRows)
  const returns = matchedReturns.map((row) => {
    const breakdown = buildNoonReturnFeeBreakdown(
      returnRows.find((r) => clean(r.itemOrderId) === clean(row.itemOrderId)) || row
    )
    return {
      rowNumber: row.rowNumber,
      itemOrderId: row.itemOrderId,
      parentOrderId: row.parentOrderId,
      zohoInvoiceNumber: row.zohoInvoiceNumber,
      zohoCreditNoteNumber: row.zohoCreditNoteNumber,
      productRefundAmount: breakdown.productRefundAmount,
      commissionReversalGross: breakdown.commissionReversalGross,
      netSettlementEffect: breakdown.netSettlementEffect,
      status: row.status,
      blockCode: row.blockCode || '',
      blockingReason: row.blockingReason || '',
    }
  })
  const returnPrincipal1066 = round2(
    matchedReturns
      .filter((row) => row.status === 'matched')
      .reduce((sum, row) => {
        let productRefundAmount = num(row.productRefundAmount)
        if (Math.abs(productRefundAmount) < 0.01) {
          const returnRow = returnRows.find((r) => clean(r.itemOrderId) === clean(row.itemOrderId))
          if (returnRow) {
            productRefundAmount = buildNoonReturnFeeBreakdown(returnRow).productRefundAmount
          }
        }
        return sum - productRefundAmount
      }, 0)
  )
  const returnFeeReversal1066 = round2(
    returnFeeReversals.reduce((sum, row) => sum + num(row.commissionReversalGross), 0)
  )
  const returnBlocked =
    (batch.creditNoteBlockingRows || []).some((row) => row.blockCode) ||
    matchedReturns.some((row) => row.status === 'blocked')
  const settlementAdjustmentBlocked = Boolean(settlementAdjustmentJournal?.blocked)
  const plannedUndeposited1066 = round2(
    recordPayment1066 + settlementAdjustment1066 + returnPrincipal1066 + returnFeeReversal1066
  )
  const undepositedPlanningDifference = round2(targetUndeposited1066 - plannedUndeposited1066)
  const undepositedPlanningBlocked =
    Math.abs(undepositedPlanningDifference) >= PAYMENT_PREVIEW_TOLERANCE ||
    returnBlocked ||
    settlementAdjustmentBlocked

  const undepositedReconciliation = buildUndepositedReconciliation(
    batch,
    {
      ...basePreview,
      invoicePayments,
      feeJournalLines,
      settlementAdjustmentJournal,
      matchedReturns,
      returns,
      summary: {
        expectedNoonSettlement: expectedSettlement,
        targetUndeposited1066,
        recordPayment1066,
        settlementAdjustment1066,
        returnPrincipal1066,
        returnFeeReversal1066,
        plannedUndeposited1066,
        undepositedPlanningDifference,
      },
    },
    planExclusions
  )

  return {
    ...basePreview,
    status: blocked || undepositedPlanningBlocked ? 'blocked' : 'previewed',
    returns,
    returnFeeReversals,
    matchedReturns,
    creditNoteBlockingRows: batch.creditNoteBlockingRows || [],
    invoiceOverpayments,
    unclearedReclassJournals: reclass.lines,
    unclearedReclassSummary: reclass.summary,
    shippingBreakup,
    settlementAdjustmentJournal,
    settlementAdjustmentLines,
    paidInvoiceSubsidyJournal: null,
    paidInvoiceSubsidyLines,
    undepositedSettlementBridgeJournal,
    undepositedReconciliation,
    summary: {
      invoicePaymentCount: invoicePayments.length,
      totalInvoicePayments,
      totalFeesJournals: totalFeeJournals,
      totalUnclearedReclassJournals: totalReclassJournals,
      totalAdjustments: round2(
        [...adjustmentFolded, ...adjustmentJournalLines].reduce((a, l) => a + (Number(l.amount) || 0), 0)
      ),
      expectedNoonSettlement: expectedSettlement,
      targetUndeposited1066,
      recordPayment1066,
      paidInvoiceSubsidy1066: subsidy1066,
      settlementAdjustment1066,
      returnPrincipal1066,
      returnFeeReversal1066,
      returnBlocked,
      settlementAdjustmentBlocked,
      settlementAdjustmentJournalBalanced: settlementAdjustmentJournal?.journalAudit?.balanced ?? true,
      settlementAdjustmentJournalDifference: settlementAdjustmentJournal?.journalAudit?.difference ?? 0,
      returnRowCount: returnRows.length,
      settlementAdjustmentLineCount: adjustmentSummary.sourceRowCount || 0,
      settlementAdjustmentGrossNegative: adjustmentSummary.grossNegativeAdjustments || 0,
      settlementAdjustmentGrossPositive: adjustmentSummary.grossPositiveAdjustments || 0,
      settlementAdjustmentNetExpense: adjustmentSummary.netExpense || 0,
      settlementAdjustmentInputVat: adjustmentSummary.inputVat || 0,
      plannedUndeposited1066,
      undepositedPlanningDifference,
      undepositedSettlementBridgeAmount: 0,
      paidInvoiceSubsidyLineCount: paidInvoiceSubsidyLines.length,
      finalDifference: round2(
        expectedSettlement - round2(totalInvoicePayments - totalFeeJournals)
      ),
      unmappedFeeJournalCount: feeJournalLines.filter((l) => l.mappingStatus === 'needs_mapping').length,
      unmappedUnclearedReclassCount: reclass.summary.unmappedCount,
      invoiceOverpaymentCount: invoiceOverpayments.length,
      blocked: blocked || undepositedPlanningBlocked,
      blockedReason: settlementAdjustmentBlocked
        ? settlementAdjustmentJournal?.blockingReason ||
          'Settlement adjustment journal is blocked (duplicate source or unbalanced).'
        : returnBlocked
        ? `Return blocked: ${(batch.creditNoteBlockingRows || [])[0]?.blockingReason || 'Credit Note missing or mismatched.'}`
        : undepositedPlanningBlocked
        ? `Undeposited planning differs from statement subtotal by ${undepositedPlanningDifference} AED — explain before posting.`
        : blocked
          ? 'One or more invoice payment totals exceed the Zoho invoice value.'
          : null,
      ...shippingBreakup,
    },
  }
}

module.exports = {
  PAYMENT_PREVIEW_TOLERANCE,
  requireBatchForPaymentPreview,
  buildInvoicePaymentPlan,
  buildInvoicePaymentPlansFromBatch,
  buildReturnItemOrderIdSet,
  isSalesReturnItemOrderId,
  aggregatePaymentPlansByInvoice,
  isOrphanParentLogisticsRow,
  isPaidInvoiceSubsidyRow,
  buildPaymentPreviewFromBatch,
  collectAssignedUnclearedPaymentAddOns,
  collectPaidInvoiceSubsidyLines,
  buildPaidInvoiceSubsidyJournal,
  collectPlanExclusions,
  collectInvoiceOverpayments,
  assertNoStatementOverpayments,
  assertNoInvoiceOverpayments,
  annotateInvoicePaymentsWithLiveBalances,
  attachLiveZohoBalancesToPaymentPreview,
  computeStatementUndepositedTarget,
  buildUndepositedSettlementBridgeJournal,
  collectSettlementAdjustmentSourceRows,
  buildUndepositedReconciliation,
}
