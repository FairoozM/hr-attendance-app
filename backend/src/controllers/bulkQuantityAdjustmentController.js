const multer = require('multer')
const {
  uploadAndCreateBatch,
  validateBatchRows,
  postBatch,
  refreshBatchValuation,
  getBatchDetail,
  templateCsvContent,
  buildErrorExportWorkbook,
  buildResultExportWorkbook,
} = require('../services/bulkQuantityAdjustmentService')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

function userId(req) {
  return req.user && req.user.id != null ? req.user.id : null
}

function parseBatchId(raw) {
  const n = parseInt(String(raw || ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function getTemplate(_req, res) {
  const csv = templateCsvContent()
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="bulk_quantity_adjustment_template.csv"')
  return res.send(csv)
}

async function uploadFile(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'File is required (field name: file)' })
    }
    const result = await uploadAndCreateBatch({
      buffer: req.file.buffer,
      fileName: req.file.originalname || 'upload.csv',
      createdBy: userId(req),
    })
    return res.json({
      batch_id: result.batch.id,
      batch_reference: result.batch.batch_reference,
      batch: result.batch,
      rows: result.rows,
      parse_meta: result.parse_meta,
    })
  } catch (err) {
    const code = err && err.code ? err.code : 'UPLOAD_FAILED'
    const status = code === 'UPLOAD_MISSING_COLUMN' || code === 'UPLOAD_NO_ROWS' ? 400 : 500
    return res.status(status).json({
      error: err.message || 'Upload failed',
      code,
      column: err.column,
    })
  }
}

async function validateBatch(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  try {
    const result = await validateBatchRows(batchId)
    return res.json(result)
  } catch (err) {
    const code = err && err.code ? err.code : 'VALIDATE_FAILED'
    const status = code === 'BATCH_NOT_FOUND' ? 404 : 502
    return res.status(status).json({ error: err.message || 'Validation failed', code })
  }
}

async function postToZoho(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  if (req.body && req.body.confirmed !== true) {
    return res.status(400).json({
      error: 'Confirmation required. Send { confirmed: true } after reviewing the preview.',
      code: 'CONFIRMATION_REQUIRED',
    })
  }
  try {
    const result = await postBatch(batchId, {
      date: req.body && req.body.date,
      confirmedBy: userId(req),
    })
    return res.json(result)
  } catch (err) {
    const code = err && err.code ? err.code : 'POST_FAILED'
    let status = 502
    if (code === 'BATCH_NOT_FOUND') status = 404
    if (code === 'NO_VALID_ROWS' || code === 'BLOCKING_VALIDATION_ERRORS' || code === 'CONFIRMATION_REQUIRED') status = 400
    if (code === 'ZOHO_SYNC_PAUSED') status = 503
    if (code === 'BATCH_ALREADY_POSTED') status = 409
    return res.status(status).json({ error: err.message || 'Post failed', code })
  }
}

async function getBatch(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  try {
    const result = await getBatchDetail(batchId)
    return res.json(result)
  } catch (err) {
    const code = err && err.code ? err.code : 'GET_BATCH_FAILED'
    const status = code === 'BATCH_NOT_FOUND' ? 404 : 500
    return res.status(status).json({ error: err.message || 'Failed to load batch', code })
  }
}

async function exportErrors(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  try {
    const { batch, rows } = await getBatchDetail(batchId)
    const workbook = await buildErrorExportWorkbook(rows)
    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `${batch.batch_reference || 'batch'}-errors.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    return res.send(Buffer.from(buffer))
  } catch (err) {
    const code = err && err.code ? err.code : 'EXPORT_FAILED'
    const status = code === 'BATCH_NOT_FOUND' ? 404 : 500
    return res.status(status).json({ error: err.message || 'Export failed', code })
  }
}

async function exportResults(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  try {
    const { batch, rows } = await getBatchDetail(batchId)
    const workbook = await buildResultExportWorkbook(batch, rows)
    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `${batch.batch_reference || 'batch'}-results.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    return res.send(Buffer.from(buffer))
  } catch (err) {
    const code = err && err.code ? err.code : 'EXPORT_FAILED'
    const status = code === 'BATCH_NOT_FOUND' ? 404 : 500
    return res.status(status).json({ error: err.message || 'Export failed', code })
  }
}

async function refreshValuation(req, res) {
  const batchId = parseBatchId(req.params.batchId)
  if (!batchId) return res.status(400).json({ error: 'Invalid batch id' })
  try {
    const result = await refreshBatchValuation(batchId)
    return res.json(result)
  } catch (err) {
    const code = err && err.code ? err.code : 'REFRESH_FAILED'
    const status = code === 'BATCH_NOT_FOUND' ? 404 : 502
    return res.status(status).json({ error: err.message || 'Refresh failed', code })
  }
}

async function validateBatchFromBody(req, res) {
  const batchId = parseBatchId(req.body && req.body.batch_id)
  if (!batchId) return res.status(400).json({ error: 'batch_id is required' })
  req.params.batchId = String(batchId)
  return validateBatch(req, res)
}

async function postToZohoFromBody(req, res) {
  const batchId = parseBatchId(req.body && req.body.batch_id)
  if (!batchId) return res.status(400).json({ error: 'batch_id is required' })
  req.params.batchId = String(batchId)
  return postToZoho(req, res)
}

module.exports = {
  uploadMiddleware: upload.single('file'),
  getTemplate,
  uploadFile,
  validateBatch,
  validateBatchFromBody,
  postToZoho,
  postToZohoFromBody,
  getBatch,
  exportErrors,
  exportResults,
  refreshValuation,
}
