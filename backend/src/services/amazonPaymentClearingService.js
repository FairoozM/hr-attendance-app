const {
  listAmazonReports,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  marketplaceIdForKey,
  throwAmazonSpApiIfFailed,
} = require('./amazonSpApiService')
const { parseAmazonSettlementReport } = require('./amazonSettlementParserService')
const { matchZohoInvoicesForRows } = require('./amazonPaymentClearingZohoMatcher')
const {
  buildPreview,
  buildBlockingIssues,
  buildNonOrderLinkedAmazonFeeMappings,
  applyNetNegativeOrderAdjustments,
} = require('./amazonPaymentClearingPreviewService')
const { ROW_CLASS, isNonOrderLinkedAmazonFee, CATEGORY } = require('./amazonPaymentClearingCategoryService')
const { isSettlementReturnRow } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildPaymentPreviewFromBatch } = require('./amazonPaymentClearingPaymentPreviewService')
const { postApprovedBatch } = require('./amazonPaymentClearingPostingService')
const { buildSettlementReference } = require('./amazonPaymentClearingReferenceService')
const { getAccountDiagnostics, listZohoChartAccounts } = require('./amazonPaymentClearingZohoPaymentService')
const { buildZohoOAuthAuthorizeUrl, exchangeZohoAuthorizationCode } = require('../integrations/zoho/zohoOAuth')
const store = require('./amazonPaymentClearingStore')

const MARKETPLACE_KEY = 'ksa'
const MARKETPLACE = 'KSA'
const SETTLEMENT_REPORT_TYPE =
  process.env.AMAZON_KSA_SETTLEMENT_REPORT_TYPE || 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function extractReports(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.reports)) return data.reports
  if (Array.isArray(data.payload?.reports)) return data.payload.reports
  if (Array.isArray(data.payload)) return data.payload
  return []
}

function normalizeReport(report) {
  if (!report || typeof report !== 'object') return null
  return {
    reportId: report.reportId || '',
    reportDocumentId: report.reportDocumentId || '',
    reportType: report.reportType || '',
    processingStatus: report.processingStatus || '',
    createdTime: report.createdTime || report.createdAt || '',
    processingEndTime: report.processingEndTime || '',
    dataStartTime: report.dataStartTime || '',
    dataEndTime: report.dataEndTime || '',
    marketplaceIds: Array.isArray(report.marketplaceIds) ? report.marketplaceIds : [],
    raw: report,
  }
}

async function listRecentSettlementReports(options = {}) {
  const marketplaceId = marketplaceIdForKey(MARKETPLACE_KEY)
  const createdSince = options.createdSince || isoDaysAgo(Number(options.daysBack) || 60)
  const spRes = await listAmazonReports({
    marketplaceKey: MARKETPLACE_KEY,
    reportTypes: [SETTLEMENT_REPORT_TYPE],
    processingStatuses: ['DONE'],
    marketplaceIds: [marketplaceId],
    createdSince,
    pageSize: options.pageSize || 20,
  })
  throwAmazonSpApiIfFailed(spRes, 'listSettlementReports', MARKETPLACE_KEY)
  const reports = extractReports(spRes.data)
    .map(normalizeReport)
    .filter(Boolean)
    .sort((a, b) => String(b.createdTime || b.processingEndTime).localeCompare(String(a.createdTime || a.processingEndTime)))
  return {
    success: true,
    marketplace: MARKETPLACE,
    reportType: SETTLEMENT_REPORT_TYPE,
    marketplaceId,
    reports,
  }
}

