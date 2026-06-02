const { normalizeMarketplaceKey } = require('./amazonListingsInventoryReadService')
const store = require('./amazonZohoStockComparisonStore')
const fetchJobs = require('./amazonOutOfStockClearanceJobService')
const {
  fetchZohoStockForSkus,
  zohoMapToRows,
  normalizeSku,
} = require('./zohoLifeSmileWarehouseService')
const { previewVigilUpload } = require('./vigilStockParseService')
const {
  calculateClearanceRows,
  exportRowsForKind,
  rowsToExportObjects,
} = require('./amazonOutOfStockClearanceCalculateService')
const { buildBusinessTableXlsxBuffer } = require('../utils/businessTableXlsx')

function parseMarketplaceQuery(raw) {
  const mk = normalizeMarketplaceKey(raw)
  if (!mk) return null
  return mk === 'ksa' ? 'KSA' : 'UAE'
}

function mapCachedComparisonRow(row, marketplaceKey) {
  return {
    marketplaceKey,
    marketplace: row.marketplace,
    amazonSku: row.sellerSku,
    normalizedSku: row.normalizedSku,
    title: row.title,
    asin: row.asin,
    amazonCurrentQty: Number(row.amazon?.availableQty) || 0,
    amazonStockStatus: row.amazon?.stockStatus || 'Out of Stock',
    fulfillmentChannel: row.fulfillmentChannel,
    image: row.image,
    dataSource: 'cache',
  }
}

function mapCachedZohoRows(rows) {
  return rows
    .filter((row) => row.zoho && row.zoho.stockStatus !== 'Not Found' && row.zoho.sku)
    .map((row) => ({
      sku: row.zoho.sku,
      normalizedSku: row.zoho.normalizedSku || row.normalizedSku,
      itemName: row.zoho.itemName,
      availableQty: Number(row.zoho.availableQty) || 0,
      warehouseName: row.zoho.warehouseName,
    }))
}

async function getOutOfStockFromCache(marketplace) {
  const mk = normalizeMarketplaceKey(marketplace)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    err.status = 400
    throw err
  }
  const cached = await store.selectAllComparisonRows({
    marketplace: mk,
    stockFilter: 'amazonOutOfStock',
  })
  const meta = await store.getComparisonSummary({ marketplace: mk })
  const warnings = []
  if (!meta.timestamps.comparisonGeneratedAt) {
    warnings.push(
      'No cached Amazon + Zoho stock data yet. Open Amazon + Zoho Stock, pick marketplace, click Refresh Amazon + Zoho, then filter Amazon Out of Stock.'
    )
  }
  const rows = cached.map((row) => mapCachedComparisonRow(row, mk))
  if (rows.length === 0 && meta.timestamps.comparisonGeneratedAt) {
    warnings.push('No out-of-stock SKUs in cache for this marketplace.')
  }
  return {
    success: true,
    source: 'cache',
    marketplace: mk === 'ksa' ? 'KSA' : 'UAE',
    marketplaceKey: mk,
    rows,
    zohoRowsFromCache: mapCachedZohoRows(cached),
    totalListings: meta.summary?.totalActiveListings ?? null,
    outOfStockCount: rows.length,
    fetchedAt: meta.timestamps.comparisonGeneratedAt,
    amazonLastFetchedAt: meta.timestamps.amazonLastFetchedAt,
    warnings,
  }
}

function startOutOfStockFetch(marketplace, mode = 'fast') {
  const mk = normalizeMarketplaceKey(marketplace)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    err.status = 400
    throw err
  }
  const modeRaw = String(mode || 'fast').toLowerCase()
  const fetchMode =
    modeRaw === 'fba' || modeRaw === 'discover' || modeRaw === 'full'
      ? 'fba'
      : modeRaw === 'listings-report'
        ? 'listings-report'
        : 'fast'
  const job = fetchJobs.startOutOfStockFetchJob({ marketplaceKey: mk, mode: fetchMode })
  return {
    success: true,
    ...job,
    mode: fetchMode,
    message:
      fetchMode === 'fba'
        ? 'FBA inventory scan started (Amazon has no “out of stock only” API — we page /fba/inventory/v1/summaries and filter).'
        : fetchMode === 'listings-report'
          ? 'Legacy listings report scan started (slow).'
          : 'Fast FBA refresh started (re-checks inventory for cached SKUs only — usually under a minute).',
  }
}

