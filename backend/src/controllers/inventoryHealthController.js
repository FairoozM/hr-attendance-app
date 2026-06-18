const inventoryHealthService = require('../services/inventoryHealthService')
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
    return res.status(500).json({ error: 'Failed to export inventory health CSV', code: 'INVENTORY_HEALTH_EXPORT_ERROR' })
  }
}

async function postInventoryHealthRefresh(req, res) {
  try {
    if (isSyncPaused()) {
      return res.status(429).json({
        error: 'Zoho API is paused after rate limiting (~15 min). Use cached data or wait before refreshing.',
        code: 'ZOHO_SYNC_PAUSED',
      })
    }
    inventoryHealthService.clearInventoryHealthCache()
    const data = await inventoryHealthService.getInventoryHealthDashboard({
      ...(req.query || {}),
      refresh: '1',
    })
    return res.json({ ...data, refreshed: true })
  } catch (err) {
    console.error('[inventory-health] refresh failed:', err?.message || err)
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    return res.status(500).json({ error: 'Failed to refresh inventory health dashboard', code: 'INVENTORY_HEALTH_REFRESH_ERROR' })
  }
}

module.exports = {
  getInventoryHealth,
  exportInventoryHealthCsv,
  postInventoryHealthRefresh,
}