async function resolveReport(options = {}) {
  if (options.reportId) {
    const spRes = await getAmazonReport(options.reportId, { marketplaceKey: MARKETPLACE_KEY })
    throwAmazonSpApiIfFailed(spRes, 'getSettlementReport', MARKETPLACE_KEY)
    const report = normalizeReport(spRes.data) || { reportId: options.reportId, reportDocumentId: '' }
    return report
  }
  if (options.reportDocumentId) {
    return {
      reportId: '',
      reportDocumentId: String(options.reportDocumentId).trim(),
      reportType: SETTLEMENT_REPORT_TYPE,
      processingStatus: 'DONE',
      createdTime: '',
      processingEndTime: '',
      dataStartTime: '',
      dataEndTime: '',
      marketplaceIds: [marketplaceIdForKey(MARKETPLACE_KEY)],
      raw: {},
    }
  }
  const recent = await listRecentSettlementReports({ daysBack: options.daysBack, pageSize: options.pageSize })
  const report = recent.reports.find((r) => r.reportDocumentId) || recent.reports[0]
  if (!report) {
    const err = new Error('No recent KSA settlement report found in Amazon SP-API.')
    err.code = 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND'
    err.status = 404
    throw err
  }
  return report
}

async function downloadSettlementReportDocument(reportDocumentId) {
  const doc = await getAmazonReportDocument(reportDocumentId, { marketplaceKey: MARKETPLACE_KEY })
  throwAmazonSpApiIfFailed(doc, 'getSettlementReportDocument', MARKETPLACE_KEY)
  const download = await downloadAmazonReportDocument(doc.data?.url, {
    marketplaceKey: MARKETPLACE_KEY,
    compressionAlgorithm: doc.data?.compressionAlgorithm,
  })
  throwAmazonSpApiIfFailed(download, 'downloadSettlementReportDocument', MARKETPLACE_KEY)
  return download.data || ''
}

