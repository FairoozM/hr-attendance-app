const store = require('./noonPaymentClearingStore')
const { parseNoonStatementReportBuffer } = require('./noonStatementParserService')
const { buildPreview } = require('./noonPaymentClearingPreviewService')
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

async function buildPreviewFromUpload(buffer, fileName, options = {}) {
  const parsed = parseNoonStatementReportBuffer(buffer, fileName)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const customerName = clean(options.customerName) || cfg.zohoCustomerName
  const mappingRules = await store.listFeeJournalMappings('AE').catch(() => [])

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
    feeJournalLines: batch.feeJournalLines,
    blockingIssues: batch.blockingIssues,
    warnings: batch.warnings,
    zohoCustomerId: batch.zohoCustomerId,
    zohoCustomerName: batch.zohoCustomerName,
    totals: batch.totals,
    isCleanForApproval:
      isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary) &&
      !(batch.unmatchedOrders || []).length &&
      !(batch.multipleMatchItems || []).length,
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
  const mappingRules = await store.listFeeJournalMappings('AE')
  const paymentPreview = buildPaymentPreviewFromBatch(batch, mappingRules)
  return store.savePaymentPreview(batchId, paymentPreview, createdBy)
}

async function postBatchToZoho(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const mappingRules = await store.listFeeJournalMappings('AE')
  return postApprovedBatch({
    batch,
    dryRun: options.dryRun !== false,
    allowPosted: options.allowPosted === true,
    postedBy: options.postedBy,
    mappingRules,
    createPayment: options.createPayment,
    buildPayloadPreview: options.buildPayloadPreview,
    createManualJournal: options.createManualJournal,
    buildJournalPayloadPreview: options.buildJournalPayloadPreview,
  })
}

async function forceRepost(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const mappingRules = await store.listFeeJournalMappings('AE')
  return forceRepostBatch({
    batch,
    reason: options.reason,
    actorUserId: options.actorUserId,
    mappingRules,
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
  getNoonPaymentClearingMarketplaceConfig,
}
