const store = require('./noonPaymentClearingStore')
const { parseNoonStatementReportBuffer } = require('./noonStatementParserService')
const {
  buildPreview,
  buildFeeJournalPreviewLines,
  summarizeFeeJournalVat,
} = require('./noonPaymentClearingPreviewService')
const { matchZohoInvoicesForNoonRows, matchNoonRowsToInvoices, mapInvoice } = require('./noonPaymentClearingZohoMatcher')
const {
  applyParentOrderChargeFallbackWithSynthetics,
  needsParentOrderFallback,
} = require('./noonPaymentClearingParentChargeFallback')
const { buildNoonOrderHierarchy } = require('./noonPaymentClearingHierarchyService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const {
  buildPaymentPreviewFromBatch,
  assertNoInvoiceOverpayments,
  attachLiveZohoBalancesToPaymentPreview,
  buildInvoicePaymentPlansFromBatch,
  annotateInvoicePaymentsWithLiveBalances,
} = require('./noonPaymentClearingPaymentPreviewService')
const { postApprovedBatch, forceRepostBatch } = require('./noonPaymentClearingPostingService')
const { clean, matchKey } = require('./noonOrderIdHelper')
const { ROW_CLASS } = require('./noonPaymentClearingCategoryService')
const { fetchInvoicesByIds } = require('../../integrations/zoho/zohoBooksClient')

function validateBatchReadyForApproval(batch) {
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary)) {
    const err = new Error('Approval blocked: statement is not reconciled.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Approval blocked: required child invoices are missing.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.multipleMatchItems) && batch.multipleMatchItems.length > 0) {
    const err = new Error('Approval blocked: duplicate invoice matches must be resolved.')
    err.code = 'NOON_PAYMENT_CLEARING_MULTIPLE_MATCHES'
    err.status = 422
    throw err
  }
  const unexplained = (batch.blockingIssues || []).filter((i) => i.code === 'UNEXPLAINED_OTHER')
  if (unexplained.length) {
    const err = new Error('Approval blocked: unexplained transaction amounts remain.')
    err.code = 'NOON_PAYMENT_CLEARING_UNEXPLAINED_OTHER'
    err.status = 422
    throw err
  }
  const balanceIssues = (batch.blockingIssues || []).filter((i) => i.code === 'OPEN_BALANCE_SHORT')
  const shortfalls = batch.reportSnapshot?.openBalanceReconcile?.shortfalls || []
  if (balanceIssues.length || shortfalls.length) {
    const sample = (shortfalls[0] &&
      `${shortfalls[0].zohoInvoiceNumber || shortfalls[0].itemOrderId}: clearing ${shortfalls[0].totalClearingAmount} > open balance ${shortfalls[0].openBalance}`) ||
      balanceIssues[0]?.message ||
      ''
    const err = new Error(
      `Approval blocked: ${shortfalls.length || balanceIssues.length} invoice(s) lack open Zoho balance. Fix in Parent-Level Charges (exclude already-paid logistics). ${sample}`
    )
    err.code = 'NOON_PAYMENT_CLEARING_OPEN_BALANCE_SHORT'
    err.status = 422
    err.details = { invoiceBalanceShortfalls: shortfalls }
    throw err
  }
}

async function resolveAccountByCodeOrName(target) {
  const code = clean(target?.accountCode)
  const name = clean(target?.accountName)
  if (clean(target?.accountId)) return target
  if (!code && !name) return target || {}
  try {
    const { listZohoChartAccounts } = require('../amazonPaymentClearingZohoPaymentService')
    const accounts = await listZohoChartAccounts()
    const hit = (Array.isArray(accounts) ? accounts : []).find((a) => {
      const aCode = clean(a.accountCode || a.account_code)
      const aName = clean(a.accountName || a.account_name)
      return (code && aCode === code) || (name && aName === name)
    })
    if (hit) {
      return {
        accountId: clean(hit.accountId || hit.account_id),
        accountName: clean(hit.accountName || hit.account_name) || name,
        accountCode: clean(hit.accountCode || hit.account_code) || code,
      }
    }
  } catch {
    // Preview/tests can run with codes only.
  }
  return target || {}
}

