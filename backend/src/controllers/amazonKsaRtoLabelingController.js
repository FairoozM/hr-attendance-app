const XLSX = require('xlsx')
const service = require('../services/amazonKsaRtoLabelingService')

function getUserId(req) {
  const id = Number(req.user?.userId)
  return Number.isFinite(id) ? id : null
}

function sendError(res, err, fallback = 'Request failed') {
  const status = err.status || 500
  if (status >= 500) {
    console.error('[amazon-ksa-rto-labeling]', err)
  }
  res.status(status).json({
    error: err.message || fallback,
    details: err.details,
  })
}

function sendPublicError(res, err, fallback = 'Request failed') {
  const status = err.status && err.status < 500 ? err.status : 500
  if (status >= 500) {
    console.error('[amazon-ksa-rto-labeling:public]', err)
  }
  const safeMessage =
    status >= 500
      ? fallback
      : err.message || fallback
  res.status(status).json({ error: safeMessage })
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/_-]+/g, '')
}

function pickField(row, names, fallbackIndex) {
  for (const name of names) {
    if (row[name] != null) return row[name]
  }
  const values = Object.values(row)
  return values[fallbackIndex]
}

function rowsFromSheet(sheet) {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  if (!rawRows.length) return []
  const mappedRows = rawRows.map((raw) => {
    const normalized = {}
    for (const [key, value] of Object.entries(raw)) {
      normalized[normalizeHeader(key)] = value
    }
    return {
      productCode: pickField(normalized, ['productnamecode', 'productcode', 'productname', 'sku', 'code', 'item'], 0),
      fnskuNo: pickField(normalized, ['fnskuno', 'fnsku', 'amazonfnsku'], 1),
      quantity: pickField(normalized, ['quantity', 'qty'], 2),
      notes: pickField(normalized, ['notes', 'note', 'remarks'], 3),
      imageUrl: pickField(normalized, ['imageurl', 'productimageurl', 'image'], 4),
      pdfUrl: pickField(normalized, ['pdfurl', 'labelpdfurl', 'fnskupdfurl', 'fnskulabelpdf'], 5),
    }
  })
  return mappedRows.filter((row) => String(row.productCode || row.fnskuNo || row.quantity || '').trim())
}

function parseWorkbook(buffer, originalName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const rows = rowsFromSheet(workbook.Sheets[sheetName])
  return rows.map((row, index) => ({
    id: `parsed-${Date.now()}-${index}`,
    productCode: String(row.productCode || '').trim(),
    fnskuNo: String(row.fnskuNo || '').trim(),
    quantity: Number(String(row.quantity || '').replace(/,/g, '').trim()),
    notes: String(row.notes || '').trim(),
    imageUrl: String(row.imageUrl || '').trim(),
    pdfUrl: String(row.pdfUrl || '').trim(),
    sourceFile: originalName,
  }))
}

async function getBatches(req, res) {
  try {
    const batches = await service.listBatches(req.query || {})
    res.json({ batches })
  } catch (err) {
    sendError(res, err, 'Failed to list batches')
  }
}

async function getBatch(req, res) {
  try {
    const batch = await service.getBatch(req.params.id)
    if (!batch) return res.status(404).json({ error: 'Batch not found' })
    res.json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to load batch')
  }
}

async function postBatch(req, res) {
  try {
    const batch = await service.createBatch(req.body || {}, getUserId(req))
    res.status(201).json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to create batch')
  }
}

async function putBatch(req, res) {
  try {
    const batch = await service.updateBatch(req.params.id, req.body || {})
    res.json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to update batch')
  }
}

async function deleteBatch(req, res) {
  try {
    await service.deleteBatch(req.params.id)
    res.json({ success: true })
  } catch (err) {
    sendError(res, err, 'Failed to delete batch')
  }
}

async function postShare(req, res) {
  try {
    const batch = await service.setBatchShare(req.params.id, req.body || {})
    res.json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to enable share link')
  }
}

