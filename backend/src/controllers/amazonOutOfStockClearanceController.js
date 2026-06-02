const service = require('../services/amazonOutOfStockClearanceService')

function safeMessage(err) {
  if (err.code === 'ZOHO_LIFE_SMILE_WAREHOUSE_NOT_FOUND') {
    return 'Life Smile Warehouse was not found in Zoho. Check warehouse name/ID configuration.'
  }
  if (err.code === 'ZOHO_NOT_CONFIGURED') {
    return 'Zoho is not configured. Add Zoho credentials on the server.'
  }
  if (err.code === 'INVALID_MARKETPLACE') {
    return err.message
  }
  if (err.code === 'AMAZON_LISTINGS_REPORT_TIMEOUT') {
    return 'Amazon listings report timed out. Try again in a few minutes.'
  }
  if (err.code === 'VIGIL_FILE_EMPTY' || err.code === 'VIGIL_PARSE_INVALID') {
    return err.message
  }
  if (err.status === 429 || String(err.message || '').includes('429')) {
    return 'Amazon rate limit reached. Wait and retry.'
  }
  return err.message || 'Request failed'
}

function sendError(res, err) {
  const status = err.status || (err.code === 'INVALID_MARKETPLACE' ? 400 : 500)
  res.status(status).json({
    success: false,
    error: safeMessage(err),
    code: err.code || 'CLEARANCE_ERROR',
    preview: err.preview,
  })
}

async function getOutOfStock(req, res) {
  try {
    const marketplace = req.query.marketplace
    const json = await service.getOutOfStockSkus(marketplace)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postZohoStock(req, res) {
  try {
    const { marketplace, skus } = req.body || {}
    const json = await service.getZohoStockForSkus({ marketplace, skus })
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postVigilPreview(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'File is required', code: 'FILE_REQUIRED' })
    }
    let columnMapping = null
    if (req.body?.columnMapping) {
      try {
        columnMapping = JSON.parse(req.body.columnMapping)
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid columnMapping JSON', code: 'INVALID_COLUMN_MAPPING' })
      }
    }
    const json = await service.previewVigilFile(req.file.buffer, req.file.originalname, columnMapping)
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postCalculate(req, res) {
  try {
    const json = service.calculate(req.body || {})
    res.json(json)
  } catch (err) {
    sendError(res, err)
  }
}

async function postExport(req, res) {
  try {
    const { buffer, filename } = await service.exportResults(req.body || {})
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    sendError(res, err)
  }
}

async function postUpdateAmazon(req, res) {
  try {
    service.updateAmazonStub()
  } catch (err) {
    sendError(res, err)
  }
}

module.exports = {
  getOutOfStock,
  postZohoStock,
  postVigilPreview,
  postCalculate,
  postExport,
  postUpdateAmazon,
}
