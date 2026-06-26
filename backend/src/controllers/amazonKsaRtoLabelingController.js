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

async function postFile(req, res) {
  try {
    const fileType = String(req.body?.file_type || req.body?.fileType || '').trim()
    const file = await service.uploadFile(req.params.id, fileType, req.file, getUserId(req))
    res.status(201).json({ file })
  } catch (err) {
    sendError(res, err, 'Failed to upload file')
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

async function postParse(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a CSV or XLSX file first.' })
    const rows = parseWorkbook(req.file.buffer, req.file.originalname)
    res.json({ rows })
  } catch (err) {
    sendError(res, err, 'Failed to parse file')
  }
}

module.exports = {
  getBatches,
  getBatch,
  postBatch,
  putBatch,
  deleteBatch,
  postFile,
  deleteFile,
  postParse,
}