async function patchShare(req, res) {
  try {
    const batch = await service.setBatchShare(req.params.id, req.body || {})
    res.json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to update share link')
  }
}

async function deleteShare(req, res) {
  try {
    const batch = await service.disableBatchShare(req.params.id)
    res.json({ batch })
  } catch (err) {
    sendError(res, err, 'Failed to disable share link')
  }
}

async function postFile(req, res) {
  try {
    const fileType = String(req.body?.file_type || req.body?.fileType || '').trim()
    const file = await service.uploadFile(req.params.id, fileType, req.file, getUserId(req))
    res.status(201).json({ file })
  } catch (err) {
    sendError(res, err, 'Failed to upload file')
  }
}

async function postRowFile(req, res) {
  try {
    const fileType = String(req.body?.file_type || req.body?.fileType || '').trim()
    const jsonFile = fileFromJsonPayload(req.body || {})
    const result = await service.uploadRowFile(
      req.params.batchId,
      req.params.rowId,
      fileType,
      req.file || jsonFile,
      getUserId(req)
    )
    res.status(201).json(result)
  } catch (err) {
    sendError(res, err, 'Failed to upload row file')
  }
}

function fileFromJsonPayload(body) {
  const raw = String(body.file_base64 || body.fileBase64 || '').trim()
  if (!raw) return null
  const originalname = String(body.file_name || body.fileName || 'upload.bin').trim() || 'upload.bin'
  const declaredMime = String(body.mime_type || body.mimeType || '').trim()
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/)
  const mimetype = declaredMime || match?.[1] || 'application/octet-stream'
  const data = match ? match[2] : raw
  let buffer
  try {
    buffer = Buffer.from(data, 'base64')
  } catch {
    const err = new Error('Invalid base64 file payload.')
    err.status = 400
    throw err
  }
  if (!buffer.length) {
    const err = new Error('Uploaded file is empty.')
    err.status = 400
    throw err
  }
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  }
}

async function deleteFile(req, res) {
  try {
    await service.deleteFile(req.params.fileId)
    res.json({ success: true })
  } catch (err) {
    sendError(res, err, 'Failed to delete file')
  }
}

async function deleteRowFile(req, res) {
  try {
    const row = await service.deleteRowFile(req.params.fileId)
    res.json({ success: true, row })
  } catch (err) {
    sendError(res, err, 'Failed to delete row file')
  }
}

async function postParse(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a CSV or XLSX file first.' })
    const rows = parseWorkbook(req.file.buffer, req.file.originalname)
    res.json({ rows })
  } catch (err) {
    sendError(res, err, 'Failed to parse file')
  }
}

async function getPublicBatch(req, res) {
  try {
    const batch = await service.publicBatchByToken(req.params.shareToken)
    if (!batch) return res.status(404).json({ error: 'Share link is invalid, disabled, or expired.' })
    res.json({ batch })
  } catch (err) {
    sendPublicError(res, err, 'Could not load this shared batch. Please refresh or ask Life Smile for a new link.')
  }
}

async function postPublicRowStatus(req, res) {
  try {
    const batch = await service.updatePublicRowStatus(req.params.shareToken, req.params.rowId, req.body || {})
    res.json({ batch })
  } catch (err) {
    sendPublicError(res, err, 'Could not save this row status. Please try again.')
  }
}

async function postPublicComplete(req, res) {
  try {
    const batch = await service.completePublicBatch(req.params.shareToken, req.body || {})
    res.json({ batch })
  } catch (err) {
    sendPublicError(res, err, 'Could not complete this batch. Please try again.')
  }
}

module.exports = {
  getBatches,
  getBatch,
  postBatch,
  putBatch,
  deleteBatch,
  postShare,
  patchShare,
  deleteShare,
  postFile,
  postRowFile,
  deleteFile,
  deleteRowFile,
  postParse,
  getPublicBatch,
  postPublicRowStatus,
  postPublicComplete,
}
