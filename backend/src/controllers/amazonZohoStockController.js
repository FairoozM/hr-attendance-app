const comparisonService = require('../services/amazonZohoStockComparisonService')
const refreshJobs = require('../services/amazonZohoStockRefreshJobService')

const STOCK_FILTERS = new Set([
  'all',
  'amazonOutOfStock',
  'zohoOutOfStock',
  'mismatch',
  'bothOutOfStock',
  'zohoNotFound',
  'sellerCentralInactiveOos',
])

function parseMarketplace(value) {
  const v = String(value || 'all').trim().toLowerCase()
  if (v === 'uae') return 'uae'
  if (v === 'ksa') return 'ksa'
  return 'all'
}

function parseFilters(query) {
  const stockFilter = STOCK_FILTERS.has(String(query.stockFilter || 'all')) ? String(query.stockFilter || 'all') : 'all'
  return {
    marketplace: parseMarketplace(query.marketplace),
    search: String(query.search || '').trim().slice(0, 200),
    stockFilter,
    page: query.page,
    limit: query.limit,
  }
}

async function getAmazonZohoStock(req, res) {
  try {
    const data = await comparisonService.readCachedAmazonZohoStock(parseFilters(req.query || {}))
    return res.json(data)
  } catch (e) {
    console.error('[amazon-zoho-stock] read failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to read cached Amazon + Zoho stock comparison',
    })
  }
}

async function postAmazonZohoStockRefresh(req, res) {
  try {
    const marketplace = parseMarketplace(req.body?.marketplace || req.query?.marketplace || 'all')
    const job = refreshJobs.startAmazonZohoStockRefresh({ marketplace })
    return res.json({
      success: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    })
  } catch (e) {
    console.error('[amazon-zoho-stock] refresh start failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to start Amazon + Zoho stock refresh',
    })
  }
}

async function getAmazonZohoStockRefreshStatus(req, res) {
  try {
    const job = refreshJobs.getAmazonZohoStockRefreshJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({ success: false, error: 'Refresh job not found' })
    }
    return res.json({
      success: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    })
  } catch (e) {
    console.error('[amazon-zoho-stock] refresh status failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to read refresh job status',
    })
  }
}

async function exportAmazonZohoStock(req, res) {
  try {
    const csv = await comparisonService.exportAmazonZohoStockCsv(parseFilters(req.query || {}))
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="amazon-zoho-stock-${stamp}.csv"`)
    return res.send(csv)
  } catch (e) {
    console.error('[amazon-zoho-stock] export failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to export Amazon + Zoho stock comparison',
    })
  }
}

module.exports = {
  getAmazonZohoStock,
  postAmazonZohoStockRefresh,
  getAmazonZohoStockRefreshStatus,
  exportAmazonZohoStock,
}