async function buildPreviewFromReport(options = {}) {
  const forceRefresh = options.forceRefresh === true

  // Fetch-once: when the report is already saved locally, reopen it from the
  // database instead of calling Amazon SP-API again.
  if (!forceRefresh && (options.reportDocumentId || options.reportId)) {
    const cached = await store.findBatchByReport({
      reportId: options.reportId,
      reportDocumentId: options.reportDocumentId,
    })
    if (cached) {
      return { ...(await hydrateSavedBatch(cached)), fromCache: true }
    }
  }

  const report = await resolveReport(options)
  if (!report.reportDocumentId) {
    const err = new Error('Selected Amazon settlement report is missing reportDocumentId.')
    err.code = 'AMAZON_SETTLEMENT_REPORT_DOCUMENT_MISSING'
    err.status = 422
    throw err
  }

  const existing = await store.findBatchByReport({
    reportId: report.reportId,
    reportDocumentId: report.reportDocumentId,
  })
  if (existing && !forceRefresh) {
    return { ...(await hydrateSavedBatch(existing)), fromCache: true }
  }
  if (existing && forceRefresh && (existing.status === 'posted' || existing.postedToZoho)) {
    const err = new Error('This settlement has already been posted to Zoho and cannot be refreshed from Amazon. Use Force Repost if you must re-post.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }

  const text = await downloadSettlementReportDocument(report.reportDocumentId)
  const parsed = parseAmazonSettlementReport(text)
  const zohoMatch = await matchZohoInvoicesForRows(parsed.rows, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    customerId: options.zohoCustomerId || null,
  })
  const feeJournalMappingRules = await store.listFeeJournalMappings({ marketplace: MARKETPLACE }).catch(() => [])
  const metadata = parsed.metadata || {}
  const preview = buildPreview({
    report: {
      reportId: report.reportId,
      reportDocumentId: report.reportDocumentId,
      settlementId: metadata.settlementId,
      settlementStartDate: metadata.settlementStartDate,
      settlementEndDate: metadata.settlementEndDate,
      depositDate: metadata.depositDate,
      currency: metadata.currency || 'SAR',
    },
    rows: parsed.rows,
    invoices: zohoMatch.invoices,
    matchedReturns: zohoMatch.matchedReturns,
    missingCreditNotes: zohoMatch.missingCreditNotes,
    creditNoteBlockingRows: zohoMatch.creditNoteBlockingRows,
    parserWarnings: [...(parsed.warnings || []), ...(zohoMatch.zohoFetchWarnings || [])],
    rawRowCount: parsed.rawRowCount,
    feeJournalMappingRules,
    syntheticRefundRows: zohoMatch.syntheticRefundRows || [],
    netNegativeReturnOrderIds: zohoMatch.netNegativeReturnOrderIds || [],
  })
  // One statement per settlement period: Amazon hands out a fresh report id /
  // document id every time you request the same settlement, so reuse the
  // existing batch keyed on the stable settlement id instead of inserting a
  // duplicate. Already-posted settlements are reopened, never overwritten.
  let reuseBatchId = existing ? existing.batchId : null
  let reusedExisting = Boolean(existing)
  if (!reuseBatchId && metadata.settlementId) {
    const bySettlement = await store.findBatchBySettlement(metadata.settlementId, MARKETPLACE)
    if (bySettlement) {
      if (!forceRefresh && (bySettlement.status === 'posted' || bySettlement.postedToZoho)) {
        return { ...(await hydrateSavedBatch(bySettlement)), fromCache: true }
      }
      reuseBatchId = bySettlement.batchId
      reusedExisting = true
    }
  }

  const savedBatch = await store.savePreviewBatch({
    preview,
    rows: parsed.rows,
    createdBy: options.createdBy,
    existingBatchId: reuseBatchId,
  })
  return {
    success: true,
    batch: savedBatch,
    refreshedFromAmazon: Boolean(reusedExisting && forceRefresh),
    ...preview,
  }
}

async function matchZohoInvoicesPreview(rows, options = {}) {
  const result = await matchZohoInvoicesForRows(Array.isArray(rows) ? rows : [], options)
  return {
    success: true,
    matchedRows: result.matchedRows,
    unmatchedRows: result.unmatchedRows,
    matchedInvoices: result.matchedInvoices,
    unmatchedOrderIds: result.unmatchedOrderIds,
    duplicateZohoInvoiceNumbers: result.duplicateZohoInvoiceNumbers,
    duplicateZohoPoNumbers: result.duplicateZohoPoNumbers,
    missingOrderIdRows: result.missingOrderIdRows,
  }
}

function deriveLifecycleStatus(batch) {
  if (!batch) return 'draft'
  if (batch.status === 'posted' || batch.postedToZoho) return 'posted'
  const reconciledClean =
    batch.reconciliationSummary?.reconciliationStatus !== 'mismatch' &&
    (!Array.isArray(batch.unmatchedOrders) || batch.unmatchedOrders.length === 0) &&
    (!Array.isArray(batch.creditNoteBlockingRows) || batch.creditNoteBlockingRows.length === 0)
  if (batch.status === 'approved') return 'ready_to_post'
  return reconciledClean ? 'ready_for_review' : 'draft'
}

function resolveStoredRowClass(row) {
  const existing = String(row?.rowClass || '').trim().toLowerCase()
  if (existing === 'refund' || existing === 'return') return existing
  const category = String(row?.category || '').trim().toLowerCase()
  if (category === 'refund') return ROW_CLASS.REFUND
  if (category === 'return') return ROW_CLASS.RETURN
  const tx = String(row?.transactionType || '').trim().toLowerCase()
  if (tx.includes('refund')) return ROW_CLASS.REFUND
  if (tx.includes('return')) return ROW_CLASS.RETURN
  return row?.rowClass || ''
}

function reconstructAllRowsFromStored(storedRows) {
  return (Array.isArray(storedRows) ? storedRows : []).map((row, idx) => {
    const rowClass = resolveStoredRowClass(row)
    let status = 'ok'
    let blockingReason = row.blockingReason || ''
    const ms = String(row.matchStatus || '').toLowerCase()
    if (isNonOrderLinkedAmazonFee(row) || ms === 'account_level_fee' || rowClass === ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE) {
      status = 'account_level_fee'
      blockingReason = 'Order ID not required for this Amazon fee.'
    } else if (isSettlementReturnRow({ ...row, rowClass })) {
      status = row.zohoCreditNoteId ? 'matched' : row.blockingReason ? 'blocked' : 'review'
      if (status === 'blocked' && !blockingReason) {
        blockingReason = row.blockingReason || 'Refund/return credit note reconciliation is not clean.'
      }
    } else if (row.blockingReason && row.matchStatus !== 'account_level_fee') status = 'blocked'
    else if (ms === 'missing_order_id' || !row.orderId) status = row.orderId ? 'ok' : 'missing_order_id'
    else if (ms === 'unmatched') status = 'unmatched'
    else if (ms === 'matched' || ms === 'po_number' || ms === 'invoice_number_fallback') status = 'matched'
    if (status === 'missing_order_id' && !blockingReason) blockingReason = 'Settlement row is missing Amazon order ID.'
    return {
      rowNumber: row.rowNumber == null ? idx + 1 : row.rowNumber,
      category: row.category || '',
      rowClass: status === 'account_level_fee' ? ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE : rowClass,
      orderId: row.orderId || '',
      amount: Number(row.amount) || 0,
      currency: row.currency || '',
      settlementDate: '',
      transactionType: row.transactionType || '',
      amountType: row.amountType || '',
      amountDescription: row.amountDescription || '',
      status,
      blockingReason,
    }
  })
}

function normalizeSavedAllRows(allRows) {
  return (Array.isArray(allRows) ? allRows : []).map((row, idx) => {
    if (!isNonOrderLinkedAmazonFee(row)) return row
    return {
      ...row,
      rowNumber: row.rowNumber == null ? idx + 1 : row.rowNumber,
      rowClass: ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE,
      status: 'account_level_fee',
      blockingReason: 'Order ID not required for this Amazon fee.',
    }
  })
}

function normalizeSavedWarnings(warnings, allRows) {
  if ((Array.isArray(allRows) ? allRows : []).some((row) => row.status === 'missing_order_id')) {
    return Array.isArray(warnings) ? warnings : []
  }
  return (Array.isArray(warnings) ? warnings : []).filter(
    (warning) => !/not matchable because order ID is missing|do not include an Amazon order ID/i.test(String(warning || ''))
  )
}

function normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules = []) {
  if (!preview) return preview
  preview.allRows = normalizeSavedAllRows(preview.allRows)
  const keepSnapshot = batch.status === 'posted' || batch.postedToZoho === true
  preview.nonOrderLinkedAmazonFeeMappings = keepSnapshot && Array.isArray(batch.nonOrderLinkedAmazonFeeMappings) && batch.nonOrderLinkedAmazonFeeMappings.length
    ? batch.nonOrderLinkedAmazonFeeMappings
    : buildNonOrderLinkedAmazonFeeMappings(preview.allRows, preview.report, feeJournalMappingRules)
  preview.blockingIssues = buildBlockingIssues({
    allRows: preview.allRows,
    unmatchedOrders: preview.unmatchedOrders,
    creditNoteBlockingRows: preview.creditNoteBlockingRows,
    reconciliationStatus: preview.reconciliationSummary?.reconciliationStatus,
  })
  preview.warnings = normalizeSavedWarnings(preview.warnings, preview.allRows)
  return preview
}

