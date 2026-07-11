const service = require('../services/amazonPaymentClearingService')
const { amazonSpApiHttpErrorJson, suggestedClientHttpStatusForAmazonUpstream } = require('../services/amazonSpApiService')
const {
  getPaymentClearingMarketplaceConfig,
  normalizeMarketplaceKey,
} = require('../services/amazonPaymentClearingMarketplaceConfig')

function safeMessage(err) {
  if (err?.code === 'ZOHO_NOT_CONFIGURED') return 'Zoho is not configured. Add Zoho credentials on the server.'
  if (err?.code === 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND') return err.message
  if (err?.code === 'AMAZON_UAE_SETTLEMENT_REPORT_NOT_FOUND') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_MARKETPLACE_MISMATCH') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_APPROVED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_UNMATCHED_ORDERS') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_BLOCKED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_POSTED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_POSTED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_REASON_REQUIRED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_PAYMENT_PREVIEW_REQUIRED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_ACCOUNT_ID_MISSING') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_MULTIPLE_CUSTOMERS') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_CUSTOMER_ID_MISSING') return err.message
  if (err?.code === 'ZOHO_REDIRECT_URI_MISSING') return err.message
  if (err?.code === 'ZOHO_AUTH_CODE_REQUIRED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_APPLY_REQUIRED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_RETURN_FEE_BLOCKED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_ROW_NUMBERS_REQUIRED') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_ROWS_NOT_FOUND') return err.message
  if (err?.code === 'AMAZON_REPORT_DOCUMENT_URL') return 'Amazon returned an invalid settlement report document URL.'
  if (err?.code === 'AMAZON_SETTLEMENT_UPLOAD_EMPTY' || err?.code === 'AMAZON_SETTLEMENT_UPLOAD_INVALID') return err.message
  if (err?.code === 'AMAZON_LWA_CONFIG' || err?.code === 'AMAZON_SPAPI_CONFIG') {
    return 'Amazon SP-API is not configured on the server.'
  }
  return err?.message || 'Request failed'
}

function sendError(res, err) {
  if (err?.code === 'AMAZON_SP_HTTP') {
    const json = amazonSpApiHttpErrorJson(err)
    return res.status(suggestedClientHttpStatusForAmazonUpstream(err.statusCode)).json({
      ...json,
      error: json?.error || 'Amazon SP-API request failed',
      code: 'AMAZON_SP_HTTP',
    })
  }
  const status =
    err?.status ||
    (err?.code === 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND' ||
    err?.code === 'AMAZON_UAE_SETTLEMENT_REPORT_NOT_FOUND'
      ? 404
      : 500)
  return res.status(status).json({
    success: false,
    error: safeMessage(err),
    code: err?.code || 'AMAZON_PAYMENT_CLEARING_ERROR',
  })
}

function marketplaceFromReq(req) {
  const raw = req.params?.marketplace || req.query?.marketplace || 'ksa'
  return getPaymentClearingMarketplaceConfig(normalizeMarketplaceKey(raw))
}

