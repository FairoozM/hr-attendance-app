const {
  listAmazonReports,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  marketplaceIdForKey,
  throwAmazonSpApiIfFailed,
} = require('./amazonSpApiService')
const {
  parseAmazonSettlementReport,
  parseAmazonSettlementReportBuffer,
} = require('./amazonSettlementParserService')
const {
  matchZohoInvoicesForRows,
  deriveInvoiceRange,
  matchRefundReturnRowsToCreditNotes,
  resolveKsaZohoCustomer,
  listKsaZohoCustomerOptions,
} = require('./amazonPaymentClearingZohoMatcher')
const {
  buildPreview,
  buildBlockingIssues,
  buildNonOrderLinkedAmazonFeeMappings,
  applyNetNegativeOrderAdjustments,
  sanitizeCreditNotePreview,
  recomputePreviewReconciliation,
} = require('./amazonPaymentClearingPreviewService')
const {
  ROW_CLASS,
  isAmazonOrderIdFormat,
  isNonOrderLinkedAmazonFee,
  hasOrderId,
  CATEGORY,
} = require('./amazonPaymentClearingCategoryService')
const { isSettlementReturnRow } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildPaymentPreviewFromBatch } = require('./amazonPaymentClearingPaymentPreviewService')
const { postApprovedBatch, postReturnFeeJournalsForBatch, isReturnFeePostComplete } = require('./amazonPaymentClearingPostingService')
const { buildSettlementReference } = require('./amazonPaymentClearingReferenceService')
const { getAccountDiagnostics, listZohoChartAccounts } = require('./amazonPaymentClearingZohoPaymentService')
const store = require('./amazonPaymentClearingStore')
const { buildZohoOAuthAuthorizeUrl, exchangeZohoAuthorizationCode } = require('../integrations/zoho/zohoOAuth')
const { buildReturnFeePlan } = require('./amazonPaymentClearingReturnFeeService')
const {
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
} = require('./amazonPaymentClearingCreditNotePostingService')

const MARKETPLACE_KEY = 'ksa'
const MARKETPLACE = 'KSA'
const SETTLEMENT_REPORT_TYPE =
  process.env.AMAZON_KSA_SETTLEMENT_REPORT_TYPE || 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'
/** Amazon listReports rejects createdSince older than ~90 days (InvalidInput). */
const AMAZON_LIST_REPORTS_MAX_DAYS_BACK = Number(process.env.AMAZON_LIST_REPORTS_MAX_DAYS_BACK) || 90
const SETTLEMENT_LIST_DAYS_BACK = Number(process.env.AMAZON_KSA_SETTLEMENT_LIST_DAYS_BACK) || AMAZON_LIST_REPORTS_MAX_DAYS_BACK
const SETTLEMENT_LIST_PAGE_SIZE = Number(process.env.AMAZON_KSA_SETTLEMENT_LIST_PAGE_SIZE) || 100
const SETTLEMENT_LIST_MAX_PAGES = Number(process.env.AMAZON_KSA_SETTLEMENT_LIST_MAX_PAGES) || 20

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function clampSettlementListDaysBack(daysBack) {
  const requested = Number(daysBack)
  const normalized = Number.isFinite(requested) && requested > 0 ? requested : SETTLEMENT_LIST_DAYS_BACK
  return Math.min(normalized, AMAZON_LIST_REPORTS_MAX_DAYS_BACK)
}