async function loadMappingContext() {
  const mappingRules = await store.listFeeJournalMappings('AE').catch(() => [])
  const inputVatSettings = await store.getInputVatSettings('AE').catch(() => null)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const undeposited = await resolveAccountByCodeOrName(cfg.undepositedFundsAccount)
  const unclearedCommission = await resolveAccountByCodeOrName(cfg.unclearedCommissionAccount)
  const unclearedShipping = await resolveAccountByCodeOrName(cfg.unclearedShippingAccount)
  const commissionExpense = await resolveAccountByCodeOrName(cfg.commissionExpenseAccount)
  const shippingExpense = await resolveAccountByCodeOrName(cfg.shippingExpenseAccount)
  const inputVatDefault = await resolveAccountByCodeOrName(cfg.inputVatAccount)
  const inputVatAccount = {
    ...inputVatDefault,
    ...(inputVatSettings || {}),
    accountId: clean(inputVatSettings?.accountId || inputVatSettings?.inputVatAccountId) || inputVatDefault.accountId,
    accountName:
      clean(inputVatSettings?.accountName || inputVatSettings?.inputVatAccountName) ||
      inputVatDefault.accountName,
    accountCode:
      clean(inputVatSettings?.accountCode || inputVatSettings?.inputVatAccountCode) ||
      inputVatDefault.accountCode,
    vatRate: inputVatSettings?.vatRate ?? cfg.vatRate,
  }
  // Patch cfg-style payment accounts with resolved IDs for this request.
  cfg.undepositedFundsAccount = undeposited
  cfg.unclearedCommissionAccount = unclearedCommission
  cfg.unclearedShippingAccount = unclearedShipping
  cfg.commissionExpenseAccount = commissionExpense
  cfg.shippingExpenseAccount = shippingExpense
  cfg.inputVatAccount = inputVatDefault
  cfg.paymentPreviewAccounts = {
    NET_BALANCE: {
      depositToAccountCode: undeposited.accountCode,
      depositToAccountName: undeposited.accountName,
      depositToAccountId: undeposited.accountId,
    },
    COMMISSION: {
      depositToAccountCode: unclearedCommission.accountCode,
      depositToAccountName: unclearedCommission.accountName,
      depositToAccountId: unclearedCommission.accountId,
    },
    FULFILLMENT_SHIPPING: {
      depositToAccountCode: unclearedShipping.accountCode,
      depositToAccountName: unclearedShipping.accountName,
      depositToAccountId: unclearedShipping.accountId,
    },
  }
  return {
    mappingRules,
    /** Advertising / default fee-journal counter (Amazon 1024 parallel). */
    settlementBridgeAccount: undeposited,
    unclearedShippingAccount: unclearedShipping,
    unclearedCommissionAccount: unclearedCommission,
    commissionExpenseAccount: commissionExpense,
    shippingExpenseAccount: shippingExpense,
    inputVatAccount,
    zohoCustomerName: cfg.zohoCustomerName,
    marketplaceConfig: cfg,
  }
}

async function buildPreviewFromUpload(buffer, fileName, options = {}) {
  const parsed = parseNoonStatementReportBuffer(buffer, fileName)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const customerName = clean(options.customerName) || cfg.zohoCustomerName
  const { mappingRules, inputVatAccount } = await loadMappingContext()

  let matchResult
  if (options.skipZohoMatch || options.invoices) {
    const invoiceList = options.invoices || []
    matchResult = matchNoonRowsToInvoices(parsed.rows, invoiceList)
    matchResult.zohoCustomerName = customerName
    matchResult.zohoCustomerId = options.customerId || ''
    matchResult.invoices = invoiceList.map((inv) =>
      inv && inv.zohoInvoiceId ? inv : mapInvoice(inv)
    )
  } else {
    try {
      matchResult = await matchZohoInvoicesForNoonRows(parsed.rows, {
        customerName,
        customerId: options.customerId,
      })
    } catch (err) {
      if (options.allowMatchFailure) {
        matchResult = matchNoonRowsToInvoices(parsed.rows, [])
        matchResult.zohoCustomerName = customerName
        parsed.warnings.push(err.message || 'Zoho invoice match failed')
      } else {
        throw err
      }
    }
  }

  const preview = buildPreview({
    rows: parsed.rows,
    metadata: parsed.metadata,
    matchResult,
    mappingRules,
    inputVatAccount,
    zohoCustomerId: matchResult.zohoCustomerId || options.customerId || '',
    zohoCustomerName: matchResult.zohoCustomerName || customerName,
    warnings: parsed.warnings,
  })

  const batch = await store.savePreviewBatch(preview, options.createdBy)
  // Early open-balance check (before approve / payment preview).
  try {
    await reconcileOpenBalances(batch.batchId)
  } catch (err) {
    console.warn('[noon-payment-clearing] open balance reconcile after upload failed:', err?.message || err)
  }
  return getBatchPreview(batch.batchId)
}