async function getSettlementReports(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.listRecentSettlementReports({
      daysBack: req.query.daysBack,
      pageSize: req.query.pageSize,
      createdSince: req.query.createdSince,
      marketplace: cfg.code,
      marketplaceKey: cfg.key,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postPreview(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.buildPreviewFromReport({
      reportId: req.body?.reportId,
      reportDocumentId: req.body?.reportDocumentId,
      daysBack: req.body?.daysBack,
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      zohoCustomerId: req.body?.zohoCustomerId,
      zohoCustomerName: req.body?.zohoCustomerName,
      forceRefresh: req.body?.forceRefresh === true,
      createdBy: req.user?.userId,
      marketplace: cfg.code,
      marketplaceKey: cfg.key,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postPreviewUpload(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'Upload a settlement TSV, CSV, or XLSX file.',
        code: 'AMAZON_SETTLEMENT_UPLOAD_EMPTY',
      })
    }
    const forceRefresh =
      req.body?.forceRefresh === true ||
      req.body?.forceRefresh === 'true' ||
      req.body?.forceRefresh === '1'
    const json = await service.buildPreviewFromUploadedSettlement({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      zohoCustomerId: req.body?.zohoCustomerId,
      zohoCustomerName: req.body?.zohoCustomerName,
      forceRefresh,
      createdBy: req.user?.userId,
      marketplace: cfg.code,
      marketplaceKey: cfg.key,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoCustomers(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.listZohoCustomers(cfg.code)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getSavedBatches(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.listSavedBatches(req.query?.limit, {
      marketplace: cfg.code,
      marketplaceKey: cfg.key,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postZohoInvoiceMatch(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.matchZohoInvoicesPreview(req.body?.rows || [], {
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      customerId: req.body?.zohoCustomerId,
      customerName: req.body?.zohoCustomerName,
      marketplace: cfg.code,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getBatch(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.getSavedBatch(req.params.id, {
      marketplace: cfg.code,
      marketplaceKey: cfg.key,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoAccountDiagnostics(req, res) {
  try {
    const marketplace = req.query?.marketplace || 'KSA'
    const json = await service.getZohoAccountDiagnostics(marketplace)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoChartAccounts(req, res) {
  try {
    const json = await service.listZohoAccountsForFeeMapping()
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getFeeJournalMappings(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.listFeeJournalMappings({
      marketplace: req.query?.marketplace || cfg.code,
      includeInactive: req.query?.includeInactive === 'true',
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postFeeJournalMapping(req, res) {
  try {
    const cfg = marketplaceFromReq(req)
    const json = await service.saveFeeJournalMapping(
      { ...(req.body || {}), marketplace: req.body?.marketplace || cfg.code },
      req.user?.userId
    )
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoOAuthAuthorize(req, res) {
  try {
    const json = service.getZohoOAuthAuthorizeUrl(req.query?.state || '')
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postZohoOAuthExchange(req, res) {
  try {
    const json = await service.exchangeZohoOAuthCode(req.body?.code)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoOAuthCallback(req, res) {
  try {
    const json = await service.exchangeZohoOAuthCode(req.query?.code)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function assertBatchMarketplaceForReq(req) {
  const cfg = marketplaceFromReq(req)
  await service.getSavedBatch(req.params.id, {
    marketplace: cfg.code,
    marketplaceKey: cfg.key,
  })
  return cfg
}

async function getCreditNoteApplyPlan(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.getCreditNoteApplyPlanForBatch(req.params.id)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postApplyCreditNotes(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.applyCreditNotesForBatchId(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      postedBy: req.user?.userId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getReturnFeePlan(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.getReturnFeePlanForBatch(req.params.id)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postApproveBatch(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.approveSavedBatch(req.params.id, req.user?.userId)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postPaymentPreview(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.buildPaymentPreviewForBatch(req.params.id, req.user?.userId)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postPostToZoho(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const dryRun = req.body?.dryRun !== false
    if (dryRun) {
      const json = await service.postBatchToZoho(req.params.id, {
        dryRun: true,
        postedBy: req.user?.userId,
      })
      return res.json(json)
    }
    const { startPostToZohoJob } = require('../services/amazonPaymentClearingPostingJobService')
    const json = startPostToZohoJob(req.params.id, { postedBy: req.user?.userId })
    return res.status(202).json({ success: true, ...json })
  } catch (err) {
    sendError(res, err)
  }
}

async function getPostToZohoJob(req, res) {
  try {
    const { getPostToZohoJob } = require('../services/amazonPaymentClearingPostingJobService')
    const json = getPostToZohoJob(req.params.jobId)
    if (!json) {
      return res.status(404).json({ success: false, error: 'Posting job not found.', code: 'AMAZON_PAYMENT_CLEARING_POST_JOB_NOT_FOUND' })
    }
    return res.json({ success: true, ...json })
  } catch (err) {
    sendError(res, err)
  }
}

async function postReturnFeeJournals(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.postReturnFeeJournalsForBatchId(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      postedBy: req.user?.userId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postForceRepost(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.forceRepostBatch(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      reason: req.body?.reason,
      postedBy: req.user?.userId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postReclassifyAccountLevelFees(req, res) {
  try {
    await assertBatchMarketplaceForReq(req)
    const json = await service.reclassifyAccountLevelFeesForBatch(req.params.id, req.body?.rowNumbers)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

// Back-compat aliases used by existing KSA-only route mounts / tests.
const getKsaSettlementReports = getSettlementReports
const postKsaPreview = postPreview
const postKsaPreviewUpload = postPreviewUpload
const getKsaZohoCustomers = getZohoCustomers
const getKsaSavedBatches = getSavedBatches
const postKsaZohoInvoiceMatch = postZohoInvoiceMatch
const getKsaBatch = getBatch
const postKsaApproveBatch = postApproveBatch
const getKsaCreditNoteApplyPlan = getCreditNoteApplyPlan
const postKsaApplyCreditNotes = postApplyCreditNotes
const getKsaReturnFeePlan = getReturnFeePlan
const postKsaPaymentPreview = postPaymentPreview
const postKsaPostToZoho = postPostToZoho
const getKsaPostToZohoJob = getPostToZohoJob
const postKsaReturnFeeJournals = postReturnFeeJournals
const postKsaForceRepost = postForceRepost
const postKsaReclassifyAccountLevelFees = postReclassifyAccountLevelFees

module.exports = {
  getSettlementReports,
  postPreview,
  postPreviewUpload,
  getZohoCustomers,
  getSavedBatches,
  postZohoInvoiceMatch,
  getBatch,
  getZohoAccountDiagnostics,
  getZohoChartAccounts,
  getFeeJournalMappings,
  postFeeJournalMapping,
  getZohoOAuthAuthorize,
  getZohoOAuthCallback,
  postZohoOAuthExchange,
  postApproveBatch,
  getCreditNoteApplyPlan,
  postApplyCreditNotes,
  getReturnFeePlan,
  postPaymentPreview,
  postPostToZoho,
  getPostToZohoJob,
  postReturnFeeJournals,
  postForceRepost,
  postReclassifyAccountLevelFees,
  getKsaSettlementReports,
  postKsaPreview,
  postKsaPreviewUpload,
  getKsaZohoCustomers,
  getKsaSavedBatches,
  postKsaZohoInvoiceMatch,
  getKsaBatch,
  postKsaApproveBatch,
  getKsaCreditNoteApplyPlan,
  postKsaApplyCreditNotes,
  getKsaReturnFeePlan,
  postKsaPaymentPreview,
  postKsaPostToZoho,
  getKsaPostToZohoJob,
  postKsaReturnFeeJournals,
  postKsaForceRepost,
  postKsaReclassifyAccountLevelFees,
}