async function enrichBatchForClearingOperations(batch) {
  if (!batch) return batch
  const feeJournalMappingRules = await store.listFeeJournalMappings({ marketplace: batch.marketplace || MARKETPLACE }).catch(() => [])
  let allRows = Array.isArray(batch.allRows) ? batch.allRows : []
  if (batch.batchId != null) {
    const storedRows = await store.listRowsForBatch(batch.batchId).catch(() => [])
    if (storedRows.length > 0) {
      allRows = reconstructAllRowsFromStored(storedRows)
    }
  }
  const preview = savedBatchToPreview(batch)
  if (!preview) return batch
  if (allRows.length > 0) preview.allRows = allRows
  normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules)
  applyNetNegativeOrderAdjustments(preview, preview.allRows)
  return {
    ...batch,
    allRows: preview.allRows,
    matchedOrders: preview.matchedOrders,
    unmatchedOrders: preview.unmatchedOrders,
    netNegativeReturnOrders: preview.netNegativeReturnOrders || [],
    syntheticRefundRows: preview.syntheticRefundRows || [],
    matchedReturns: preview.matchedReturns ?? batch.matchedReturns,
    creditNoteBlockingRows: preview.creditNoteBlockingRows ?? batch.creditNoteBlockingRows,
    blockingIssues: preview.blockingIssues,
    reconciliationSummary: preview.reconciliationSummary,
    nonOrderLinkedAmazonFeeMappings: preview.nonOrderLinkedAmazonFeeMappings,
    adjustmentRows: preview.adjustmentRows ?? batch.adjustmentRows,
    totals: preview.totals ?? batch.totals,
    warnings: preview.warnings,
  }
}

