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

const PAYMENT_PREVIEW_TOLERANCE = RECONCILIATION_TOLERANCE

function positiveAmount(value) {
  return Math.abs(round2(Number(value) || 0))
}

/** Same normalization as noonOrderIdHelper.matchKey — keeps exclusions comparable. */
function itemOrderMatchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
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
 * Parent / adjustment logistics assigned to a child invoice — add onto that child's
 * Record Payment buckets (1067 commission / 1068 shipping), Amazon KSA style.
 *
 * Do NOT add orderSubsidies on top of othersInclVat — the parser already merges
 * subsidies into othersInclVat (double-count produced bogus 22.68 from -37.8+7.56+7.56).
 */
function collectAssignedUnclearedPaymentAddOns(allRows = [], planExclusions = null, options = {}) {
  const byItem = new Map()
  const exInv = planExclusions?.excludedInvoiceIds
  const exItem = planExclusions?.excludedItemOrderIds
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (!options.ignoreExclusions && row.excludeFromPaymentClearing) continue
    if (!isUnclearedInvoicePaymentBucketRow(row)) continue
    const itemId = clean(row.assignedItemOrderId) || clean(row.itemOrderId)
    if (!itemId) continue
    const rowInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const rowItemKey = itemOrderMatchKey(itemId)
    if (exInv && rowInv && exInv.has(rowInv)) continue
    if (exItem && rowItemKey && exItem.has(rowItemKey)) continue

    const entry = byItem.get(itemId) || {
      commission: 0,
      fulfillment: 0,
      sourceRowNumbers: [],
      sourceBreakdown: [],
    }

    const referral = positiveAmount(row.referralFee)
    // Prefer statement Total when present — matches Noon settlement line.
    let fulfillment = 0
    if (Math.abs(num(row.total)) >= 0.01) {
      fulfillment = positiveAmount(row.total)
    } else {
      fulfillment = positiveAmount(
        round2(
          num(row.fulfillmentFee) +
            num(row.shippingCharges) +
            num(row.otherOrderFees) +
            num(row.othersInclVat)
        )
      )
    }

    entry.commission = round2(entry.commission + referral)
    entry.fulfillment = round2(entry.fulfillment + fulfillment)
    entry.sourceRowNumbers.push(row.rowNumber)
    entry.sourceBreakdown.push({
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      total: round2(num(row.total)),
      fulfillmentFee: round2(num(row.fulfillmentFee)),
      shippingCharges: round2(num(row.shippingCharges)),
      othersInclVat: round2(num(row.othersInclVat)),
      appliedFulfillment: fulfillment,
      appliedCommission: referral,
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
  const matched = (Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []).filter((item) => {
    if (!options.ignoreExclusions && item.excludeFromPaymentClearing) return false
    if (!options.ignoreExclusions && excludedInvoiceIds.has(clean(item.zohoInvoiceId))) return false
    if (!options.ignoreExclusions && excludedItemOrderIds.has(itemOrderMatchKey(item.itemOrderId))) return false
    return true
  })
  const allRows = batch.allRows || []
  const addOnsByItem = collectAssignedUnclearedPaymentAddOns(allRows, planExclusions, {
    ignoreExclusions: options.ignoreExclusions,
  })
  return matched.map((item) =>
    buildInvoicePaymentPlan(item, accounts, addOnsByItem.get(clean(item.itemOrderId)) || null)
  )
}

function buildInvoicePaymentPlan(item, accounts, addOns = null) {
  // Noon CSV "Net Proceeds" is sale/invoice gross (Amazon principal) — NOT cash after fees.
  // Example: Net Proceeds 759 / Referral -119.54 / Fulfillment -33.6 / Total 605.86
  // Record Payments that clear a 759 invoice:
  //   1066 undeposited = 605.86, 1067 commission = 119.54, 1068 shipping = 33.6
  const saleGross = positiveAmount(item.netProceed)
  const commission = round2(positiveAmount(item.referralFee) + positiveAmount(addOns?.commission))
  const fulfillmentShipping = round2(
    positiveAmount(round2(num(item.fulfillmentFee) + num(item.shippingCharges))) +
      positiveAmount(addOns?.fulfillment)
  )
  // Residual after parking commission + shipping on uncleared GLs (Amazon invoiceClearingNetBalance).
  const invoiceClearingNetBalance = round2(Math.max(0, saleGross - commission - fulfillmentShipping))
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
    parentLogisticsAddOn: positiveAmount(addOns?.fulfillment),
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
    } else if (invId && clearing >= 0.01 && !invoice) {
      balanceShortfalls.push({
        itemOrderId: p.itemOrderId || '',
        zohoInvoiceId: invId,
        zohoInvoiceNumber: p.zohoInvoiceNumber || '',
        invoiceTotal: positiveAmount(p.invoiceTotal),
        openBalance: null,
        totalClearingAmount: clearing,
        overBy: clearing,
        netBalance: positiveAmount(p.netBalancePayment?.amount ?? p.invoiceClearingNetBalance),
        commission: positiveAmount(p.commissionPayment?.amount ?? p.referralFee),
        shipping: positiveAmount(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping),
        parentLogisticsAddOn: positiveAmount(p.parentLogisticsAddOn),
        reason: 'Could not fetch Zoho invoice — cannot verify open balance',
      })
      next.balanceCheckMissingInvoice = true
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

function buildFoldedUnclearedChargeSummaries(allRows = []) {
  return (Array.isArray(allRows) ? allRows : [])
    .filter((row) => isUnclearedInvoicePaymentBucketRow(row))
    .map((row) => ({
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      feeType: row.normalizedFeeType || '',
      displayLabel: row.displayLabel || row.title || '',
      accountingTreatment: 'Invoice Record Payment → uncleared (first entry)',
      signedAmount: round2(num(row.total)),
      amount: Math.abs(round2(num(row.total))),
      parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
      assignedItemOrderId: clean(row.assignedItemOrderId) || clean(row.itemOrderId),
      previewNote: clean(row.assignedItemOrderId)
        ? row.assignmentReason === 'zoho_invoice_orphan_parent'
          ? `Folded via Zoho invoice ${clean(row.assignedZohoInvoiceNumber) || clean(row.assignedItemOrderId)} (sale not in this statement) → uncleared GL`
          : `Folded into invoice payment for ${clean(row.assignedItemOrderId)} → uncleared GL`
        : clean(row.itemOrderId)
          ? `Cleared via invoice payment for ${clean(row.itemOrderId)} → uncleared GL`
          : 'Uncleared via invoice payment (no child assignment — no Zoho invoice for this Noon parent order)',
      clearingPath: 'invoice_payment_uncleared',
    }))
}

function buildPaymentPreviewFromBatch(batch, mappingRules = [], inputVatAccount = null, accountOverrides = {}) {
  requireBatchForPaymentPreview(batch)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const invoicePayments = buildInvoicePaymentPlansFromBatch(batch, accountOverrides)
  const allRows = batch.allRows || []
  const feeJournalLines = buildFeeJournalPreviewLines(
    allRows,
    mappingRules,
    inputVatAccount || batch.inputVatAccount || accountOverrides.inputVatAccount || null
  )
  const foldedUnclearedCharges = buildFoldedUnclearedChargeSummaries(allRows)
  const parentChargeLines = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const adjustmentFolded = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const statementFeeLines = feeJournalLines.filter((l) => l.rowClass === 'statement_fee')
  // Non-logistics adjustments that still journal (rare) stay as journal clearings.
  const adjustmentJournalLines = feeJournalLines.filter((l) => l.rowClass === 'order_adjustment')

  const totalInvoicePayments = round2(invoicePayments.reduce((a, p) => a + p.totalClearingAmount, 0))
  const totalFeeJournals = round2(feeJournalLines.reduce((a, l) => a + l.amount, 0))
  const expectedSettlement = round2(batch.reconciliationSummary?.expectedSettlement || 0)
  const metadata = batch.reportSnapshot || batch.metadata || {}
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

  return {
    ...basePreview,
    status: blocked ? 'blocked' : 'previewed',
    invoiceOverpayments,
    unclearedReclassJournals: reclass.lines,
    unclearedReclassSummary: reclass.summary,
    summary: {
      invoicePaymentCount: invoicePayments.length,
      totalInvoicePayments,
      totalFeesJournals: totalFeeJournals,
      totalUnclearedReclassJournals: totalReclassJournals,
      totalAdjustments: round2(
        [...adjustmentFolded, ...adjustmentJournalLines].reduce((a, l) => a + (Number(l.amount) || 0), 0)
      ),
      expectedNoonSettlement: expectedSettlement,
      finalDifference: round2(
        expectedSettlement - round2(totalInvoicePayments - totalFeeJournals)
      ),
      unmappedFeeJournalCount: feeJournalLines.filter((l) => l.mappingStatus === 'needs_mapping').length,
      unmappedUnclearedReclassCount: reclass.summary.unmappedCount,
      invoiceOverpaymentCount: invoiceOverpayments.length,
      blocked,
      blockedReason: blocked
        ? 'One or more invoice payment totals exceed the Zoho invoice value.'
        : null,
    },
  }
}

module.exports = {
  PAYMENT_PREVIEW_TOLERANCE,
  requireBatchForPaymentPreview,
  buildInvoicePaymentPlan,
  buildInvoicePaymentPlansFromBatch,
  aggregatePaymentPlansByInvoice,
  buildPaymentPreviewFromBatch,
  collectAssignedUnclearedPaymentAddOns,
  collectPlanExclusions,
  collectInvoiceOverpayments,
  assertNoStatementOverpayments,
  assertNoInvoiceOverpayments,
  annotateInvoicePaymentsWithLiveBalances,
  attachLiveZohoBalancesToPaymentPreview,
}
