const service = require('../services/purchasePlanningService')

const PLAN_ITEM_PATCH_FIELDS = ['finalQty', 'included', 'purchasePrice', 'notes']

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function getRequestId(req) {
  const headers = req && req.headers
  return (
    (req && req.id) ||
    (headers && (headers['x-request-id'] || headers['x-amzn-requestid'])) ||
    null
  )
}

function logPurchasePlanningError(action, err, req, extra = {}) {
  console.error('[purchase-planning]', {
    action,
    requestId: getRequestId(req),
    userId: req.user && req.user.userId,
    ...extra,
    message: err && err.message,
    code: err && err.code,
  }, err)
}

function errorStatus(err) {
  if (!err) return 500
  if (['PLAN_NOT_FOUND', 'PLAN_ITEM_NOT_FOUND'].includes(err.code)) return 404
  if (
    [
      'NO_VIGIL_UPLOAD',
      'NO_LOW_STOCK_ITEMS',
      'DUPLICATE_PO',
      'NO_PO_LINES',
      'ZOHO_VENDOR_NOT_CONFIGURED',
      'ZOHO_PO_NUMBER_REQUIRED',
      'ZOHO_PO_PRICE_REQUIRED',
      'CSV_PARSE_ERROR',
      'EXCEL_PARSE_ERROR',
      'INVALID_PLAN_ID',
      'PLAN_NOT_DRAFT',
      'INVALID_PLAN_ITEM_BODY',
      'INVALID_ZOHO_PO_PAYLOAD',
      'AUTH_REQUIRED',
    ].includes(err.code)
  ) {
    return 400
  }
  if (err.code === 'ZOHO_NOT_CONFIGURED') return 503
  if (String(err.code || '').startsWith('ZOHO_')) return 502
  return 500
}

function sendError(res, err, fallbackMessage, fallbackCode) {
  const status = errorStatus(err)
  res.status(status).json({
    error: (err && err.message) || fallbackMessage,
    code: (err && err.code) || fallbackCode,
  })
}

/** Valid numeric user id for record-creating actions; null if missing or malformed. */
function authUserId(req) {
  const raw = req.user && req.user.userId
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function requireAuthUserId(req, res) {
  const id = authUserId(req)
  if (id != null) return id
  res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
  return null
}

function pickPlanItemPatch(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { patch: null, error: 'Request body must be a JSON object' }
  }
  const keys = Object.keys(body)
  const unknown = keys.filter((k) => !PLAN_ITEM_PATCH_FIELDS.includes(k))
  if (unknown.length > 0) {
    return { patch: null, error: `Unknown field(s): ${unknown.join(', ')}` }
  }
  if (keys.length === 0) {
    return { patch: null, error: 'At least one editable field is required' }
  }

  const patch = {}
  if (Object.prototype.hasOwnProperty.call(body, 'finalQty')) {
    const n = Number(body.finalQty)
    if (!Number.isFinite(n) || n < 0) {
      return { patch: null, error: 'finalQty must be a non-negative number' }
    }
    patch.finalQty = Math.floor(n)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'included')) {
    if (typeof body.included !== 'boolean') {
      return { patch: null, error: 'included must be a boolean' }
    }
    patch.included = body.included
  }
  if (Object.prototype.hasOwnProperty.call(body, 'purchasePrice')) {
    if (body.purchasePrice === '' || body.purchasePrice == null) {
      patch.purchasePrice = null
    } else {
      const n = Number(body.purchasePrice)
      if (!Number.isFinite(n) || n < 0) {
        return { patch: null, error: 'purchasePrice must be a non-negative number or empty' }
      }
      patch.purchasePrice = n
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    if (body.notes != null && typeof body.notes !== 'string') {
      return { patch: null, error: 'notes must be a string' }
    }
    patch.notes = body.notes
  }
  return { patch, error: null }
}