async function getBatchPreview(batchId) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const { mappingRules, settlementBridgeAccount, inputVatAccount, marketplaceConfig } =
    await loadMappingContext()
  // Rebuild fee journals live so mapping / VAT / Amazon-style clearing counters apply.
  const feeJournalLines = buildFeeJournalPreviewLines(batch.allRows || [], mappingRules, inputVatAccount)
  const feeJournalVatSummary = summarizeFeeJournalVat(feeJournalLines)
  const openBalanceShortfalls = batch.reportSnapshot?.openBalanceReconcile?.shortfalls || []
  const openBalanceCheckedAt = batch.reportSnapshot?.openBalanceReconcile?.checkedAt || null
  const hasOpenBalanceBlock = openBalanceShortfalls.length > 0 ||
    (batch.blockingIssues || []).some((i) => i.code === 'OPEN_BALANCE_SHORT')
  return {
    batch,
    batchId: batch.batchId,
    metadata: batch.reportSnapshot,
    allRows: batch.allRows,
    hierarchy: batch.hierarchy,
    matchedOrders: batch.matchedOrders,
    unmatchedOrders: batch.unmatchedOrders,
    multipleMatchItems: batch.multipleMatchItems,
    parentCharges: batch.parentCharges,
    adjustments: batch.adjustments,
    statementFees: batch.statementFees,
    reconciliationSummary: batch.reconciliationSummary,
    feeJournalLines,
    feeJournalVatSummary,
    settlementBridgeAccount,
    paymentPreviewAccounts: marketplaceConfig?.paymentPreviewAccounts,
    inputVatAccount,
    blockingIssues: batch.blockingIssues,
    warnings: batch.warnings,
    zohoCustomerId: batch.zohoCustomerId,
    zohoCustomerName: batch.zohoCustomerName,
    openBalanceShortfalls,
    openBalanceCheckedAt,
    totals: {
      ...(batch.totals || {}),
      feeJournalInputVat: feeJournalVatSummary.inputVat,
      feeJournalNetExpense: feeJournalVatSummary.netExpense,
      openBalanceShortfallCount: openBalanceShortfalls.length,
    },
    // Fee journal mappings are Step 9 — they must not block Step 8 approval.
    // Open-balance shortfalls DO block approval (fix in Parent Charges step).
    isCleanForApproval:
      isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary) &&
      !(batch.unmatchedOrders || []).length &&
      !(batch.multipleMatchItems || []).length &&
      !(batch.blockingIssues || []).some((i) => i.code === 'UNEXPLAINED_OTHER') &&
      !hasOpenBalanceBlock,
    status: batch.status,
    postedToZoho: batch.postedToZoho,
    postingSummary: batch.postingSummary,
    approvedAt: batch.approvedAt,
    postedAt: batch.postedAt,
  }
}

/**
 * Early reconcile: compare planned clearing vs live Zoho open balance.
 * Stores shortfalls on the batch so Step 6 / Approve can show + rectify them.
 */
