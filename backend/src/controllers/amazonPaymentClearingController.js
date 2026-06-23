const service = require('../services/amazonPaymentClearingService')
const { amazonSpApiHttpErrorJson, suggestedClientHttpStatusForAmazonUpstream } = require('../services/amazonSpApiService')

function safeMessage(err) {
  if (err?.code === 'ZOHO_NOT_CONFIGURED') return 'Zoho is not configured. Add Zoho credentials on the server.'
  if (err?.code === 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND') return err.message
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
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_MULTIPLE_CUSTOMERS') return err.message
  if (err?.code === 'AMAZON_PAYMENT_CLEARING_CUSTOMER_ID_MISSING') return err.message
  if (err?.code === 'ZOHO_REDIRECT_URI_MISSING') return err.message
  if (err?.code === 'ZOHO_AUTH_CODE_REQUIRED') return err.message
  if (err?.code === 'AMAZON_SETTLEMENT_REPORT_DOCUMENT_MISSING') return err.message
  if (err?.code === 'AMAZON_REPORT_DOCUMENT_URL') return 'Amazon returned an invalid settlement report document URL.'
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
    (err?.code === 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND' ? 404 : 500)
  return res.status(status).json({
    success: false,
    error: safeMessage(err),
    code: err?.code || 'AMAZON_PAYMENT_CLEARING_ERROR',
  })
}

async function getKsaSettlementReports(req, res) {
  try {
    const json = await service.listRecentSettlementReports({
      daysBack: req.query.daysBack,
      pageSize: req.query.pageSize,
      createdSince: req.query.createdSince,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postKsaPreview(req, res) {
  try {
    const json = await service.buildPreviewFromReport({
      reportId: req.body?.reportId,
      reportDocumentId: req.body?.reportDocumentId,
      daysBack: req.body?.daysBack,
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      zohoCustomerId: req.body?.zohoCustomerId,
      forceRefresh: req.body?.forceRefresh === true,
      createdBy: req.user?.userId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getKsaSavedBatches(req, res) {
  try {
    const json = await service.listSavedBatches(req.query?.limit)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postKsaZohoInvoiceMatch(req, res) {
  try {
    const json = await service.matchZohoInvoicesPreview(req.body?.rows || [], {
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      customerId: req.body?.zohoCustomerId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getKsaBatch(req, res) {
  try {
    const json = await service.getSavedBatch(req.params.id)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function getZohoAccountDiagnostics(req, res) {
  try {
    const json = await service.getZohoAccountDiagnostics()
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

async function postKsaApproveBatch(req, res) {
  try {
    const json = await service.approveSavedBatch(req.params.id, req.user?.userId)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postKsaPaymentPreview(req, res) {
  try {
    const json = await service.buildPaymentPreviewForBatch(req.params.id, req.user?.userId)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postKsaPostToZoho(req, res) {
  try {
    const json = await service.postBatchToZoho(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      postedBy: req.user?.userId,
    })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postKsaForceRepost(req, res) {
  try {
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

module.exports = {
  getKsaSettlementReports,
  postKsaPreview,
  getKsaSavedBatches,
  postKsaZohoInvoiceMatch,
  getKsaBatch,
  getZohoAccountDiagnostics,
  getZohoOAuthAuthorize,
  getZohoOAuthCallback,
  postZohoOAuthExchange,
  postKsaApproveBatch,
  postKsaPaymentPreview,
  postKsaPostToZoho,
  postKsaForceRepost,
}