async function batchWithCurrentFeeJournalMappings(batch) {
  return enrichBatchForClearingOperations(batch)
}

function buildLivePaymentPreviewForBatch(batch, preview) {
  if (!batch || (batch.status !== 'approved' && batch.status !== 'posted')) return null
  try {
    const enrichedBatch = {
      ...batch,
      matchedOrders: preview.matchedOrders,
      unmatchedOrders: preview.unmatchedOrders,
      netNegativeReturnOrders: preview.netNegativeReturnOrders,
      matchedReturns: preview.matchedReturns,
      creditNoteBlockingRows: preview.creditNoteBlockingRows,
      allRows: preview.allRows,
      nonOrderLinkedAmazonFeeMappings: preview.nonOrderLinkedAmazonFeeMappings,
      reconciliationSummary: preview.reconciliationSummary,
      adjustmentRows: preview.adjustmentRows,
    }
    const recomputed = buildPaymentPreviewFromBatch(enrichedBatch)
    return {
      batchId: batch.batchId,
      status: 'previewed',
      ...recomputed,
      settlementReference: buildSettlementReference(batch),
      warnings: recomputed.warnings || [],
    }
  } catch {
    return null
  }
}

function savedBatchToPreview(batch) {
  if (!batch) return null
  const settlementReference = buildSettlementReference(batch)
  const postingReference = batch.postingSummary?.reference || settlementReference.referenceBase
  return normalizeSavedBatchPreview(batch, {
    success: true,
    batch: {
      batchId: batch.batchId,
      status: batch.status,
      lifecycleStatus: deriveLifecycleStatus(batch),
      createdAt: batch.createdAt,
      approvedBy: batch.approvedBy,
      approvedAt: batch.approvedAt,
      postedBy: batch.postedBy,
      postedAt: batch.postedAt,
      postedToZoho: Boolean(batch.postedToZoho),
      postingSummary: batch.postingSummary || {},
      settlementReference,
      postingReference,
    },
    settlementReference,
    postingReference,
    marketplace: batch.marketplace || MARKETPLACE,
    report: {
      reportId: batch.report?.reportId || batch.reportId || '',
      reportDocumentId: batch.report?.reportDocumentId || batch.reportDocumentId || '',
      settlementId: batch.report?.settlementId || batch.settlementId || '',
      settlementStartDate: batch.report?.settlementStartDate || '',
      settlementEndDate: batch.report?.settlementEndDate || '',
      depositDate: batch.report?.depositDate || '',
      currency: batch.report?.currency || 'SAR',
    },
    totals: batch.totals || {},
    pivot: batch.pivot || [],
    settlementLevelFees: batch.settlementLevelFees || [],
    nonOrderLinkedAmazonFeeMappings: batch.nonOrderLinkedAmazonFeeMappings || [],
    refundReturnRows: batch.refundReturnRows || [],
    matchedReturns: batch.matchedReturns || [],
    missingCreditNotes: batch.missingCreditNotes || [],
    creditNoteBlockingRows: batch.creditNoteBlockingRows || [],
    adjustmentRows: batch.adjustmentRows || [],
    reconciliationSummary: batch.reconciliationSummary || {},
    matchedOrders: batch.matchedOrders || [],
    unmatchedOrders: batch.unmatchedOrders || [],
    allRows: Array.isArray(batch.allRows) ? batch.allRows : [],
    blockingIssues: Array.isArray(batch.blockingIssues) ? batch.blockingIssues : [],
    amountDifferences: Array.isArray(batch.amountDifferences) ? batch.amountDifferences : [],
    warnings: batch.warnings || [],
    rawRowCount: Array.isArray(batch.allRows) ? batch.allRows.length : 0,
    status: batch.status,
    lifecycleStatus: deriveLifecycleStatus(batch),
    approvedBy: batch.approvedBy,
    approvedAt: batch.approvedAt,
    postedBy: batch.postedBy,
    postedAt: batch.postedAt,
    postedToZoho: Boolean(batch.postedToZoho),
    postingSummary: batch.postingSummary || {},
  })
}