async function reconcileOpenBalances(batchId) {
  let batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  // Ensure orphan logistics are assigned before balance check.
  try {
    batch = (await rematchOrphanParentLogistics(batch)) || batch
  } catch (err) {
    console.warn('[noon-payment-clearing] orphan rematch during balance reconcile failed:', err?.message || err)
  }
  const plans = buildInvoicePaymentPlansFromBatch(batch)
  const ids = plans.map((p) => p.zohoInvoiceId).filter(Boolean)
  let invoiceById = new Map()
  try {
    invoiceById = await fetchInvoicesByIds(ids)
  } catch (err) {
    const warn = err?.message || 'Could not fetch Zoho invoice balances'
    await store.updateBatchOpenBalanceReconcile(batch.batchId, {
      openBalanceReconcile: {
        checkedAt: new Date().toISOString(),
        shortfalls: [],
        warning: warn,
      },
      blockingIssues: (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT'),
    })
    return getBatchPreview(batch.batchId)
  }
  const { invoiceBalanceShortfalls } = annotateInvoicePaymentsWithLiveBalances(plans, invoiceById)
  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT')
  for (const s of invoiceBalanceShortfalls) {
    blockingIssues.push({
      code: 'OPEN_BALANCE_SHORT',
      severity: 'error',
      itemOrderId: s.itemOrderId,
      zohoInvoiceId: s.zohoInvoiceId,
      zohoInvoiceNumber: s.zohoInvoiceNumber,
      openBalance: s.openBalance,
      totalClearingAmount: s.totalClearingAmount,
      overBy: s.overBy,
      message: `${s.zohoInvoiceNumber || s.itemOrderId}: clearing ${s.totalClearingAmount} > open balance ${s.openBalance} (over by ${s.overBy}). Exclude already-paid logistics or void Zoho payments first.`,
    })
  }
  await store.updateBatchOpenBalanceReconcile(batch.batchId, {
    openBalanceReconcile: {
      checkedAt: new Date().toISOString(),
      shortfalls: invoiceBalanceShortfalls,
    },
    blockingIssues,
  })
  return getBatchPreview(batch.batchId)
}

/**
 * Rectify: exclude logistics / logistics-only matches on already-paid invoices
 * so they are not sent as Record Payments (user handles offline if needed).
 */
async function excludeOpenBalanceShortfalls(batchId, { zohoInvoiceIds = [], itemOrderIds = [] } = {}) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const invSet = new Set((zohoInvoiceIds || []).map((id) => clean(id)).filter(Boolean))
  const itemSet = new Set((itemOrderIds || []).map((id) => matchKey(id)).filter(Boolean))
  // If nothing specified, exclude all current shortfalls.
  const shortfalls = batch.reportSnapshot?.openBalanceReconcile?.shortfalls || []
  if (!invSet.size && !itemSet.size) {
    for (const s of shortfalls) {
      if (s.zohoInvoiceId) invSet.add(clean(s.zohoInvoiceId))
      if (s.itemOrderId) itemSet.add(matchKey(s.itemOrderId))
    }
  }
  if (!invSet.size && !itemSet.size) {
    const err = new Error('No open-balance shortfall invoices to exclude.')
    err.code = 'NOON_PAYMENT_CLEARING_NO_SHORTFALLS'
    err.status = 422
    throw err
  }

  const matchedOrders = (batch.matchedOrders || []).map((m) => {
    const hit =
      (m.zohoInvoiceId && invSet.has(clean(m.zohoInvoiceId))) ||
      (m.itemOrderId && itemSet.has(matchKey(m.itemOrderId)))
    if (!hit) return m
    return {
      ...m,
      excludeFromPaymentClearing: true,
      excludeReason: 'open_balance_short_already_paid',
    }
  })

  const allRows = (batch.allRows || []).map((row) => {
    const assignedInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const assignedItem = matchKey(row.assignedItemOrderId || row.itemOrderId)
    const hit =
      (assignedInv && invSet.has(assignedInv)) || (assignedItem && itemSet.has(assignedItem))
    if (!hit) return row
    // Only exclude uncleared logistics / parent charges — not sale lines with net proceeds.
    const isLogistics =
      row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE ||
      row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT ||
      (Math.abs(Number(row.netProceed) || 0) < 0.01 &&
        (Math.abs(Number(row.total) || 0) >= 0.01 ||
          Math.abs(Number(row.fulfillmentFee) || 0) >= 0.01))
    if (!isLogistics) return row
    return {
      ...row,
      excludeFromPaymentClearing: true,
      excludeReason: 'open_balance_short_already_paid',
    }
  })

  const parentCharges = allRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  await store.updateBatchOpenBalanceReconcile(batch.batchId, {
    allRows,
    matchedOrders,
    parentCharges,
    blockingIssues: (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT'),
    openBalanceReconcile: {
      checkedAt: batch.reportSnapshot?.openBalanceReconcile?.checkedAt || null,
      shortfalls: [],
      lastExcludeAt: new Date().toISOString(),
      excludedInvoiceIds: [...invSet],
    },
  })
  // Re-check live balances after exclusions.
  return reconcileOpenBalances(batch.batchId)
}

async function approveSavedBatch(batchId, approvedBy) {
  // Refresh live balances before approve so Step 8 cannot ignore open-balance issues.
  await reconcileOpenBalances(batchId)
  const batch = await store.getBatchById(batchId)
  validateBatchReadyForApproval(batch)
  return store.approveBatch(batchId, approvedBy)
}

async function rematchOrphanParentLogistics(batch) {
  if (!batch) return batch
  const rows = Array.isArray(batch.allRows) ? batch.allRows : []
  const orphans = rows.filter(
    (r) =>
      needsParentOrderFallback(r) &&
      (!clean(r.assignedItemOrderId) || r.parentFallbackStatus === 'no_matched_child')
  )
  if (!orphans.length) return batch

  const matchResult = await matchZohoInvoicesForNoonRows(rows, {
    customerName: batch.zohoCustomerName,
    customerId: batch.zohoCustomerId,
  })
  const parentAssign = applyParentOrderChargeFallbackWithSynthetics(
    rows,
    batch.matchedOrders || [],
    matchResult.invoices || []
  )
  const existingMatched = Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []
  const matchedOrders = [
    ...existingMatched,
    ...(parentAssign.syntheticMatchedOrders || []).filter(
      (syn) =>
        !existingMatched.some(
          (m) =>
            clean(m.zohoInvoiceId) === clean(syn.zohoInvoiceId) ||
            matchKey(m.itemOrderId) === matchKey(syn.itemOrderId)
        )
    ),
  ]
  const hierarchy = buildNoonOrderHierarchy(parentAssign.rows)
  const parentCharges = parentAssign.rows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const stillOrphan = parentAssign.rows.filter((r) => r.parentFallbackStatus === 'no_matched_child')
  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'ORPHAN_PARENT_LOGISTICS')
  for (const row of stillOrphan) {
    blockingIssues.push({
      code: 'ORPHAN_PARENT_LOGISTICS',
      severity: 'warning',
      rowNumber: row.rowNumber,
      parentOrderId: row.parentOrderId || row.originalParentOrderId || '',
      message: `Parent logistics ${clean(row.parentOrderId || row.originalParentOrderId)} has no matched child in this statement and no Zoho invoice for that Noon order id.`,
    })
  }
  return store.updateBatchParentAssignments(batch.batchId, {
    allRows: parentAssign.rows,
    matchedOrders,
    parentCharges,
    hierarchy,
    blockingIssues,
  })
}

