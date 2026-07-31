const comparisonService = require('../services/amazonZohoStockComparisonService')
const refreshJobs = require('../services/amazonZohoStockRefreshJobService')

const MAX_VIGIL_MATCH_ROWS = 10_000
const MAX_COMPARISON_MATCH_ITEMS = 500

const STOCK_FILTERS = new Set([
  'all',
  'amazonOutOfStock',
  'zohoOutOfStock',
  'mismatch',
  'bothOutOfStock',
  'zohoNotFound',
  'amazonNotFound',
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

function sanitizeVigilRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      itemCode: String(row?.itemCode || '').trim().slice(0, 512),
      itemName: String(row?.itemName || '').trim().slice(0, 512),
      normalizedItemCode: String(row?.normalizedItemCode || '').trim().slice(0, 512),
      availableStock: Number.isFinite(Number(row?.availableStock))
        ? Number(row.availableStock)
        : 0,
    }))
    .filter((row) => row.itemCode || row.normalizedItemCode)
}

async function getAmazonZohoStock(req, res) {
  try {
    const filters = parseFilters(req.query || {})
    const refreshRunning = await refreshJobs.isRefreshRunning(filters.marketplace)
    const data = await comparisonService.readCachedAmazonZohoStock(filters, { refreshRunning })
    return res.json({ ...data, refreshRunning })
  } catch (e) {
    console.error('[amazon-zoho-stock] read failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to read cached Amazon + Zoho stock comparison',
    })
  }
}

async function postAmazonZohoStockVigilMatch(req, res) {
  try {
    const vigilRows = Array.isArray(req.body?.vigilRows) ? req.body.vigilRows : []
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (vigilRows.length > MAX_VIGIL_MATCH_ROWS) {
      return res.status(400).json({
        success: false,
        error: `Vigil upload exceeds ${MAX_VIGIL_MATCH_ROWS} rows`,
      })
    }
    if (items.length > MAX_COMPARISON_MATCH_ITEMS) {
      return res.status(400).json({
        success: false,
        error: `Comparison match request exceeds ${MAX_COMPARISON_MATCH_ITEMS} rows`,
      })
    }

    const safeVigilRows = sanitizeVigilRows(vigilRows)
    const safeItems = items.map((item, index) => ({
      rowKey: String(item?.rowKey || index).slice(0, 1100),
      sellerSku: String(item?.sellerSku || '').trim().slice(0, 512),
      zohoSku: String(item?.zohoSku || '').trim().slice(0, 512),
      zohoItemName: String(item?.zohoItemName || '').trim().slice(0, 512),
    }))

    return res.json({
      success: true,
      matches: comparisonService.matchVigilStockForComparisonItems({
        vigilRows: safeVigilRows,
        items: safeItems,
      }),
    })
  } catch (e) {
    console.error('[amazon-zoho-stock] Vigil match failed:', e?.message || e)
    return res.status(500).json({
      success: false,
      error: 'Failed to match Vigil stock quantities',
    })
  }
}

async function postAmazonZohoStockRefresh(req, res) {
  try {
    const marketplace = parseMarketplace(req.body?.marketplace || req.query?.marketplace || 'all')
    const job = await refreshJobs.startAmazonZohoStockRefresh({ marketplace })
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
    const job = await refreshJobs.getAmazonZohoStockRefreshJob(req.params.jobId)
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
    const vigilRows = Array.isArray(req.body?.vigilRows) ? req.body.vigilRows : []
    if (vigilRows.length > MAX_VIGIL_MATCH_ROWS) {
      return res.status(400).json({
        success: false,
        error: `Vigil upload exceeds ${MAX_VIGIL_MATCH_ROWS} rows`,
      })
    }
    const csv = await comparisonService.exportAmazonZohoStockCsv(
      parseFilters(req.query || {}),
      sanitizeVigilRows(vigilRows)
    )
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
  postAmazonZohoStockVigilMatch,
  postAmazonZohoStockRefresh,
  getAmazonZohoStockRefreshStatus,
  exportAmazonZohoStock,
}
