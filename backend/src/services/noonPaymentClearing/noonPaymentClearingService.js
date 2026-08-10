const store = require('./noonPaymentClearingStore')
const { parseNoonStatementReportBuffer } = require('./noonStatementParserService')
const {
  buildPreview,
  buildFeeJournalPreviewLines,
  summarizeFeeJournalVat,
} = require('./noonPaymentClearingPreviewService')
const { matchZohoInvoicesForNoonRows, matchNoonRowsToInvoices } = require('./noonPaymentClearingZohoMatcher')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const { buildPaymentPreviewFromBatch } = require('./noonPaymentClearingPaymentPreviewService')
const { postApprovedBatch, forceRepostBatch } = require('./noonPaymentClearingPostingService')
const { clean } = require('./noonOrderIdHelper')

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
    matchResult = matchNoonRowsToInvoices(parsed.rows, options.invoices || [])
    matchResult.zohoCustomerName = customerName
    matchResult.zohoCustomerId = options.customerId || ''
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
  return {
    ...preview,
    batch,
    batchId: batch.batchId,
  }
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
    totals: {
      ...(batch.totals || {}),
      feeJournalInputVat: feeJournalVatSummary.inputVat,
      feeJournalNetExpense: feeJournalVatSummary.netExpense,
    },
    // Fee journal mappings are Step 9 — they must not block Step 8 approval.
    isCleanForApproval:
      isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary) &&
      !(batch.unmatchedOrders || []).length &&
      !(batch.multipleMatchItems || []).length &&
      !(batch.blockingIssues || []).some((i) => i.code === 'UNEXPLAINED_OTHER'),
    status: batch.status,
    postedToZoho: batch.postedToZoho,
    postingSummary: batch.postingSummary,
    approvedAt: batch.approvedAt,
    postedAt: batch.postedAt,
  }
}

async function approveSavedBatch(batchId, approvedBy) {
  const batch = await store.getBatchById(batchId)
  validateBatchReadyForApproval(batch)
  return store.approveBatch(batchId, approvedBy)
}

async function generatePaymentPreview(batchId, createdBy) {
  const batch = await store.getBatchById(batchId)
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
  return store.savePaymentPreview(batchId, paymentPreview, createdBy)
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