/**
 * Reopen a saved batch with full row-level transparency reconstructed from the
 * persisted rows table, without ever calling Amazon SP-API.
 */
async function hydrateSavedBatch(batch) {
  const preview = savedBatchToPreview(batch)
  if (!preview) return null
  let feeJournalMappingRules = []
  try {
    feeJournalMappingRules = await store.listFeeJournalMappings({ marketplace: batch.marketplace || MARKETPLACE })
  } catch {
    feeJournalMappingRules = []
  }
  let storedRows = []
  try {
    storedRows = await store.listRowsForBatch(batch.batchId)
  } catch {
    storedRows = []
  }
  if (storedRows.length > 0) {
    preview.allRows = reconstructAllRowsFromStored(storedRows)
  }
  normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules)
  applyNetNegativeOrderAdjustments(preview, preview.allRows)
  preview.rawRowCount = preview.allRows.length || storedRows.length || 0
  preview.storedRowCount = storedRows.length
  preview.paymentPreview = buildLivePaymentPreviewForBatch(batch, preview)
  try {
    preview.auditLog = await store.listClearingAudit(batch.batchId)
  } catch {
    preview.auditLog = []
  }
  try {
    preview.postings = await store.listPostingsForBatch(batch.batchId)
  } catch {
    preview.postings = []
  }
  return preview
}

async function getSavedBatch(id) {
  const batch = await store.getBatchById(id)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  return hydrateSavedBatch(batch)
}

function settlementPeriodKey(batch) {
  const marketplace = batch.marketplace || MARKETPLACE
  const settlementId = batch.settlementId || batch.report?.settlementId || ''
  if (settlementId) return `${marketplace}::sid:${settlementId}`
  const start = batch.report?.settlementStartDate || ''
  const end = batch.report?.settlementEndDate || ''
  if (start || end) return `${marketplace}::range:${start}|${end}`
  const docId = batch.reportDocumentId || batch.report?.reportDocumentId || ''
  if (docId) return `${marketplace}::doc:${docId}`
  return `${marketplace}::batch:${batch.batchId}`
}

function batchLifecycleRank(batch) {
  if (batch.status === 'posted' || batch.postedToZoho) return 3
  if (batch.status === 'approved') return 2
  return 1
}

function dedupeBatchesByPeriod(batches) {
  const best = new Map()
  for (const batch of Array.isArray(batches) ? batches : []) {
    const key = settlementPeriodKey(batch)
    const prev = best.get(key)
    if (!prev || batchLifecycleRank(batch) > batchLifecycleRank(prev)) {
      best.set(key, batch)
    }
  }
  return Array.from(best.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  )
}

