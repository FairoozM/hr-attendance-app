const coverageService = require('../services/skuChannelCoverageService')
const { COVERAGE_FILTERS } = require('../services/skuChannelCoverageMatching')

function parseFilter(value) {
  const v = String(value || 'all').trim()
  return COVERAGE_FILTERS.has(v) ? v : 'all'
}

function parseOptions(query = {}) {
  return {
    filter: parseFilter(query.filter),
    search: String(query.search || '').trim().slice(0, 200),
    refresh: query.refresh === '1' || query.refresh === 'true' || query.refresh === true,
  }
}

async function getSkuChannelCoverageSummary(req, res) {
  try {
    const data = await coverageService.getSkuChannelCoverageSummary(parseOptions(req.query || {}))
    return res.json(data)
  } catch (err) {
    console.error('[sku-coverage] summary failed:', err?.message || err)
    const code = err?.code || ''
    if (code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        error: 'Zoho is not configured for this server.',
        code,
      })
    }
    if (code === 'ZOHO_DAILY_BUDGET_EXCEEDED') {
      return res.status(429).json({
        success: false,
        error: err.message || 'Zoho daily API budget exceeded.',
        code,
      })
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to build SKU channel coverage summary',
      detail: err?.message || String(err),
    })
  }
}

async function exportSkuChannelCoverage(req, res) {
  try {
    const { buffer, filename } = await coverageService.exportSkuChannelCoverageXlsx(
      parseOptions(req.query || {})
    )
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(buffer)
  } catch (err) {
    console.error('[sku-coverage] export failed:', err?.message || err)
    return res.status(500).json({
      success: false,
      error: 'Failed to export SKU channel coverage report',
      detail: err?.message || String(err),
    })
  }
}

async function postSkuChannelCoverageRefresh(req, res) {
  try {
    coverageService.clearSkuChannelCoverageCache()
    const data = await coverageService.getSkuChannelCoverageSummary({ refresh: true })
    return res.json({
      success: true,
      refreshedAt: data.meta?.generatedAt || new Date().toISOString(),
      summary: data.summary,
      meta: data.meta,
    })
  } catch (err) {
    console.error('[sku-coverage] refresh failed:', err?.message || err)
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh SKU channel coverage data',
      detail: err?.message || String(err),
    })
  }
}

module.exports = {
  getSkuChannelCoverageSummary,
  exportSkuChannelCoverage,
  postSkuChannelCoverageRefresh,
}
