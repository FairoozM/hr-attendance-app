const inventoryHealthService = require('../services/inventoryHealthService')
const refreshJobService = require('../services/inventoryHealthRefreshJobService')
const { isSyncPaused } = require('../services/zohoApiClient')

async function getInventoryHealth(req, res) {
  try {
    const data = await inventoryHealthService.getInventoryHealthDashboard(req.query || {})
    return res.json(data)
  } catch (err) {
    console.error('[inventory-health] dashboard failed:', err?.message || err)
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'Zoho is not configured for this server.',
        code: 'ZOHO_NOT_CONFIGURED',
      })
    }
    if (err && err.code === 'INVENTORY_HEALTH_WARMING') {
      return res.status(503).json({
        error: err.message,
        code: 'INVENTORY_HEALTH_WARMING',
        retryAfterSeconds: 15,
      })
    }
    if (err && err.code === 'INVENTORY_HEALTH_CACHE_ERROR') {
      return res.status(502).json({
        error: 'Inventory health data is temporarily unavailable. Try refresh in a minute.',
        code: 'INVENTORY_HEALTH_CACHE_ERROR',
      })
    }
    return res.status(500).json({
      error: 'Failed to load inventory health dashboard',
      code: 'INVENTORY_HEALTH_ERROR',
    })
  }
}

async function exportInventoryHealthCsv(req, res) {
  try {
    const data = await inventoryHealthService.getInventoryHealthDashboard(req.query || {})
    const stamp = new Date().toISOString().slice(0, 10)
    const csv = inventoryHealthService.rowsToCsv(data.rows || [])
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="inventory-health-${stamp}.csv"`)
    return res.send(csv)
  } catch (err) {
    console.error('[inventory-health] export failed:', err?.message || err)
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    if (err && err.code === 'INVENTORY_HEALTH_WARMING') {
      return res.status(503).json({
        error: err.message,
        code: 'INVENTORY_HEALTH_WARMING',
        retryAfterSeconds: 15,
      })
    }
    return res.status(500).json({ error: 'Failed to export inventory health CSV', code: 'INVENTORY_HEALTH_EXPORT_ERROR' })
  }
}

/** Start background Zoho rebuild — never blocks past CloudFront origin timeout. */
async function postInventoryHealthRefresh(req, res) {
  try {
    if (isSyncPaused()) {
      return res.status(429).json({
        error: 'Zoho API is paused after rate limiting (~15 min). Use cached data or wait before refreshing.',
        code: 'ZOHO_SYNC_PAUSED',
      })
    }
    const warehouseId =
      (req.body && req.body.warehouseId) ||
      (req.query && req.query.warehouseId) ||
      null
    // Do NOT clearInventoryHealthCache() here — that wiped the only Fast-path data and
    // left the page empty when CloudFront timed out mid-rebuild.
    const job = refreshJobService.startRefreshJob({ warehouseId })
    const status = job?.alreadyRunning ? 200 : 202
    return res.status(status).json(job)
  } catch (err) {
    console.error('[inventory-health] refresh failed:', err?.message || err)
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    return res.status(500).json({ error: 'Failed to refresh inventory health dashboard', code: 'INVENTORY_HEALTH_REFRESH_ERROR' })
  }
}

async function getInventoryHealthRefreshJob(req, res) {
  try {
    const job = refreshJobService.getRefreshJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({ error: 'Refresh job not found', code: 'REFRESH_JOB_NOT_FOUND' })
    }
    return res.json(job)
  } catch (err) {
    console.error('[inventory-health] refresh job status failed:', err?.message || err)
    return res.status(500).json({
      error: 'Failed to load refresh job status',
      code: 'INVENTORY_HEALTH_REFRESH_JOB_ERROR',
    })
  }
}

async function getActiveInventoryHealthRefreshJob(req, res) {
  try {
    const warehouseId =
      (req.query && req.query.warehouseId) || null
    return res.json({ job: refreshJobService.getActiveRefreshJob(warehouseId) })
  } catch (err) {
    console.error('[inventory-health] active refresh job failed:', err?.message || err)
    return res.status(500).json({
      error: 'Failed to load active refresh job',
      code: 'INVENTORY_HEALTH_REFRESH_ACTIVE_ERROR',
    })
  }
}

module.exports = {
  getInventoryHealth,
  exportInventoryHealthCsv,
  postInventoryHealthRefresh,
  getInventoryHealthRefreshJob,
  getActiveInventoryHealthRefreshJob,
}
