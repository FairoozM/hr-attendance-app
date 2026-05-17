const service = require('../services/compositeItemsPriceReportService')

function statusForError(err) {
  if (err?.code === 'REPORT_ALREADY_RUNNING') return 409
  if (err?.code === 'REPORT_NOT_FOUND') return 404
  if (
    err?.code === 'INVALID_REPORT_ID' ||
    err?.code === 'ALL_PRICES_MISSING' ||
    err?.code === 'INVALID_MANUAL_SHIPPING' ||
    err?.code === 'PARENT_PRICE_INCOMPLETE'
  ) return 400
  if (err?.code === 'ZOHO_NOT_CONFIGURED') return 503
  return 500
}

async function listReports(_req, res) {
  try {
    const reports = await service.listCompositeItemsPriceReports()
    res.json({ reports })
  } catch (err) {
    console.error('[composite-price-report] list failed:', err)
    res.status(statusForError(err)).json({ error: err.message || 'Failed to list composite price reports', code: err.code })
  }
}

async function getReport(req, res) {
  try {
    const data = await service.getCompositeItemsPriceReport(req.params.reportId)
    res.json(data)
  } catch (err) {
    console.error('[composite-price-report] detail failed:', err)
    res.status(statusForError(err)).json({ error: err.message || 'Failed to load composite price report', code: err.code })
  }
}

async function generateReport(req, res) {
  try {
    const userId = req.user?.userId != null ? Number.parseInt(String(req.user.userId), 10) : null
    const result = await service.startCompositeItemsPriceReportGeneration({
      userId: Number.isFinite(userId) ? userId : null,
      mode: req.body?.mode === 'full' ? 'full' : 'incremental',
      force: req.body?.force === true,
      includeModified: req.body?.includeModified === true,
    })
    res.status(202).json(result)
  } catch (err) {
    console.error('[composite-price-report] generate failed:', err)
    res.status(statusForError(err)).json({ error: err.message || 'Failed to generate composite price report', code: err.code })
  }
}

async function deleteReport(req, res) {
  try {
    const result = await service.deleteCompositeItemsPriceReport(req.params.reportId)
    res.json(result)
  } catch (err) {
    console.error('[composite-price-report] delete failed:', err)
    res.status(statusForError(err)).json({ error: err.message || 'Failed to delete composite price report', code: err.code })
  }
}

async function saveParentPrice(req, res) {
  try {
    const userId = req.user?.userId != null ? Number.parseInt(String(req.user.userId), 10) : null
    const result = await service.saveCompositeParentPrice({
      reportId: req.params.reportId,
      itemId: req.params.itemId,
      userId: Number.isFinite(userId) ? userId : null,
      manualShipping: req.body?.manualShipping,
      dateOfPrice: req.body?.dateOfPrice,
    })
    res.json(result)
  } catch (err) {
    console.error('[composite-price-report] save parent price failed:', err)
    res.status(statusForError(err)).json({ error: err.message || 'Failed to save composite parent price', code: err.code })
  }
}

module.exports = {
  listReports,
  getReport,
  generateReport,
  deleteReport,
  saveParentPrice,
}