async function generatePaymentPreview(batchId, createdBy) {
  let batch = await store.getBatchById(batchId)
  // Re-fetch Zoho invoices for parent logistics that had no child in this statement.
  try {
    batch = (await rematchOrphanParentLogistics(batch)) || batch
  } catch (err) {
    console.warn('[noon-payment-clearing] orphan parent Zoho rematch failed:', err?.message || err)
  }
  const ctx = await loadMappingContext()
  const paymentPreview = buildPaymentPreviewFromBatch(batch, ctx.mappingRules, ctx.inputVatAccount, {
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    inputVatAccount: ctx.inputVatAccount,
    paymentPreviewAccounts: ctx.marketplaceConfig?.paymentPreviewAccounts,
    vatRate: ctx.inputVatAccount?.vatRate,
  })
  // Live Zoho open-balance check — blocks orphan logistics on already-paid invoices (Zoho 24016).
  const withBalances = await attachLiveZohoBalancesToPaymentPreview(paymentPreview)
  assertNoInvoiceOverpayments(withBalances)
  return store.savePaymentPreview(batchId, withBalances, createdBy)
}

async function postBatchToZoho(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const ctx = await loadMappingContext()
  return postApprovedBatch({
    batch,
    dryRun: options.dryRun !== false,
    allowPosted: options.allowPosted === true,
    postedBy: options.postedBy,
    mappingRules: ctx.mappingRules,
    settlementBridgeAccount: ctx.settlementBridgeAccount,
    inputVatAccount: ctx.inputVatAccount,
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    marketplaceConfig: ctx.marketplaceConfig,
    createPayment: options.createPayment,
    buildPayloadPreview: options.buildPayloadPreview,
    createManualJournal: options.createManualJournal,
    buildJournalPayloadPreview: options.buildJournalPayloadPreview,
  })
}

async function forceRepost(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const ctx = await loadMappingContext()
  return forceRepostBatch({
    batch,
    reason: options.reason,
    actorUserId: options.actorUserId,
    mappingRules: ctx.mappingRules,
    settlementBridgeAccount: ctx.settlementBridgeAccount,
    inputVatAccount: ctx.inputVatAccount,
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    marketplaceConfig: ctx.marketplaceConfig,
  })
}

module.exports = {
  buildPreviewFromUpload,
  getBatchPreview,
  reconcileOpenBalances,
  excludeOpenBalanceShortfalls,
  approveSavedBatch,
  validateBatchReadyForApproval,
  generatePaymentPreview,
  postBatchToZoho,
  forceRepost,
  listSavedBatches: store.listSavedBatches,
  listFeeJournalMappings: store.listFeeJournalMappings,
  saveFeeJournalMapping: store.saveFeeJournalMapping,
  deactivateFeeJournalMapping: store.deactivateFeeJournalMapping,
  getInputVatSettings: store.getInputVatSettings,
  saveInputVatSettings: store.saveInputVatSettings,
  getNoonPaymentClearingMarketplaceConfig,
}
