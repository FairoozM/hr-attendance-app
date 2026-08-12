const service = require('../services/noonPaymentClearing/noonPaymentClearingService')
const { listZohoChartAccounts } = require('../services/amazonPaymentClearingZohoPaymentService')

function userId(req) {
  return req.user?.id ?? req.user?.userId ?? null
}

function sendError(res, err) {
  const status = err.status || err.statusCode || 500
  return res.status(status).json({
    success: false,
    error: err.message || 'Noon payment clearing failed',
    code: err.code || 'NOON_PAYMENT_CLEARING_ERROR',
    details: err.details || undefined,
  })
}

async function getZohoCustomers(req, res) {
  try {
    const cfg = service.getNoonPaymentClearingMarketplaceConfig()
    return res.json({ success: true, customers: cfg.zohoCustomerOptions })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getSavedBatches(req, res) {
  try {
    const batches = await service.listSavedBatches(req.query.limit || 50, 'AE')
    return res.json({ success: true, batches })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getBatch(req, res) {
  try {
    const preview = await service.getBatchPreview(req.params.id)
    return res.json({ success: true, ...preview })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postPreviewUpload(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        error: 'Noon statement file is required.',
        code: 'NOON_PAYMENT_CLEARING_UPLOAD_REQUIRED',
      })
    }
    // Async job — CloudFront origin timeout (~30s) cannot wait for Zoho matching.
    const { startPreviewUploadJob } = require('../services/noonPaymentClearing/noonPaymentClearingUploadJobService')
    const job = await startPreviewUploadJob({
      buffer: req.file.buffer,
      fileName: req.file.originalname || '',
      customerName: req.body?.zohoCustomerName || req.body?.customerName,
      createdBy: userId(req),
      allowMatchFailure: String(req.body?.allowMatchFailure || '') === 'true',
    })
    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getPreviewUploadJob(req, res) {
  try {
    const { getPreviewUploadJob } = require('../services/noonPaymentClearing/noonPaymentClearingUploadJobService')
    const job = await getPreviewUploadJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Upload job not found.',
        code: 'NOON_PAYMENT_CLEARING_UPLOAD_JOB_NOT_FOUND',
      })
    }
    return res.json({ success: true, ...job })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postApproveBatch(req, res) {
  try {
    const batch = await service.approveSavedBatch(req.params.id, userId(req))
    return res.json({ success: true, batch })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postReconcileOpenBalances(req, res) {
  try {
    const { startReconcileOpenBalancesJob } = require('../services/noonPaymentClearing/noonPaymentClearingPostingJobService')
    const job = await startReconcileOpenBalancesJob(req.params.id, { createdBy: userId(req) })
    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      batchId: job.batchId,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postExcludeOpenBalanceShortfalls(req, res) {
  try {
    const preview = await service.excludeOpenBalanceShortfalls(req.params.id, {
      zohoInvoiceIds: req.body?.zohoInvoiceIds || [],
      itemOrderIds: req.body?.itemOrderIds || [],
      restore: req.body?.restore === true,
    })
    return res.json({ success: true, ...preview })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postPaymentPreview(req, res) {
  try {
    const { startPaymentPreviewJob } = require('../services/noonPaymentClearing/noonPaymentClearingPostingJobService')
    const job = await startPaymentPreviewJob(req.params.id, { createdBy: userId(req) })
    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      batchId: job.batchId,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postPostToZoho(req, res) {
  try {
    const dryRun = req.body?.dryRun !== false
    // Dry run stays sync (fast). Live post is async — CloudFront ~30s timeout.
    if (dryRun) {
      const result = await service.postBatchToZoho(req.params.id, {
        dryRun: true,
        postedBy: userId(req),
      })
      return res.json({ success: result.success !== false, ...result })
    }
    const { startPostToZohoJob } = require('../services/noonPaymentClearing/noonPaymentClearingPostingJobService')
    const job = await startPostToZohoJob(req.params.id, { postedBy: userId(req) })
    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      batchId: job.batchId,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postForceRepost(req, res) {
  try {
    const { startForceRepostJob } = require('../services/noonPaymentClearing/noonPaymentClearingPostingJobService')
    const job = await startForceRepostJob(req.params.id, {
      reason: req.body?.reason,
      actorUserId: userId(req),
    })
    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      batchId: job.batchId,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getClearingJob(req, res) {
  try {
    const { getPostingJob } = require('../services/noonPaymentClearing/noonPaymentClearingPostingJobService')
    const job = await getPostingJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found.',
        code: 'NOON_PAYMENT_CLEARING_JOB_NOT_FOUND',
      })
    }
    return res.json({ success: true, ...job })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getPostingJob(req, res) {
  return getClearingJob(req, res)
}

async function getFeeJournalMappings(req, res) {
  try {
    const mappings = await service.listFeeJournalMappings('AE')
    const inputVatAccount = await service.getInputVatSettings('AE')
    const cfg = service.getNoonPaymentClearingMarketplaceConfig()
    return res.json({
      success: true,
      mappings,
      /** Zoho CUSTOMER for invoice Record Payments only. */
      zohoCustomerName: cfg.zohoCustomerName,
      /** Amazon-parallel payment deposit accounts. */
      paymentPreviewAccounts: cfg.paymentPreviewAccounts,
      undepositedFundsAccount: cfg.undepositedFundsAccount,
      unclearedCommissionAccount: cfg.unclearedCommissionAccount,
      unclearedShippingAccount: cfg.unclearedShippingAccount,
      settlementBridgeAccount: cfg.undepositedFundsAccount,
      /** Zoho Input VAT CoA (default 1085) — overridable via settings picker. */
      inputVatAccount: {
        ...cfg.inputVatAccount,
        ...(inputVatAccount || {}),
        accountId: inputVatAccount?.accountId || inputVatAccount?.inputVatAccountId || cfg.inputVatAccount.accountId,
        accountName:
          inputVatAccount?.accountName ||
          inputVatAccount?.inputVatAccountName ||
          cfg.inputVatAccount.accountName,
        accountCode:
          inputVatAccount?.accountCode ||
          inputVatAccount?.inputVatAccountCode ||
          cfg.inputVatAccount.accountCode,
      },
      suggestions: cfg.feeJournalAccountSuggestions,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getInputVatSettings(req, res) {
  try {
    const settings = await service.getInputVatSettings('AE')
    return res.json({ success: true, settings, inputVatAccount: settings })
  } catch (err) {
    return sendError(res, err)
  }
}

async function putInputVatSettings(req, res) {
  try {
    const settings = await service.saveInputVatSettings(
      {
        marketplace: 'AE',
        inputVatAccountId: req.body?.inputVatAccountId || req.body?.accountId,
        inputVatAccountName: req.body?.inputVatAccountName || req.body?.accountName,
        inputVatAccountCode: req.body?.inputVatAccountCode || req.body?.accountCode,
        vatRate: req.body?.vatRate,
      },
      userId(req)
    )
    return res.json({ success: true, settings, inputVatAccount: settings })
  } catch (err) {
    return sendError(res, err)
  }
}

async function postFeeJournalMapping(req, res) {
  try {
    const mapping = await service.saveFeeJournalMapping(
      {
        id: req.body?.id,
        marketplace: 'AE',
        normalizedFeeType: req.body?.normalizedFeeType,
        rawTransactionType: req.body?.rawTransactionType,
        descriptionPattern: req.body?.descriptionPattern,
        zohoAccountId: req.body?.zohoAccountId || req.body?.expenseAccountId,
        zohoAccountName: req.body?.zohoAccountName || req.body?.expenseAccountName,
        // Legacy fields accepted but not required from UI.
        debitAccountName: req.body?.debitAccountName,
        debitAccountId: req.body?.debitAccountId,
        creditAccountName: req.body?.creditAccountName,
        creditAccountId: req.body?.creditAccountId,
        isActive: req.body?.isActive,
        priority: req.body?.priority,
      },
      userId(req)
    )
    return res.json({ success: true, mapping })
  } catch (err) {
    return sendError(res, err)
  }
}

async function deleteFeeJournalMapping(req, res) {
  try {
    const mapping = await service.deactivateFeeJournalMapping(req.params.id, userId(req))
    return res.json({ success: true, mapping })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getCreditNoteApplyPlan(req, res) {
  try {
    const json = await service.getCreditNoteApplyPlanForBatch(req.params.id)
    return res.json(json)
  } catch (err) {
    return sendError(res, err)
  }
}

async function postApplyCreditNotes(req, res) {
  try {
    const json = await service.applyCreditNotesForBatchId(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      postedBy: userId(req),
    })
    return res.json(json)
  } catch (err) {
    return sendError(res, err)
  }
}

async function getReturnFeePlan(req, res) {
  try {
    const json = await service.getReturnFeePlanForBatch(req.params.id)
    return res.json(json)
  } catch (err) {
    return sendError(res, err)
  }
}

async function postReturnFeeJournals(req, res) {
  try {
    const json = await service.postReturnFeeJournalsForBatchId(req.params.id, {
      dryRun: req.body?.dryRun !== false,
      postedBy: userId(req),
    })
    return res.json(json)
  } catch (err) {
    return sendError(res, err)
  }
}

async function getZohoChartAccounts(req, res) {
  try {
    const accounts = await listZohoChartAccounts()
    return res.json({ success: true, accounts })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = {
  getZohoCustomers,
  getSavedBatches,
  getBatch,
  postPreviewUpload,
  getPreviewUploadJob,
  postApproveBatch,
  postReconcileOpenBalances,
  postExcludeOpenBalanceShortfalls,
  postPaymentPreview,
  postPostToZoho,
  postForceRepost,
  getClearingJob,
  getPostingJob,
  getFeeJournalMappings,
  postFeeJournalMapping,
  deleteFeeJournalMapping,
  getInputVatSettings,
  putInputVatSettings,
  getZohoChartAccounts,
  getCreditNoteApplyPlan,
  postApplyCreditNotes,
  getReturnFeePlan,
  postReturnFeeJournals,
}
