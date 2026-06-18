const service = require('../services/amazonReturnReconciliationService')
const s3Service = require('../services/s3Service')

function sendError(res, err) {
  const status = err.status || 500
  res.status(status).json({
    success: false,
    error: err.message || 'Request failed',
    code: err.code || 'AMAZON_RETURN_RECONCILIATION_ERROR',
  })
}

async function uploadBatch(req, res) {
  try {
    const detail = await service.createBatchFromUpload({
      file: req.file,
      title: req.body?.title,
      marketplace: req.body?.marketplace,
      agentName: req.body?.agentName,
      shippingTo: req.body?.shippingTo,
      createdBy: req.user?.id,
    })
    res.status(201).json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function listBatches(_req, res) {
  try {
    res.json({ success: true, batches: await service.listBatches() })
  } catch (err) {
    sendError(res, err)
  }
}

async function getBatch(req, res) {
  try {
    const detail = await service.getBatchDetail(req.params.batchId)
    if (!detail) return res.status(404).json({ success: false, error: 'Batch not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function updateCombinedSku(req, res) {
  try {
    const detail = await service.updateCombinedSku(req.params.combinedSkuId, req.body || {})
    if (!detail) return res.status(404).json({ success: false, error: 'Combined SKU not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function uploadLabel(req, res) {
  try {
    const detail = await service.uploadLabel({
      combinedSkuId: req.params.combinedSkuId,
      file: req.file,
      uploadedBy: req.user?.id,
    })
    if (!detail) return res.status(404).json({ success: false, error: 'Combined SKU not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function deleteLabel(req, res) {
  try {
    const detail = await service.deleteLabel(req.params.labelId)
    if (!detail) return res.status(404).json({ success: false, error: 'Label not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function regenerateLink(req, res) {
  try {
    const detail = await service.regeneratePublicToken(req.params.batchId)
    if (!detail) return res.status(404).json({ success: false, error: 'Batch not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function exportBatch(req, res) {
  try {
    const file = await service.exportBatch(req.params.batchId)
    if (!file) return res.status(404).json({ success: false, error: 'Batch not found' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    res.send(file.buffer)
  } catch (err) {
    sendError(res, err)
  }
}

async function getPublicReport(req, res) {
  try {
    const detail = await service.getAgentReportByToken(req.params.publicToken)
    if (!detail) return res.status(404).json({ success: false, error: 'Report not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function updatePublicCombinedSku(req, res) {
  try {
    const detail = await service.updateAgentCombinedSku(
      req.params.publicToken,
      req.params.combinedSkuId,
      req.body || {}
    )
    if (!detail) return res.status(404).json({ success: false, error: 'Report SKU not found' })
    res.json({ success: true, ...detail })
  } catch (err) {
    sendError(res, err)
  }
}

async function downloadPublicLabel(req, res) {
  try {
    const label = await service.getLabelForPublicDownload(req.params.publicToken, req.params.labelId)
    if (!label) return res.status(404).json({ success: false, error: 'Label not found' })
    const url = await s3Service.getDownloadUrl({ key: label.storagePath, expiresIn: 300 })
    res.redirect(302, url)
  } catch (err) {
    sendError(res, err)
  }
}

async function exportPublicBatch(req, res) {
  try {
    const file = await service.exportBatch(req.params.publicToken, { publicToken: true })
    if (!file) return res.status(404).json({ success: false, error: 'Report not found' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    res.send(file.buffer)
  } catch (err) {
    sendError(res, err)
  }
}

module.exports = {
  uploadBatch,
  listBatches,
  getBatch,
  updateCombinedSku,
  uploadLabel,
  deleteLabel,
  regenerateLink,
  exportBatch,
  getPublicReport,
  updatePublicCombinedSku,
  downloadPublicLabel,
  exportPublicBatch,
}
