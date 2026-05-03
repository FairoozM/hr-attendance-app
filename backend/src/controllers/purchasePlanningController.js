const service = require('../services/purchasePlanningService')

function userId(req) {
  const n = Number(req.user && req.user.userId)
  return Number.isFinite(n) ? n : null
}

function parseId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function errorStatus(err) {
  if (!err) return 500
  if (['PLAN_NOT_FOUND'].includes(err.code)) return 404
  if (['NO_VIGIL_UPLOAD', 'NO_LOW_STOCK_ITEMS', 'DUPLICATE_PO', 'NO_PO_LINES', 'ZOHO_VENDOR_NOT_CONFIGURED'].includes(err.code)) return 400
  if (err.code === 'ZOHO_NOT_CONFIGURED') return 503
  if (String(err.code || '').startsWith('ZOHO_')) return 502
  return 500
}

async function listLowStock(_req, res) {
  try {
    res.json({ items: await service.listLowStock() })
  } catch (err) {
    console.error('[purchase-planning] low-stock list error:', err)
    res.status(500).json({ error: 'Failed to load low stock items' })
  }
}

async function uploadLowStockSkus(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Low-stock SKU file is required' })
    }
    const preview = service.previewLowStockUpload(req.file.buffer, req.file.originalname)
    const shouldSave = String(req.body && req.body.save).toLowerCase() === 'true'
    if (!shouldSave) {
      return res.json({ saved: false, fileName: req.file.originalname, preview })
    }
    if (preview.summary.invalidRows > 0) {
      return res.status(400).json({
        error: 'Fix invalid SKU rows before saving the low-stock upload',
        saved: false,
        fileName: req.file.originalname,
        preview,
      })
    }
    const summary = await service.saveLowStockUpload({ rows: preview.rows })
    const items = await service.listLowStock()
    res.status(201).json({ saved: true, summary, items, preview })
  } catch (err) {
    console.error('[purchase-planning] low-stock upload error:', err)
    res.status(err.code === 'CSV_PARSE_ERROR' || err.code === 'EXCEL_PARSE_ERROR' ? 400 : errorStatus(err)).json({
      error: err.message || 'Failed to process low-stock SKU file',
      code: err.code || 'LOW_STOCK_UPLOAD_FAILED',
    })
  }
}

async function refreshLowStockZoho(req, res) {
  try {
    const summary = await service.refreshLowStockZohoEnrichment()
    const items = await service.listLowStock()
    res.json({ summary, items })
  } catch (err) {
    console.error('[purchase-planning] low-stock Zoho refresh error:', err)
    res.status(errorStatus(err)).json({
      error: err.message || 'Failed to refresh low-stock Zoho enrichment',
      code: err.code || 'LOW_STOCK_ZOHO_REFRESH_FAILED',
    })
  }
}

async function uploadVigilCsv(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'CSV file is required' })
    }
    const preview = await service.previewVigilUpload(req.file.buffer, req.file.originalname)
    const shouldSave = String(req.body && req.body.save).toLowerCase() === 'true'
    if (!shouldSave) {
      return res.json({ saved: false, fileName: req.file.originalname, preview })
    }
    if (preview.summary.invalidRows > 0) {
      return res.status(400).json({
        error: 'Fix invalid rows before saving the Vigil upload',
        saved: false,
        fileName: req.file.originalname,
        preview,
      })
    }
    const upload = await service.saveVigilUpload({
      fileName: req.file.originalname || 'vigil-stock.csv',
      uploadedBy: userId(req),
      rows: preview.rows,
    })
    res.status(201).json({ saved: true, upload, preview })
  } catch (err) {
    console.error('[purchase-planning] vigil upload error:', err)
    res.status(err.code === 'CSV_PARSE_ERROR' || err.code === 'EXCEL_PARSE_ERROR' ? 400 : 500).json({
      error: err.message || 'Failed to process Vigil stock file',
      code: err.code || 'VIGIL_UPLOAD_FAILED',
    })
  }
}

async function listVigilUploads(_req, res) {
  try {
    res.json({ uploads: await service.listVigilUploads() })
  } catch (err) {
    console.error('[purchase-planning] vigil uploads list error:', err)
    res.status(500).json({ error: 'Failed to load Vigil upload history' })
  }
}

async function generatePlan(req, res) {
  try {
    const plan = await service.generatePlan({ createdBy: userId(req) })
    res.status(201).json({ plan })
  } catch (err) {
    console.error('[purchase-planning] generate plan error:', err)
    res.status(errorStatus(err)).json({
      error: err.message || 'Failed to generate purchase plan',
      code: err.code || 'GENERATE_PLAN_FAILED',
    })
  }
}

async function listPlans(_req, res) {
  try {
    res.json({ plans: await service.listPlans() })
  } catch (err) {
    console.error('[purchase-planning] plans list error:', err)
    res.status(500).json({ error: 'Failed to load purchase plans' })
  }
}

async function getPlan(req, res) {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid plan id' })
    const plan = await service.getPlan(id)
    if (!plan) return res.status(404).json({ error: 'Purchase plan not found' })
    res.json({ plan })
  } catch (err) {
    console.error('[purchase-planning] plan get error:', err)
    res.status(500).json({ error: 'Failed to load purchase plan' })
  }
}

async function updatePlanItem(req, res) {
  try {
    const planId = parseId(req.params.id)
    const itemId = parseId(req.params.itemId)
    if (!planId || !itemId) return res.status(400).json({ error: 'Invalid plan or item id' })
    const row = await service.updatePlanItem(planId, itemId, req.body || {})
    if (!row) return res.status(404).json({ error: 'Purchase plan item not found' })
    res.json({ item: row })
  } catch (err) {
    console.error('[purchase-planning] plan item update error:', err)
    res.status(500).json({ error: 'Failed to update purchase plan item' })
  }
}

async function createZohoPo(req, res) {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid plan id' })
    const result = await service.createZohoPurchaseOrder(id)
    res.json(result)
  } catch (err) {
    console.error('[purchase-planning] create Zoho PO error:', err)
    res.status(errorStatus(err)).json({
      error: err.message || 'Failed to create Zoho purchase order',
      code: err.code || 'CREATE_ZOHO_PO_FAILED',
    })
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
  updatePlanItem,
  createZohoPo,
}