async function listSavedBatches(limit = 50) {
  const batches = dedupeBatchesByPeriod(await store.listRecentBatches(limit))
  return {
    success: true,
    marketplace: MARKETPLACE,
    batches: (Array.isArray(batches) ? batches : []).map((batch) => ({
      batchId: batch.batchId,
      marketplace: batch.marketplace || MARKETPLACE,
      reportId: batch.reportId || batch.report?.reportId || '',
      reportDocumentId: batch.reportDocumentId || batch.report?.reportDocumentId || '',
      settlementId: batch.settlementId || batch.report?.settlementId || '',
      settlementStartDate: batch.report?.settlementStartDate || '',
      settlementEndDate: batch.report?.settlementEndDate || '',
      depositDate: batch.report?.depositDate || '',
      currency: batch.report?.currency || 'SAR',
      status: batch.status,
      lifecycleStatus: deriveLifecycleStatus(batch),
      postedToZoho: Boolean(batch.postedToZoho),
      postingReference: batch.postingSummary?.reference || buildSettlementReference(batch).referenceBase,
      amazonSettlementTotal: Number(batch.totals?.amazonSettlementTotal) || 0,
      matchedOrderCount: Array.isArray(batch.matchedOrders) ? batch.matchedOrders.length : 0,
      unmatchedOrderCount: Array.isArray(batch.unmatchedOrders) ? batch.unmatchedOrders.length : 0,
      creditNoteBlockerCount: Array.isArray(batch.creditNoteBlockingRows) ? batch.creditNoteBlockingRows.length : 0,
      reconciliationStatus: batch.reconciliationSummary?.reconciliationStatus || '',
      createdAt: batch.createdAt,
      approvedAt: batch.approvedAt,
      postedAt: batch.postedAt,
    })),
  }
}

async function approveSavedBatch(id, approvedBy) {
  const existing = await enrichBatchForClearingOperations(await store.getBatchById(id))
  validateBatchReadyForApproval(existing)
  const batch = await store.approveBatch(id, approvedBy)
  return {
    ...savedBatchToPreview(batch),
    message: 'Settlement approved and saved.',
  }
}

function validateBatchReadyForApproval(batch) {
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.reconciliationSummary?.reconciliationStatus === 'mismatch') {
    const err = new Error('Approval requires a reconciled settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Approval requires zero unmatched sales orders.')
    err.code = 'AMAZON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.creditNoteBlockingRows) && batch.creditNoteBlockingRows.length > 0) {
    const err = new Error('Approval requires all refund/return rows to have matched Zoho credit notes with clean amounts.')
    err.code = 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_BLOCKED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.netNegativeReturnOrders) && batch.netNegativeReturnOrders.length > 0) {
    const err = new Error('Approval requires net-negative order returns to be matched to Zoho credit notes before clearing.')
    err.code = 'AMAZON_PAYMENT_CLEARING_NET_NEGATIVE_ORDER_BLOCKED'
    err.status = 422
    throw err
  }
}

async function buildPaymentPreviewForBatch(id, createdBy) {
  const batch = await batchWithCurrentFeeJournalMappings(await store.getBatchById(id))
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const preview = buildPaymentPreviewFromBatch(batch)
  const saved = await store.savePaymentPreview({
    batchId: batch.batchId,
    preview,
    createdBy,
  })
  return {
    success: true,
    ...preview,
    ...saved,
  }
}

async function postBatchToZoho(id, options = {}) {
  return store.withBatchPostingLock(id, async () => {
    const batch = await batchWithCurrentFeeJournalMappings(await store.getBatchById(id))
    if (!batch) {
      const err = new Error('Payment clearing batch not found.')
      err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
      err.status = 404
      throw err
    }
    return postApprovedBatch({
      batch,
      store,
      dryRun: options.dryRun !== false,
      allowPosted: options.allowPosted === true,
      postedBy: options.postedBy,
      createPayment: options.createPayment,
    })
  })
}