function getOutOfStockFetchStatus(jobId) {
  const job = fetchJobs.getOutOfStockFetchJob(jobId)
  if (!job) {
    const err = new Error('Fetch job not found')
    err.code = 'FETCH_JOB_NOT_FOUND'
    err.status = 404
    throw err
  }
  const payload = { success: true, ...job }
  if (job.status === 'completed' && job.result) {
    payload.marketplace = job.result.marketplace
    payload.marketplaceKey = job.result.marketplaceKey
    payload.rows = job.result.rows
    payload.totalListings = job.result.totalListings
    payload.outOfStockCount = job.result.rows.length
    payload.fetchedAt = job.result.fetchedAt
    payload.source = 'live'
    payload.warnings =
      job.result.rows.length === 0 ? ['No out-of-stock SKUs found for this marketplace.'] : []
  }
  return payload
}

async function getZohoStockForSkus({ marketplace, skus }) {
  const skuList = Array.isArray(skus) ? skus.filter(Boolean) : []
  if (skuList.length === 0) {
    const err = new Error('At least one SKU is required')
    err.code = 'SKUS_REQUIRED'
    err.status = 400
    throw err
  }
  const zohoResult = await fetchZohoStockForSkus({ skus: skuList })
  const rows = zohoMapToRows(zohoResult.zohoBySku)
  const missing = skuList.filter((sku) => !zohoResult.zohoBySku.has(normalizeSku(sku)))
  return {
    success: true,
    marketplace: parseMarketplaceQuery(marketplace) || marketplace,
    warehouse: zohoResult.warehouse,
    rows,
    fetchedAt: zohoResult.fetchedAt,
    missingSkus: missing,
  }
}

async function previewVigilFile(buffer, fileName, columnMapping) {
  const preview = await previewVigilUpload(buffer, fileName, { columnMapping })
  if (preview.needsColumnMapping && !columnMapping) {
    return {
      success: true,
      preview,
      needsColumnMapping: true,
      message: 'Could not detect item code and stock columns confidently. Please confirm column mapping.',
    }
  }
  if (preview.summary.invalidRows > 0 && preview.summary.validRows === 0) {
    const err = new Error('No valid Vigil rows found in upload')
    err.code = 'VIGIL_PARSE_INVALID'
    err.status = 400
    err.preview = preview
    throw err
  }
  return {
    success: true,
    preview,
    needsColumnMapping: Boolean(preview.needsColumnMapping),
  }
}

function calculate(body) {
  const result = calculateClearanceRows({
    amazonRows: body.amazonRows || body.amazonOutOfStockRows || [],
    zohoRows: body.zohoRows || body.zohoStockRows || [],
    vigilRows: body.vigilRows || body.vigilParsedRows || [],
    manualMappings: body.manualMappings || {},
    maxRecommendedQty: body.maxRecommendedQty,
    respectManualOverrides: body.respectManualOverrides !== false,
    confirmOverwriteManual: Boolean(body.confirmOverwriteManual),
  })
  return { success: true, ...result }
}

async function exportResults(body) {
  const rows = Array.isArray(body.rows) ? body.rows : []
  const filtered = exportRowsForKind(rows, body.exportKind)
  const objects = rowsToExportObjects(filtered)
  const sample = objects[0] || rowsToExportObjects([
    {
      amazonSku: '',
      amazonTitle: '',
      marketplace: '',
      amazonCurrentQty: 0,
      zohoLifeSmileQty: 0,
      zohoSku: '',
      vigilMatchedCode: '',
      vigilMatchedName: '',
      vigilQty: 0,
      totalAvailableQty: 0,
      recommendedAmazonUpdateQty: 0,
      matchMethod: '',
      status: '',
      notes: '',
      manuallyEdited: false,
    },
  ])[0]
  const columns = Object.keys(sample).map((header) => ({
    header,
    width: 18,
    type: 'rowText',
    getValue: (row) => row[header],
    grandTotalText: header === 'Amazon SKU' ? 'Total' : '',
  }))
  const buffer = await buildBusinessTableXlsxBuffer({
    sheetTitle: 'Amazon Out of Stock Clearance',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    items: objects,
    totals: {},
    columns,
  })
  const kind = String(body.exportKind || 'full').toLowerCase()
  const filename = `amazon-oos-clearance-${kind}-${Date.now()}.xlsx`
  return { buffer, filename, rowCount: filtered.length }
}

function updateAmazonStub() {
  const err = new Error('Amazon inventory updates are not enabled in this release.')
  err.code = 'AMAZON_INVENTORY_UPDATE_NOT_ENABLED'
  err.status = 501
  throw err
}

module.exports = {
  getOutOfStockFromCache,
  startOutOfStockFetch,
  getOutOfStockFetchStatus,
  getZohoStockForSkus,
  previewVigilFile,
  calculate,
  exportResults,
  updateAmazonStub,
}