function resolveSettlementListCreatedSince(options = {}) {
  const daysBack = clampSettlementListDaysBack(options.daysBack)
  const earliestAllowed = isoDaysAgo(AMAZON_LIST_REPORTS_MAX_DAYS_BACK)
  const requestedSince = options.createdSince ? String(options.createdSince).trim() : isoDaysAgo(daysBack)
  return {
    daysBack,
    createdSince: requestedSince < earliestAllowed ? earliestAllowed : requestedSince,
    maxDaysBack: AMAZON_LIST_REPORTS_MAX_DAYS_BACK,
  }
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

function reportListNextToken(data) {
  if (!data || typeof data !== 'object') return ''
  return String(data.nextToken || data.payload?.nextToken || '').trim()
}

function settlementReportSortTime(report) {
  return String(report?.dataEndTime || report?.dataStartTime || report?.createdTime || report?.processingEndTime || '')
}

async function listRecentSettlementReports(options = {}) {
  const marketplaceId = marketplaceIdForKey(MARKETPLACE_KEY)
  const { daysBack, createdSince, maxDaysBack } = resolveSettlementListCreatedSince(options)
  const pageSize = Number(options.pageSize) || SETTLEMENT_LIST_PAGE_SIZE
  const maxPages = Number(options.maxPages) || SETTLEMENT_LIST_MAX_PAGES
  const byReportId = new Map()
  let nextToken = ''

  for (let page = 0; page < maxPages; page += 1) {
    const spRes = await listAmazonReports({
      marketplaceKey: MARKETPLACE_KEY,
      reportTypes: [SETTLEMENT_REPORT_TYPE],
      processingStatuses: ['DONE'],
      marketplaceIds: [marketplaceId],
      createdSince,
      pageSize,
      ...(nextToken ? { nextToken } : {}),
    })
    throwAmazonSpApiIfFailed(spRes, 'listSettlementReports', MARKETPLACE_KEY)
    for (const report of extractReports(spRes.data).map(normalizeReport).filter(Boolean)) {
      const key = report.reportId || report.reportDocumentId
      if (!key || byReportId.has(key)) continue
      byReportId.set(key, report)
    }
    nextToken = reportListNextToken(spRes.data)
    if (!nextToken) break
  }

  const reports = Array.from(byReportId.values()).sort((a, b) =>
    settlementReportSortTime(b).localeCompare(settlementReportSortTime(a))
  )
  return {
    success: true,
    marketplace: MARKETPLACE,
    reportType: SETTLEMENT_REPORT_TYPE,
    marketplaceId,
    daysBack,
    createdSince,
    maxDaysBack,
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

function uploadedSettlementDocumentId(settlementId, fileName = '') {
  const sid = String(settlementId || '').trim()
  if (sid) return `upload:settlement:${sid}`
  const safeName = String(fileName || 'settlement')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80)
  return `upload:file:${safeName || 'settlement'}:${Date.now()}`
}

async function buildAndSavePreviewFromParsed({
  report,
  parsed,
  options = {},
  existing = null,
  forceRefresh = false,
  refreshFlagKey = 'refreshedFromAmazon',
}) {
  const { customerId: zohoCustomerId, customerName: zohoCustomerName } = await resolveKsaZohoCustomer({
    customerId: options.zohoCustomerId,
    customerName: options.zohoCustomerName,
  })
  const zohoMatch = await matchZohoInvoicesForRows(parsed.rows, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    customerId: zohoCustomerId,
    customerName: zohoCustomerName,
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
  preview.zohoCustomerId = zohoCustomerId || ''
  preview.zohoCustomerName = zohoCustomerName || ''
  // One statement per settlement period:
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
    [refreshFlagKey]: Boolean(reusedExisting && forceRefresh),
    ...preview,
  }
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
  return buildAndSavePreviewFromParsed({
    report,
    parsed,
    options,
    existing,
    forceRefresh,
    refreshFlagKey: 'refreshedFromAmazon',
  })
}

/**
 * Legacy / Seller Central path: import a downloaded settlement flat file (TSV/CSV/XLSX)
 * without calling Amazon SP-API. Needed when reportIds older than ~90 days return NotFound.
 */
async function buildPreviewFromUploadedSettlement(options = {}) {
  const forceRefresh = options.forceRefresh === true
  const fileName = String(options.fileName || options.originalname || 'settlement.tsv').trim()
  const parsed = parseAmazonSettlementReportBuffer(options.buffer, fileName)
  const metadata = parsed.metadata || {}
  if (!metadata.settlementId && !(parsed.rows || []).length) {
    const err = new Error('Could not parse settlement rows from the uploaded file. Export the Amazon settlement as TSV/CSV or XLSX.')
    err.code = 'AMAZON_SETTLEMENT_UPLOAD_INVALID'
    err.status = 400
    throw err
  }

  const reportDocumentId = uploadedSettlementDocumentId(metadata.settlementId, fileName)
  const report = {
    reportId: '',
    reportDocumentId,
    reportType: SETTLEMENT_REPORT_TYPE,
    processingStatus: 'DONE',
    createdTime: '',
    processingEndTime: '',
    dataStartTime: metadata.settlementStartDate || '',
    dataEndTime: metadata.settlementEndDate || '',
    marketplaceIds: [marketplaceIdForKey(MARKETPLACE_KEY)],
    raw: { source: 'upload', fileName },
  }

  const existing = await store.findBatchByReport({
    reportDocumentId,
    settlementId: metadata.settlementId,
  })
  if (existing && !forceRefresh) {
    return { ...(await hydrateSavedBatch(existing)), fromCache: true, fromUpload: true }
  }
  if (existing && forceRefresh && (existing.status === 'posted' || existing.postedToZoho)) {
    const err = new Error('This settlement has already been posted to Zoho and cannot be re-imported. Use Force Repost if you must re-post.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }

  const result = await buildAndSavePreviewFromParsed({
    report,
    parsed,
    options,
    existing,
    forceRefresh,
    refreshFlagKey: 'refreshedFromUpload',
  })
  return { ...result, fromUpload: true }
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

function normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules = [], settlementRows = []) {
  if (!preview) return preview
  preview.allRows = normalizeSavedAllRows(preview.allRows)
  const keepSnapshot = batch.status === 'posted' || batch.postedToZoho === true
  preview.nonOrderLinkedAmazonFeeMappings = keepSnapshot && Array.isArray(batch.nonOrderLinkedAmazonFeeMappings) && batch.nonOrderLinkedAmazonFeeMappings.length
    ? batch.nonOrderLinkedAmazonFeeMappings
    : buildNonOrderLinkedAmazonFeeMappings(preview.allRows, preview.report, feeJournalMappingRules)
  if (!keepSnapshot) {
    sanitizeCreditNotePreview(preview, settlementRows)
    if (settlementRows.length) {
      rematchCreditNotesFromSettlementRows(preview, settlementRows)
      recomputePreviewReconciliation(preview, settlementRows)
    }
  } else {
    preview.blockingIssues = buildBlockingIssues({
      allRows: preview.allRows,
      unmatchedOrders: preview.unmatchedOrders,
      creditNoteBlockingRows: preview.creditNoteBlockingRows,
      reconciliationStatus: preview.reconciliationSummary?.reconciliationStatus,
    })
  }
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
  let settlementRows = []
  if (batch.batchId != null) {
    const storedRows = await store.listRowsForBatch(batch.batchId).catch(() => [])
    if (storedRows.length > 0) {
      settlementRows = storedRowsToSettlementRows(storedRows, batch.report || {})
    }
  }
  normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules, settlementRows)
  applyNetNegativeOrderAdjustments(preview, preview.allRows)
  return {
    ...batch,
    allRows: preview.allRows,
    matchedOrders: preview.matchedOrders,
    unmatchedOrders: preview.unmatchedOrders,
    netNegativeReturnOrders: preview.netNegativeReturnOrders || [],
    syntheticRefundRows: preview.syntheticRefundRows || [],
    matchedReturns: preview.matchedReturns ?? batch.matchedReturns,
    refundReturnRows: preview.refundReturnRows ?? batch.refundReturnRows ?? [],
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

function batchZohoMatchOptions(batch, preview = null) {
  return {
    customerId: batch?.zohoCustomerId || preview?.zohoCustomerId || null,
    customerName: batch?.zohoCustomerName || preview?.zohoCustomerName || null,
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
      zohoCustomerId: batch.zohoCustomerId || '',
      zohoCustomerName: batch.zohoCustomerName || '',
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
    zohoCustomerId: batch.zohoCustomerId || '',
    zohoCustomerName: batch.zohoCustomerName || '',
  })
}

/**
 * Re-run Zoho invoice/credit-note matching for a draft batch saved under older
 * rules (e.g. missing CNs hard-blocked instead of ready_to_create) or with
 * stale unmatched invoices.
 */
function shouldRematchZohoOnDraftReopen(batch) {
  if (!batch || batch.status === 'posted' || batch.postedToZoho) return false
  const priorUnmatched = Array.isArray(batch.unmatchedOrders) ? batch.unmatchedOrders.length : 0
  if (priorUnmatched > 0) return true
  const blockers = Array.isArray(batch.creditNoteBlockingRows) ? batch.creditNoteBlockingRows : []
  if (!blockers.length) return false
  return blockers.some((row) => {
    if (row?.creditNoteAction === 'ready_to_create') return true
    if (row?.zohoCreditNoteId && /differ/i.test(String(row.blockingReason || ''))) return true
    if (!row?.zohoCreditNoteId && row?.zohoInvoiceId) return true
    if (/missing credit note/i.test(String(row.blockingReason || ''))) return true
    return false
  })
}

function storedRowsToSettlementRows(storedRows, report = {}) {
  const settlementDates = {
    settlementStartDate: report.settlementStartDate || '',
    settlementEndDate: report.settlementEndDate || '',
    depositDate: report.depositDate || '',
  }
  return (Array.isArray(storedRows) ? storedRows : []).map((row) => {
    const raw = row.rawRow && typeof row.rawRow === 'object' ? row.rawRow : {}
    return {
      ...raw,
      orderId: row.orderId || raw.orderId || '',
      amount: row.amount ?? raw.amount,
      category: row.category || raw.category || '',
      rowClass: row.rowClass || raw.rowClass || '',
      matchStatus: row.matchStatus || raw.matchStatus || '',
      transactionType: row.transactionType || raw.transactionType || '',
      amountType: row.amountType || raw.amountType || '',
      amountDescription: row.amountDescription || raw.amountDescription || '',
      ...settlementDates,
    }
  })
}

function invoicesFromMatchedOrders(matchedOrders = []) {
  return (Array.isArray(matchedOrders) ? matchedOrders : [])
    .map((order) => ({
      invoice_id: order.zohoInvoiceId || '',
      invoice_number: order.zohoInvoiceNumber || '',
      reference_number: order.zohoPoNumber || order.orderId || '',
      customer_id: order.zohoCustomerId || '',
      customer_name: order.zohoCustomerName || '',
      total: order.zohoInvoiceTotal,
    }))
    .filter((invoice) => invoice.invoice_id || invoice.reference_number)
}

function creditNotesFromStoredReturnPreview(matchedReturns = [], creditNoteBlockingRows = [], missingCreditNotes = []) {
  const seen = new Set()
  const out = []
  for (const row of [...matchedReturns, ...creditNoteBlockingRows, ...missingCreditNotes]) {
    const id = String(row?.zohoCreditNoteId || '').trim()
    const number = String(row?.zohoCreditNoteNumber || '').trim()
    const key = id || number
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({
      creditnote_id: id,
      creditnote_number: number || row.orderId || '',
      reference_number: row.zohoPoNumber || '',
      invoice_id: row.zohoInvoiceId || '',
      total: row.creditNoteAmount,
      status: row.creditNoteStatus || 'open',
    })
  }
  return out
}

function invoicesForCreditNoteRematch(matchedOrders = [], returnRows = []) {
  const byId = new Map()
  for (const invoice of invoicesFromMatchedOrders(matchedOrders)) {
    const id = String(invoice.invoice_id || '').trim()
    if (id) byId.set(id, invoice)
  }
  for (const row of Array.isArray(returnRows) ? returnRows : []) {
    const id = String(row?.zohoInvoiceId || '').trim()
    if (!id) continue
    const existing = byId.get(id)
    byId.set(id, {
      invoice_id: id,
      invoice_number: row.zohoInvoiceNumber || existing?.invoice_number || '',
      reference_number: row.zohoPoNumber || row.orderId || existing?.reference_number || '',
      customer_id: row.zohoCustomerId || existing?.customer_id || '',
      customer_name: row.zohoCustomerName || existing?.customer_name || '',
      total: row.zohoInvoiceTotal ?? existing?.total,
    })
  }
  return Array.from(byId.values())
}

function rematchCreditNotesFromSettlementRows(preview, settlementRows) {
  if (!preview || !Array.isArray(settlementRows) || settlementRows.length === 0) return preview
  const returnPreviewRows = [
    ...(preview.matchedReturns || []),
    ...(preview.creditNoteBlockingRows || []),
    ...(preview.missingCreditNotes || []),
  ]
  const invoices = invoicesForCreditNoteRematch(preview.matchedOrders, returnPreviewRows)
  if (!invoices.length) return preview
  const creditNotes = creditNotesFromStoredReturnPreview(
    preview.matchedReturns,
    preview.creditNoteBlockingRows,
    preview.missingCreditNotes
  )
  const cnMatch = matchRefundReturnRowsToCreditNotes(settlementRows, invoices, creditNotes)
  preview.matchedReturns = cnMatch.matchedReturns
  preview.missingCreditNotes = cnMatch.missingCreditNotes
  preview.creditNoteBlockingRows = cnMatch.creditNoteBlockingRows
  return preview
}

function rowNumbersNeedingAccountLevelFeeFix(storedRows = []) {
  return (Array.isArray(storedRows) ? storedRows : [])
    .filter((row) => isNonOrderLinkedAmazonFee(row) && String(row.matchStatus || '').toLowerCase() !== 'account_level_fee')
    .map((row) => row.rowNumber)
    .filter((value) => Number.isFinite(value))
}

function batchHasPseudoOrderUnmatched(batch) {
  return (Array.isArray(batch?.unmatchedOrders) ? batch.unmatchedOrders : []).some((order) => {
    const orderId = String(order?.orderId || '').trim()
    return orderId && !isAmazonOrderIdFormat(orderId)
  })
}

function storedRowsHavePseudoOrderAccountLevelFees(storedRows = []) {
  return (Array.isArray(storedRows) ? storedRows : []).some(
    (row) => isNonOrderLinkedAmazonFee(row) && hasOrderId(row)
  )
}

async function refreshBatchPreviewFromStoredRows(batchId, batch = null) {
  const resolvedBatch = batch || await store.getBatchById(batchId)
  if (!resolvedBatch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const storedRows = await store.listRowsForBatch(batchId)
  const feeJournalMappingRules = await store.listFeeJournalMappings({
    marketplace: resolvedBatch.marketplace || MARKETPLACE,
  }).catch(() => [])
  const report = resolvedBatch.report || {}
  const rows = storedRowsToSettlementRows(storedRows, report)
  const rematchSeed = {
    matchedOrders: resolvedBatch.matchedOrders || [],
    matchedReturns: resolvedBatch.matchedReturns || [],
    missingCreditNotes: resolvedBatch.missingCreditNotes || [],
    creditNoteBlockingRows: resolvedBatch.creditNoteBlockingRows || [],
  }
  rematchCreditNotesFromSettlementRows(rematchSeed, rows)
  const preview = buildPreview({
    report,
    rows,
    invoices: invoicesFromMatchedOrders(resolvedBatch.matchedOrders),
    matchedReturns: rematchSeed.matchedReturns,
    missingCreditNotes: rematchSeed.missingCreditNotes,
    creditNoteBlockingRows: rematchSeed.creditNoteBlockingRows,
    parserWarnings: resolvedBatch.warnings || [],
    rawRowCount: rows.length,
    feeJournalMappingRules,
  })
  await store.updateBatchPreviewSnapshot(batchId, preview)
  return preview
}

async function syncAccountLevelFeeRowsForBatch(batch, storedRows) {
  if (!batch || batch.status === 'posted' || batch.postedToZoho) return false
  let rowNumbers = rowNumbersNeedingAccountLevelFeeFix(storedRows)
  if (!rowNumbers.length && batchHasPseudoOrderUnmatched(batch)) {
    const pseudoOrderIds = new Set(
      (batch.unmatchedOrders || [])
        .filter((order) => {
          const orderId = String(order?.orderId || '').trim()
          return orderId && !isAmazonOrderIdFormat(orderId)
        })
        .map((order) => order.orderId)
    )
    rowNumbers = (Array.isArray(storedRows) ? storedRows : [])
      .filter((row) => pseudoOrderIds.has(row.orderId))
      .map((row) => row.rowNumber)
      .filter((value) => Number.isFinite(value))
  }
  if (!rowNumbers.length) return false
  await store.updateRowsMatchStatus(batch.batchId, rowNumbers, 'account_level_fee')
  await refreshBatchPreviewFromStoredRows(batch.batchId)
  return true
}

async function reclassifyAccountLevelFeesForBatch(batchId, rowNumbers = []) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status === 'posted' || batch.postedToZoho) {
    const err = new Error('Posted settlement batches cannot be reclassified.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_POSTED'
    err.status = 409
    throw err
  }
  const ids = (Array.isArray(rowNumbers) ? rowNumbers : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (!ids.length) {
    const err = new Error('At least one settlement row number is required.')
    err.code = 'AMAZON_PAYMENT_CLEARING_ROW_NUMBERS_REQUIRED'
    err.status = 422
    throw err
  }
  const updated = await store.updateRowsMatchStatus(batchId, ids, 'account_level_fee')
  if (!updated) {
    const err = new Error('No settlement rows were updated.')
    err.code = 'AMAZON_PAYMENT_CLEARING_ROWS_NOT_FOUND'
    err.status = 404
    throw err
  }
  await refreshBatchPreviewFromStoredRows(batchId)
  const hydrated = await hydrateSavedBatch(await store.getBatchById(batchId))
  return {
    ...hydrated,
    message: `${updated} row(s) marked as account-level Amazon fee.`,
  }
}

async function maybeRematchZohoForDraftBatch(batch, storedRows, preview, feeJournalMappingRules) {
  if (!shouldRematchZohoOnDraftReopen(batch) || !storedRows.length) return preview

  const priorUnmatched = Array.isArray(batch.unmatchedOrders) ? batch.unmatchedOrders.length : 0
  const priorBlocking = Array.isArray(batch.creditNoteBlockingRows) ? batch.creditNoteBlockingRows.length : 0
  const priorReady = (preview.matchedReturns || []).filter((row) => row.status === 'ready_to_create').length

  const report = preview.report || {}
  const settlementDates = {
    settlementStartDate: report.settlementStartDate,
    settlementEndDate: report.settlementEndDate,
    depositDate: report.depositDate,
  }
  const range = deriveInvoiceRange([settlementDates])
  const rows = storedRows.map((row) => {
    const raw = row.rawRow && typeof row.rawRow === 'object' ? row.rawRow : {}
    return {
      ...raw,
      orderId: row.orderId || raw.orderId || '',
      amount: row.amount ?? raw.amount,
      category: row.category || raw.category || '',
      rowClass: row.rowClass || raw.rowClass || '',
      transactionType: row.transactionType || raw.transactionType || '',
      amountType: row.amountType || raw.amountType || '',
      amountDescription: row.amountDescription || raw.amountDescription || '',
      ...settlementDates,
    }
  })

  const zohoMatch = await matchZohoInvoicesForRows(rows, {
    fromDate: range.fromDate,
    toDate: range.toDate,
    ...batchZohoMatchOptions(batch, preview),
  })
  const rematchedPreview = buildPreview({
    report,
    rows,
    invoices: zohoMatch.invoices,
    matchedReturns: zohoMatch.matchedReturns,
    missingCreditNotes: zohoMatch.missingCreditNotes,
    creditNoteBlockingRows: zohoMatch.creditNoteBlockingRows,
    parserWarnings: [...(preview.warnings || []), ...(zohoMatch.zohoFetchWarnings || [])],
    rawRowCount: rows.length,
    feeJournalMappingRules,
    syntheticRefundRows: zohoMatch.syntheticRefundRows || [],
    netNegativeReturnOrderIds: zohoMatch.netNegativeReturnOrderIds || [],
  })
  rematchedPreview.zohoCustomerId = batch.zohoCustomerId || preview.zohoCustomerId || ''
  rematchedPreview.zohoCustomerName = batch.zohoCustomerName || preview.zohoCustomerName || ''

  const newUnmatched = Array.isArray(rematchedPreview.unmatchedOrders) ? rematchedPreview.unmatchedOrders.length : 0
  const newBlocking = Array.isArray(rematchedPreview.creditNoteBlockingRows) ? rematchedPreview.creditNoteBlockingRows.length : 0
  const newReady = (rematchedPreview.matchedReturns || []).filter((row) => row.status === 'ready_to_create').length
  const improved =
    newUnmatched < priorUnmatched ||
    newBlocking < priorBlocking ||
    newReady > priorReady
  if (!improved) return preview

  await store.savePreviewBatch({
    preview: { ...rematchedPreview, marketplace: batch.marketplace || MARKETPLACE },
    rows,
    existingBatchId: batch.batchId,
  })
  normalizeSavedBatchPreview(batch, rematchedPreview, feeJournalMappingRules)
  applyNetNegativeOrderAdjustments(rematchedPreview, rematchedPreview.allRows || rows)
  rematchedPreview.rematchedZoho = true
  rematchedPreview.fromCache = true
  return rematchedPreview
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
    try {
      const synced = await syncAccountLevelFeeRowsForBatch(batch, storedRows)
      if (synced) {
        batch = await store.getBatchById(batch.batchId)
        preview = savedBatchToPreview(batch)
        storedRows = await store.listRowsForBatch(batch.batchId)
      } else if (
        batch.status !== 'posted' &&
        !batch.postedToZoho &&
        batch.reconciliationSummary?.reconciliationStatus === 'mismatch' &&
        storedRowsHavePseudoOrderAccountLevelFees(storedRows)
      ) {
        await refreshBatchPreviewFromStoredRows(batch.batchId, batch)
        batch = await store.getBatchById(batch.batchId)
        preview = savedBatchToPreview(batch)
        storedRows = await store.listRowsForBatch(batch.batchId)
      }
    } catch {
      // Keep going with stored rows even if auto-sync fails.
    }
    preview.allRows = reconstructAllRowsFromStored(storedRows)
  }
  const settlementRows = storedRows.length
    ? storedRowsToSettlementRows(storedRows, batch.report || preview.report || {})
    : []
  const staleCreditNoteBlockers = (batch.creditNoteBlockingRows || []).some((row) => !String(row?.orderId || '').trim())
  const staleRefundReturnRows = (batch.refundReturnRows || []).some((row) => isNonOrderLinkedAmazonFee(row))
  const staleReconciliation = batch.reconciliationSummary?.reconciliationStatus === 'mismatch'
    && Math.abs(Number(batch.reconciliationSummary?.reconciliationDifference) || 0) > 0.01
  const priorCreditNoteBlockers = Array.isArray(batch.creditNoteBlockingRows) ? batch.creditNoteBlockingRows.length : 0
  normalizeSavedBatchPreview(batch, preview, feeJournalMappingRules, settlementRows)
  const rematchedCreditNoteBlockers = Array.isArray(preview.creditNoteBlockingRows) ? preview.creditNoteBlockingRows.length : 0
  if (
    storedRows.length > 0 &&
    batch.status !== 'posted' &&
    !batch.postedToZoho &&
    (staleCreditNoteBlockers || staleRefundReturnRows || staleReconciliation || rematchedCreditNoteBlockers !== priorCreditNoteBlockers)
  ) {
    try {
      await store.updateBatchPreviewSnapshot(batch.batchId, preview)
      batch = await store.getBatchById(batch.batchId)
    } catch {
      // Continue with in-memory sanitized preview.
    }
  }
  applyNetNegativeOrderAdjustments(preview, preview.allRows)
  let hydrated = preview
  try {
    hydrated = await maybeRematchZohoForDraftBatch(batch, storedRows, preview, feeJournalMappingRules)
  } catch {
    hydrated = preview
  }
  hydrated.rawRowCount = hydrated.allRows?.length || storedRows.length || 0
  hydrated.storedRowCount = storedRows.length
  hydrated.paymentPreview = buildLivePaymentPreviewForBatch(batch, hydrated)
  try {
    hydrated.auditLog = await store.listClearingAudit(batch.batchId)
  } catch {
    hydrated.auditLog = []
  }
  try {
    hydrated.postings = await store.listPostingsForBatch(batch.batchId)
  } catch {
    hydrated.postings = []
  }
  return hydrated
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
      zohoCustomerId: batch.zohoCustomerId || '',
      zohoCustomerName: batch.zohoCustomerName || '',
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
 * already-posted guard is bypassed; reconciliation guards still apply. Return credit notes and return fee journals are separate steps after sales post.
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

async function batchForCreditNoteApply(id) {
  const raw = await store.getBatchById(id)
  if (!raw) return null
  const hydrated = await hydrateSavedBatch(raw)
  const enriched = await enrichBatchForClearingOperations(raw)
  return {
    ...enriched,
    batchId: raw.batchId,
    marketplace: raw.marketplace || MARKETPLACE,
    status: raw.status,
    postedToZoho: raw.postedToZoho,
    report: hydrated?.report || enriched.report || raw.report,
    matchedReturns: hydrated?.matchedReturns || enriched.matchedReturns || [],
    creditNoteBlockingRows: hydrated?.creditNoteBlockingRows || enriched.creditNoteBlockingRows || [],
    netNegativeReturnOrders: hydrated?.netNegativeReturnOrders || enriched.netNegativeReturnOrders || [],
    refundReturnRows: hydrated?.refundReturnRows || enriched.refundReturnRows || raw.refundReturnRows || [],
    allRows: hydrated?.allRows || enriched.allRows || [],
  }
}

async function getCreditNoteApplyPlanForBatch(id) {
  const batch = await batchForCreditNoteApply(id)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const plan = await buildCreditNoteApplyPlan(batch)
  return { success: true, ...plan }
}

async function applyCreditNotesForBatchId(id, options = {}) {
  const batch = await batchForCreditNoteApply(id)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'approved' && batch.status !== 'posted') {
    const err = new Error('Credit note apply requires an approved settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (options.dryRun === false && batch.status !== 'posted' && !batch.postedToZoho) {
    const err = new Error('Credit note apply requires sales payments to be posted first (step 9).')
    err.code = 'AMAZON_PAYMENT_CLEARING_SALES_NOT_POSTED'
    err.status = 422
    throw err
  }
  return applyCreditNotesForBatch(batch, {
    dryRun: options.dryRun !== false,
    postedBy: options.postedBy,
  })
}

async function getReturnFeePlanForBatch(id) {
  const batch = await batchWithCurrentFeeJournalMappings(await store.getBatchById(id))
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const plan = buildReturnFeePlan(batch, batch.allRows || [])
  return {
    success: true,
    ...plan,
    creditNoteApplyComplete: await isCreditNoteApplyComplete(id, batch),
    returnFeePostComplete: await isReturnFeePostComplete(id, batch),
  }
}

async function postReturnFeeJournalsForBatchId(id, options = {}) {
  return store.withBatchPostingLock(id, async () => {
    const batch = await batchWithCurrentFeeJournalMappings(await store.getBatchById(id))
    if (!batch) {
      const err = new Error('Payment clearing batch not found.')
      err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
      err.status = 404
      throw err
    }
    return postReturnFeeJournalsForBatch({
      batch,
      store,
      dryRun: options.dryRun !== false,
      postedBy: options.postedBy,
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

async function listKsaZohoCustomers() {
  return {
    success: true,
    marketplace: MARKETPLACE,
    customers: await listKsaZohoCustomerOptions(),
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
  buildPreviewFromUploadedSettlement,
  matchZohoInvoicesPreview,
  getSavedBatch,
  listSavedBatches,
  listKsaZohoCustomers,
  approveSavedBatch,
  buildPaymentPreviewForBatch,
  postBatchToZoho,
  postReturnFeeJournalsForBatchId,
  forceRepostBatch,
  getCreditNoteApplyPlanForBatch,
  applyCreditNotesForBatchId,
  getReturnFeePlanForBatch,
  getZohoAccountDiagnostics,
  listZohoAccountsForFeeMapping,
  listFeeJournalMappings,
  saveFeeJournalMapping,
  getZohoOAuthAuthorizeUrl,
  exchangeZohoOAuthCode,
  reclassifyAccountLevelFeesForBatch,
  _internals: {
    extractReports,
    normalizeReport,
    resolveReport,
    rematchCreditNotesFromSettlementRows,
    reportListNextToken,
    settlementReportSortTime,
    clampSettlementListDaysBack,
    resolveSettlementListCreatedSince,
  },
}