function validateCreateZohoPoBody(body) {
  const errors = []
  const poNumber = body && body.purchaseOrderNumber
  if (typeof poNumber !== 'string' || !String(poNumber).trim()) {
    errors.push('purchaseOrderNumber must be a non-empty string')
  }

  const prices = body && body.purchasePrices
  if (!Array.isArray(prices)) {
    errors.push('purchasePrices must be an array')
  } else if (prices.length === 0) {
    errors.push('purchasePrices must contain at least one entry')
  } else {
    prices.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`purchasePrices[${index}] must be an object`)
        return
      }
      const price = Number(entry.purchasePrice)
      if (!Number.isFinite(price) || price <= 0) {
        errors.push(`purchasePrices[${index}].purchasePrice must be a positive number`)
      }
      const itemId = Number(entry.planItemId || entry.itemId || entry.id)
      const sku = entry.sku != null ? String(entry.sku).trim() : ''
      if ((!Number.isInteger(itemId) || itemId <= 0) && !sku) {
        errors.push(`purchasePrices[${index}] must include planItemId or sku`)
      }
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      purchaseOrderNumber: String(poNumber).trim(),
      purchasePrices: prices,
    },
  }
}

function assertPlanFound(plan) {
  if (plan) return plan
  const err = new Error('Purchase plan not found')
  err.code = 'PLAN_NOT_FOUND'
  throw err
}

function assertPlanItemFound(row) {
  if (row) return row
  const err = new Error('Purchase plan item not found')
  err.code = 'PLAN_ITEM_NOT_FOUND'
  throw err
}

async function listLowStock(req, res) {
  try {
    res.json({ items: await service.listLowStock() })
  } catch (err) {
    logPurchasePlanningError('listLowStock', err, req)
    sendError(res, err, 'Failed to load low stock items', 'LOW_STOCK_LIST_FAILED')
  }
}

async function uploadLowStockSkus(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Low-stock SKU file is required', code: 'FILE_REQUIRED' })
    }
    const preview = await service.previewLowStockUpload(req.file.buffer, req.file.originalname)
    const shouldSave = String(req.body && req.body.save).toLowerCase() === 'true'
    if (!shouldSave) {
      return res.json({ saved: false, fileName: req.file.originalname, preview })
    }
    if (preview.summary.invalidRows > 0) {
      return res.status(400).json({
        error: 'Fix invalid SKU rows before saving the low-stock upload',
        code: 'LOW_STOCK_INVALID_ROWS',
        saved: false,
        fileName: req.file.originalname,
        preview,
      })
    }
    const summary = await service.saveLowStockUpload({ rows: preview.rows })
    const items = await service.listLowStock()
    res.status(201).json({ saved: true, summary, items, preview })
  } catch (err) {
    logPurchasePlanningError('uploadLowStockSkus', err, req)
    sendError(res, err, 'Failed to process low-stock SKU file', 'LOW_STOCK_UPLOAD_FAILED')
  }
}

async function refreshLowStockZoho(req, res) {
  try {
    const summary = await service.refreshLowStockZohoEnrichment()
    const items = await service.listLowStock()
    res.json({ summary, items })
  } catch (err) {
    logPurchasePlanningError('refreshLowStockZoho', err, req)
    sendError(res, err, 'Failed to refresh low-stock Zoho enrichment', 'LOW_STOCK_ZOHO_REFRESH_FAILED')
  }
}

async function uploadVigilCsv(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'CSV file is required', code: 'FILE_REQUIRED' })
    }
    const preview = await service.previewVigilUpload(req.file.buffer, req.file.originalname)
    const shouldSave = String(req.body && req.body.save).toLowerCase() === 'true'
    if (!shouldSave) {
      return res.json({ saved: false, fileName: req.file.originalname, preview })
    }
    const uploadedBy = requireAuthUserId(req, res)
    if (uploadedBy == null) return
    if (preview.summary.invalidRows > 0) {
      return res.status(400).json({
        error: 'Fix invalid rows before saving the Vigil upload',
        code: 'VIGIL_INVALID_ROWS',
        saved: false,
        fileName: req.file.originalname,
        preview,
      })
    }
    const upload = await service.saveVigilUpload({
      fileName: req.file.originalname || 'vigil-stock.csv',
      uploadedBy,
      rows: preview.rows,
    })
    res.status(201).json({ saved: true, upload, preview })
  } catch (err) {
    logPurchasePlanningError('uploadVigilCsv', err, req)
    sendError(res, err, 'Failed to process Vigil stock file', 'VIGIL_UPLOAD_FAILED')
  }
}