/**
 * Admin-only force repost of an already-posted batch. Requires an explicit
 * reason, records an audit entry with the previous Zoho payment IDs, and (for a
 * real post) clears prior posting rows so new payments can be created. Only the
 * already-posted guard is bypassed; reconciliation/credit-note guards still apply.
 */
async function forceRepostBatch(id, options = {}) {
  const dryRun = options.dryRun !== false
  const reason = String(options.reason || '').trim()
  const batch = await store.getBatchById(id)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'posted' && !batch.postedToZoho) {
    const err = new Error('Force repost is only for batches already posted to Zoho. Use the normal posting flow.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_POSTED'
    err.status = 422
    throw err
  }
  if (!reason) {
    const err = new Error('A reason is required to force repost a settlement to Zoho.')
    err.code = 'AMAZON_PAYMENT_CLEARING_REASON_REQUIRED'
    err.status = 422
    throw err
  }
  const previousPostings = await store.listPostingsForBatch(id)
  const previousZohoPaymentIds = previousPostings
    .map((row) => row.zohoPaymentId)
    .filter(Boolean)
  await store.insertClearingAudit({
    batchId: batch.batchId,
    action: dryRun ? 'force_repost_dry_run' : 'force_repost',
    reason,
    actorUserId: options.postedBy,
    previousZohoPaymentIds,
    details: { dryRun },
  })
  if (dryRun) {
    return store.withBatchPostingLock(id, async () =>
      postApprovedBatch({ batch: await batchWithCurrentFeeJournalMappings(batch), store, dryRun: true, allowPosted: true })
    )
  }
  return store.withBatchPostingLock(id, async () => {
    await store.clearPostingsForBatch(id)
    const current = await batchWithCurrentFeeJournalMappings(await store.getBatchById(id))
    return postApprovedBatch({
      batch: current,
      store,
      dryRun: false,
      allowPosted: true,
      postedBy: options.postedBy,
      createPayment: options.createPayment,
    })
  })
}

async function getZohoAccountDiagnostics() {
  return {
    success: true,
    ...(await getAccountDiagnostics()),
  }
}

async function listZohoAccountsForFeeMapping() {
  return {
    success: true,
    accounts: await listZohoChartAccounts(),
  }
}

async function listFeeJournalMappings(options = {}) {
  return {
    success: true,
    marketplace: options.marketplace || MARKETPLACE,
    mappings: await store.listFeeJournalMappings({
      marketplace: options.marketplace || MARKETPLACE,
      includeInactive: options.includeInactive === true,
    }),
  }
}

async function saveFeeJournalMapping(input = {}, actorUserId = null) {
  const mapping = await store.upsertFeeJournalMapping({
    ...input,
    marketplace: input.marketplace || MARKETPLACE,
    actorUserId,
  })
  return {
    success: true,
    mapping,
  }
}

function getZohoOAuthAuthorizeUrl(state = '') {
  return {
    success: true,
    ...buildZohoOAuthAuthorizeUrl(state),
  }
}

async function exchangeZohoOAuthCode(code) {
  return {
    success: true,
    ...(await exchangeZohoAuthorizationCode(code)),
  }
}

module.exports = {
  SETTLEMENT_REPORT_TYPE,
  listRecentSettlementReports,
  buildPreviewFromReport,
  matchZohoInvoicesPreview,
  getSavedBatch,
  listSavedBatches,
  approveSavedBatch,
  buildPaymentPreviewForBatch,
  postBatchToZoho,
  forceRepostBatch,
  getZohoAccountDiagnostics,
  listZohoAccountsForFeeMapping,
  listFeeJournalMappings,
  saveFeeJournalMapping,
  getZohoOAuthAuthorizeUrl,
  exchangeZohoOAuthCode,
  _internals: {
    extractReports,
    normalizeReport,
    resolveReport,
  },
}
