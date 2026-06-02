const { fetchOutOfStockAmazonSkus, normalizeMarketplaceKey } = require('./amazonListingsInventoryReadService')
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

async function getOutOfStockSkus(marketplace) {
  const mk = normalizeMarketplaceKey(marketplace)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    err.status = 400
    throw err
  }
  const result = await fetchOutOfStockAmazonSkus({ marketplaceKey: mk })
  return {
    success: true,
    marketplace: result.marketplace,
    marketplaceKey: result.marketplaceKey,
    rows: result.rows,
    totalListings: result.totalListings,
    outOfStockCount: result.rows.length,
    fetchedAt: result.fetchedAt,
    warnings: result.rows.length === 0 ? ['No out-of-stock SKUs found for this marketplace.'] : [],
  }
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
  getOutOfStockSkus,
  getZohoStockForSkus,
  previewVigilFile,
  calculate,
  exportResults,
  updateAmazonStub,
}