async function listVigilUploads(req, res) {
  try {
    res.json({ uploads: await service.listVigilUploads() })
  } catch (err) {
    logPurchasePlanningError('listVigilUploads', err, req)
    sendError(res, err, 'Failed to load Vigil upload history', 'VIGIL_UPLOADS_LIST_FAILED')
  }
}

async function generatePlan(req, res) {
  try {
    const createdBy = requireAuthUserId(req, res)
    if (createdBy == null) return
    const plan = await service.generatePlan({ createdBy })
    res.status(201).json({ plan })
  } catch (err) {
    logPurchasePlanningError('generatePlan', err, req)
    sendError(res, err, 'Failed to generate purchase plan', 'GENERATE_PLAN_FAILED')
  }
}

async function listPlans(req, res) {
  try {
    res.json({ plans: await service.listPlans() })
  } catch (err) {
    logPurchasePlanningError('listPlans', err, req)
    sendError(res, err, 'Failed to load purchase plans', 'PLANS_LIST_FAILED')
  }
}

async function getPlan(req, res) {
  const planId = parseId(req.params.id)
  if (!planId) {
    return res.status(400).json({ error: 'Invalid plan id', code: 'INVALID_PLAN_ID' })
  }
  try {
    const plan = assertPlanFound(await service.getPlan(planId))
    res.json({ plan })
  } catch (err) {
    logPurchasePlanningError('getPlan', err, req, { planId })
    sendError(res, err, 'Failed to load purchase plan', 'GET_PLAN_FAILED')
  }
}

async function deletePlan(req, res) {
  const planId = parseId(req.params.id)
  if (!planId) {
    return res.status(400).json({ error: 'Invalid plan id', code: 'INVALID_PLAN_ID' })
  }
  try {
    const result = await service.deleteDraftPlan(planId)
    res.json(result)
  } catch (err) {
    logPurchasePlanningError('deletePlan', err, req, { planId })
    sendError(res, err, 'Failed to delete purchase plan', 'DELETE_PLAN_FAILED')
  }
}

async function updatePlanItem(req, res) {
  const planId = parseId(req.params.id)
  const itemId = parseId(req.params.itemId)
  if (!planId || !itemId) {
    return res.status(400).json({ error: 'Invalid plan or item id', code: 'INVALID_PLAN_ID' })
  }
  const { patch, error } = pickPlanItemPatch(req.body)
  if (error) {
    return res.status(400).json({ error, code: 'INVALID_PLAN_ITEM_BODY' })
  }
  try {
    const row = assertPlanItemFound(await service.updatePlanItem(planId, itemId, patch))
    res.json({ item: row })
  } catch (err) {
    logPurchasePlanningError('updatePlanItem', err, req, { planId, itemId })
    sendError(res, err, 'Failed to update purchase plan item', 'UPDATE_PLAN_ITEM_FAILED')
  }
}

async function createZohoPo(req, res) {
  const planId = parseId(req.params.id)
  if (!planId) {
    return res.status(400).json({ error: 'Invalid plan id', code: 'INVALID_PLAN_ID' })
  }
  const validated = validateCreateZohoPoBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({
      error: validated.errors.join('; '),
      code: 'INVALID_ZOHO_PO_PAYLOAD',
      details: validated.errors,
    })
  }
  try {
    const result = await service.createZohoPurchaseOrder(planId, validated.value)
    res.json(result)
  } catch (err) {
    logPurchasePlanningError('createZohoPo', err, req, { planId })
    sendError(res, err, 'Failed to create Zoho purchase order', 'CREATE_ZOHO_PO_FAILED')
  }
}

module.exports = {
  listLowStock,
  uploadLowStockSkus,
  refreshLowStockZoho,
  uploadVigilCsv,
  listVigilUploads,
  generatePlan,
  listPlans,
  getPlan,
  deletePlan,
  updatePlanItem,
  createZohoPo,
  _internals: {
    parseId,
    authUserId,
    errorStatus,
    pickPlanItemPatch,
    validateCreateZohoPoBody,
    logPurchasePlanningError,
  },
}
