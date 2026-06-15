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
const { buildPreview } = require('./amazonPaymentClearingPreviewService')
const { buildPaymentPreviewFromBatch } = require('./amazonPaymentClearingPaymentPreviewService')
const { postApprovedBatch } = require('./amazonPaymentClearingPostingService')
const { getAccountDiagnostics } = require('./amazonPaymentClearingZohoPaymentService')
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
  const report = await resolveReport(options)
  if (!report.reportDocumentId) {
    const err = new Error('Selected Amazon settlement report is missing reportDocumentId.')
    err.code = 'AMAZON_SETTLEMENT_REPORT_DOCUMENT_MISSING'
    err.status = 422
    throw err
  }
  const text = await downloadSettlementReportDocument(report.reportDocumentId)
  const parsed = parseAmazonSettlementReport(text)
  const zohoMatch = await matchZohoInvoicesForRows(parsed.rows, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    customerId: options.zohoCustomerId || null,
  })
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
    parserWarnings: [...(parsed.warnings || []), ...(zohoMatch.zohoFetchWarnings || [])],
    rawRowCount: parsed.rawRowCount,
  })
  const savedBatch = await store.savePreviewBatch({
    preview,
    rows: parsed.rows,
    createdBy: options.createdBy,
  })
  return {
    success: true,
    batch: savedBatch,
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

function savedBatchToPreview(batch) {
  if (!batch) return null
  return {
    success: true,
    batch: {
      batchId: batch.batchId,
      status: batch.status,
      createdAt: batch.createdAt,
      approvedBy: batch.approvedBy,
      approvedAt: batch.approvedAt,
      postedBy: batch.postedBy,
      postedAt: batch.postedAt,
    },
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
    reconciliationSummary: batch.reconciliationSummary || {},
    matchedOrders: batch.matchedOrders || [],
    unmatchedOrders: batch.unmatchedOrders || [],
    warnings: batch.warnings || [],
    rawRowCount: 0,
    status: batch.status,
    approvedBy: batch.approvedBy,
    approvedAt: batch.approvedAt,
    postedBy: batch.postedBy,
    postedAt: batch.postedAt,
  }
}

async function getSavedBatch(id) {
  const batch = await store.getBatchById(id)
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  return savedBatchToPreview(batch)
}

async function approveSavedBatch(id, approvedBy) {
  const batch = await store.approveBatch(id, approvedBy)
  return {
    ...savedBatchToPreview(batch),
    message: 'Settlement approved and saved.',
  }
}

async function buildPaymentPreviewForBatch(id, createdBy) {
  const batch = await store.getBatchById(id)
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
    const batch = await store.getBatchById(id)
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
  approveSavedBatch,
  buildPaymentPreviewForBatch,
  postBatchToZoho,
  getZohoAccountDiagnostics,
  getZohoOAuthAuthorizeUrl,
  exchangeZohoOAuthCode,
  _internals: {
    extractReports,
    normalizeReport,
    resolveReport,
  },
}
