const {
  marketplaceIdForKey,
  createAmazonListingsReport,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  getAmazonFbaInventorySummaries,
  throwAmazonSpApiIfFailed,
} = require('./amazonSpApiService')
const store = require('./amazonZohoStockComparisonStore')
const { fetchItemsRawForWarehouse } = require('../integrations/zoho/zohoAdapter')
const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { normalizeSku } = require('../utils/normalizeSku')

const REPORT_POLL_INTERVAL_MS = 10_000
const REPORT_TIMEOUT_MS = 8 * 60_000
const LISTINGS_REPORT_TYPE = process.env.AMAZON_LISTINGS_REPORT_TYPE || 'GET_MERCHANT_LISTINGS_DATA'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeWarehouseName(value) {
  return clean(value).replace(/\s+/g, ' ').toUpperCase()
}

function marketplaceLabel(key) {
  return String(key).toLowerCase() === 'ksa' ? 'KSA' : 'UAE'
}

function defaultCurrency(key) {
  return String(key).toLowerCase() === 'ksa' ? 'SAR' : 'AED'
}

function parseDelimitedReport(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headers = splitReportLine(lines[0], delimiter).map((h) => clean(h).toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = splitReportLine(line, delimiter)
    const row = {}
    headers.forEach((header, idx) => {
      row[header] = cells[idx] != null ? cells[idx] : ''
    })
    return row
  })
}

function splitReportLine(line, delimiter) {
  if (delimiter === '\t') return String(line).split('\t')
  const out = []
  let cur = ''
  let quoted = false
  const raw = String(line)
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '"') {
      if (quoted && raw[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function first(row, keys) {
  for (const key of keys) {
    const value = row[String(key).toLowerCase()]
    if (value != null && clean(value)) return clean(value)
  }
  return ''
}

function isActiveListingRow(row) {
  const status = first(row, ['status', 'item-is-marketplace', 'listing-status', 'open-date'])
  const lowerStatus = status.toLowerCase()
  const inactiveHints = [
    'inactive',
    'closed',
    'deleted',
    'blocked',
    'suppressed',
    'missing',
    'removed',
    'detail page removed',
  ]
  const raw = Object.values(row || {}).join(' ').toLowerCase()
  if (inactiveHints.some((hint) => raw.includes(hint))) return false
  if (lowerStatus && ['n', 'no', 'false', '0'].includes(lowerStatus)) return false
  return true
}

function mapListingRow(row, marketplaceKey, marketplaceId) {
  const sellerSku = first(row, ['seller-sku', 'seller sku', 'sku', 'SellerSKU'])
  if (!sellerSku) return null
  if (!isActiveListingRow(row)) return null
  const amount = first(row, ['price', 'standard-price', 'your-price', 'listing-price'])
  const quantity = first(row, ['quantity', 'fulfillment-channel'])
  const image = first(row, ['image-url', 'main-image-url', 'image'])
  return {
    marketplaceKey,
    marketplace: marketplaceLabel(marketplaceKey),
    marketplaceId,
    sellerSku,
    normalizedSku: normalizeSku(sellerSku),
    asin: first(row, ['asin1', 'asin', 'ASIN']),
    title: first(row, ['item-name', 'title', 'product-name']),
    image,
    listingStatus: 'ACTIVE',
    fulfillmentChannel: String(quantity).toLowerCase().includes('amazon') ? 'AMAZON' : 'AMAZON',
    price: {
      amount: amount ? toNumber(amount, null) : null,
      currencyCode: defaultCurrency(marketplaceKey),
    },
  }
}

async function fetchActiveAmazonListings({ marketplaceKey, progress }) {
  const marketplaceId = marketplaceIdForKey(marketplaceKey)
  progress?.({ step: `Requesting Amazon ${marketplaceLabel(marketplaceKey)} active listings report`, current: 0, total: 0 })
  const create = await createAmazonListingsReport({
    marketplaceKey,
    marketplaceId,
    reportType: LISTINGS_REPORT_TYPE,
  })
  throwAmazonSpApiIfFailed(create, 'createListingsReport', marketplaceKey)
  const reportId = create.data?.reportId
  if (!reportId) {
    const err = new Error('Amazon did not return a listings report id')
    err.code = 'AMAZON_LISTINGS_REPORT_ID_MISSING'
    throw err
  }

  const started = Date.now()
  let report = null
  while (Date.now() - started < REPORT_TIMEOUT_MS) {
    await sleep(REPORT_POLL_INTERVAL_MS)
    const status = await getAmazonReport(reportId, { marketplaceKey })
    throwAmazonSpApiIfFailed(status, 'getListingsReport', marketplaceKey)
    report = status.data
    const processingStatus = String(report?.processingStatus || '').toUpperCase()
    progress?.({
      step: `Waiting for Amazon ${marketplaceLabel(marketplaceKey)} listings report (${processingStatus || 'PENDING'})`,
      current: 0,
      total: 0,
    })
    if (processingStatus === 'DONE') break
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      const err = new Error(`Amazon listings report ${processingStatus.toLowerCase()}`)
      err.code = 'AMAZON_LISTINGS_REPORT_FAILED'
      throw err
    }
  }
  if (!report || String(report.processingStatus || '').toUpperCase() !== 'DONE') {
    const err = new Error('Amazon listings report timed out')
    err.code = 'AMAZON_LISTINGS_REPORT_TIMEOUT'
    throw err
  }
  const reportDocumentId = report.reportDocumentId
  if (!reportDocumentId) {
    const err = new Error('Amazon listings report document id missing')
    err.code = 'AMAZON_LISTINGS_REPORT_DOCUMENT_MISSING'
    throw err
  }
  const doc = await getAmazonReportDocument(reportDocumentId, { marketplaceKey })
  throwAmazonSpApiIfFailed(doc, 'getListingsReportDocument', marketplaceKey)
  const download = await downloadAmazonReportDocument(doc.data?.url, {
    marketplaceKey,
    compressionAlgorithm: doc.data?.compressionAlgorithm,
  })
  if (download.status < 200 || download.status >= 300) {
    throwAmazonSpApiIfFailed(download, 'downloadListingsReportDocument', marketplaceKey)
  }
  const rows = parseDelimitedReport(download.data)
    .map((row) => mapListingRow(row, marketplaceKey, marketplaceId))
    .filter((row) => row && row.normalizedSku)
  const deduped = []
  const seen = new Set()
  for (const row of rows) {
    const key = `${row.marketplaceKey}:${row.normalizedSku}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  return {
    listings: deduped,
    fetchedAt: new Date().toISOString(),
  }
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function inventorySummaryList(data) {
  const payload = data?.payload || data
  const list = payload?.inventorySummaries || data?.inventorySummaries || []
  return Array.isArray(list) ? list : []
}

function nextTokenFromInventory(data) {
  const payload = data?.payload || data
  return payload?.pagination?.nextToken || payload?.nextToken || data?.nextToken || null
}

function mapInventorySummary(row) {
  const details = row?.inventoryDetails || {}
  const reserved = details.reservedQuantity || {}
  const inbound =
    toNumber(details.inboundWorkingQuantity) +
    toNumber(details.inboundShippedQuantity) +
    toNumber(details.inboundReceivingQuantity)
  const reservedQty =
    toNumber(reserved.totalReservedQuantity) ||
    toNumber(details.reservedQuantity) ||
    toNumber(row.reservedQuantity)
  const available = toNumber(row?.totalQuantity, NaN)
  const fulfillable = toNumber(details.fulfillableQuantity, Number.isFinite(available) ? available : 0)
  const unfulfillable = toNumber(details.unfulfillableQuantity)
  const total = Number.isFinite(available) ? available : fulfillable + inbound + reservedQty + unfulfillable
  return {
    sellerSku: clean(row?.sellerSku || row?.SellerSKU || row?.sku),
    availableQty: fulfillable,
    inboundQty: inbound,
    reservedQty,
    unfulfillableQty: unfulfillable,
    totalQty: total,
    stockStatus: fulfillable > 0 ? 'In Stock' : 'Out of Stock',
  }
}

async function fetchAmazonInventoryForListings({ marketplaceKey, marketplaceId, listings, progress }) {
  const skus = listings.map((row) => row.sellerSku).filter(Boolean)
  const inventoryBySku = new Map()
  const batches = chunk(skus, 50)
  let current = 0
  for (const batch of batches) {
    current += batch.length
    progress?.({
      step: `Fetching Amazon ${marketplaceLabel(marketplaceKey)} FBA inventory`,
      current,
      total: skus.length,
    })
    let nextToken = null
    do {
      const res = await getAmazonFbaInventorySummaries({
        marketplaceKey,
        marketplaceId,
        sellerSkus: batch,
        nextToken,
      })
      throwAmazonSpApiIfFailed(res, 'getFbaInventorySummaries', marketplaceKey)
      for (const summary of inventorySummaryList(res.data)) {
        const mapped = mapInventorySummary(summary)
        const key = normalizeSku(mapped.sellerSku)
        if (key) inventoryBySku.set(key, mapped)
      }
      nextToken = nextTokenFromInventory(res.data)
    } while (nextToken)
  }
  return {
    inventoryBySku,
    fetchedAt: new Date().toISOString(),
  }
}

async function resolveLifeSmileWarehouse() {
  const configuredId = clean(process.env.ZOHO_LIFE_SMILE_WAREHOUSE_ID || process.env.LIFE_SMILE_WAREHOUSE_ID || process.env.PURCHASE_PLANNING_WAREHOUSE_ID)
  const configuredNameRaw =
    process.env.ZOHO_LIFE_SMILE_WAREHOUSE_NAME ||
    process.env.PURCHASE_PLANNING_WAREHOUSE_NAME ||
    'Life Smile Warehouse'
  const configuredName = normalizeWarehouseName(configuredNameRaw)
  if (configuredId) {
    return { warehouseId: configuredId, warehouseName: clean(configuredNameRaw) || 'Life Smile Warehouse' }
  }
  const warehouses = await fetchWarehouses()
  const match = warehouses.find((warehouse) => {
    const name = normalizeWarehouseName(warehouse.warehouse_name || warehouse.location_name || warehouse.name)
    return name === configuredName || name === 'LIFE SMILE'
  })
  if (!match) {
    const err = new Error(`Zoho warehouse "${clean(configuredNameRaw) || 'Life Smile Warehouse'}" was not found`)
    err.code = 'ZOHO_LIFE_SMILE_WAREHOUSE_NOT_FOUND'
    throw err
  }
  return {
    warehouseId: clean(match.warehouse_id || match.location_id || match.id),
    warehouseName: clean(match.warehouse_name || match.location_name || match.name),
  }
}

function pickZohoQty(item, keys, fallback = 0) {
  for (const key of keys) {
    const n = toNumber(item?.[key], NaN)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function buildZohoStockMap(items, skuSet, warehouseName) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const sku = clean(item?.sku || item?.item_code || item?.code)
    const normalized = normalizeSku(sku)
    if (!normalized || (skuSet && !skuSet.has(normalized))) continue
    const available = pickZohoQty(item, [
      'warehouse_available_for_sale_stock',
      'location_available_for_sale_stock',
      'available_for_sale_stock',
      'warehouse_available_stock',
      'location_available_stock',
      'available_stock',
      'warehouse_actual_available_stock',
      'location_actual_available_stock',
      'actual_available_stock',
      'warehouse_stock_on_hand',
      'location_stock_on_hand',
      'stock_on_hand',
      'quantity_available',
    ])
    const actual = pickZohoQty(item, [
      'warehouse_stock_on_hand',
      'location_stock_on_hand',
      'stock_on_hand',
      'actual_available_stock',
      'warehouse_actual_available_stock',
    ], available)
    const committed = pickZohoQty(item, [
      'warehouse_committed_stock',
      'location_committed_stock',
      'committed_stock',
      'committed_quantity',
    ])
    map.set(normalized, {
      itemId: clean(item?.item_id || item?.id),
      sku,
      normalizedSku: normalized,
      itemName: clean(item?.name || item?.item_name),
      itemType: 'item',
      warehouseName,
      availableQty: available,
      actualQty: actual,
      committedQty: committed,
      stockStatus: available > 0 ? 'In Stock' : 'Out of Stock',
    })
  }
  return map
}

async function fetchZohoStockForSkus({ skus, progress }) {
  const warehouse = await resolveLifeSmileWarehouse()
  progress?.({ step: 'Fetching Zoho Life Smile warehouse stock', current: 0, total: skus.length })
  const items = await fetchItemsRawForWarehouse(warehouse.warehouseId)
  const skuSet = new Set(skus.map(normalizeSku).filter(Boolean))
  return {
    zohoBySku: buildZohoStockMap(items, skuSet, warehouse.warehouseName),
    warehouse,
    fetchedAt: new Date().toISOString(),
  }
}

function deriveRecommendedAction({ amazonAvailable, zohoAvailable, zohoStatus, difference, threshold }) {
  if (zohoStatus === 'Not Found') return 'Create SKU in Zoho'
  if (amazonAvailable === 0 && zohoAvailable > 0) return 'Replenish Amazon FBA'
  if (difference < 0) return 'Audit Zoho Inventory - Amazon shows more than Zoho'
  if (difference === 0) return 'Stock matched'
  if (zohoAvailable <= threshold && zohoStatus !== 'Not Found') return 'Low Zoho stock warning'
  return 'Stock matched'
}

function mergeRows({
  listings,
  inventoryBySku,
  zohoBySku,
  amazonFetchedAt,
  zohoFetchedAt,
  comparisonGeneratedAt,
  zohoUnavailable = false,
  zohoWarehouseName = '',
}) {
  const threshold = Math.max(0, parseInt(String(process.env.STOCK_THRESHOLD_WARNING || '5'), 10) || 5)
  return listings.map((listing) => {
    const inv = inventoryBySku.get(listing.normalizedSku)
    const amazon = inv || {
      availableQty: 0,
      inboundQty: 0,
      reservedQty: 0,
      unfulfillableQty: 0,
      totalQty: 0,
      stockStatus: 'Out of Stock',
    }
    const zoho = zohoBySku.get(listing.normalizedSku) || {
      itemId: '',
      sku: '',
      normalizedSku: listing.normalizedSku,
      itemName: '',
      itemType: '',
      warehouseName: zohoWarehouseName || '',
      availableQty: 0,
      actualQty: 0,
      committedQty: 0,
      stockStatus: zohoUnavailable ? 'Unknown' : 'Not Found',
    }
    const amazonAvailable = toNumber(amazon.availableQty)
    const zohoAvailable = toNumber(zoho.availableQty)
    const difference = zohoAvailable - amazonAvailable
    const recommendedAction = deriveRecommendedAction({
      amazonAvailable,
      zohoAvailable,
      zohoStatus: zoho.stockStatus,
      difference,
      threshold,
    })
    const isMismatch = zoho.stockStatus === 'Not Found' || (!zohoUnavailable && difference !== 0)
    return {
      ...listing,
      amazon,
      zoho,
      comparison: {
        difference,
        isMismatch,
        recommendedAction,
      },
      timestamps: {
        amazonLastFetchedAt: amazonFetchedAt,
        zohoLastFetchedAt: zohoFetchedAt,
        comparisonGeneratedAt,
      },
    }
  })
}

async function refreshMarketplace({ marketplaceKey, progress }) {
  const listingResult = await fetchActiveAmazonListings({ marketplaceKey, progress })
  const marketplaceId = marketplaceIdForKey(marketplaceKey)
  const invResult = await fetchAmazonInventoryForListings({
    marketplaceKey,
    marketplaceId,
    listings: listingResult.listings,
    progress,
  })
  return {
    marketplaceKey,
    listings: listingResult.listings,
    inventoryBySku: invResult.inventoryBySku,
    amazonFetchedAt: new Date(Math.max(
      new Date(listingResult.fetchedAt).getTime(),
      new Date(invResult.fetchedAt).getTime()
    )).toISOString(),
  }
}

async function refreshAmazonZohoStockComparison({ marketplace = 'all', progress } = {}) {
  const mkRaw = String(marketplace || 'all').trim().toLowerCase()
  const marketplaceKeys = mkRaw === 'uae' || mkRaw === 'ksa' ? [mkRaw] : ['uae', 'ksa']
  const amazonResults = []
  const amazonWarnings = []
  for (const marketplaceKey of marketplaceKeys) {
    try {
      amazonResults.push(await refreshMarketplace({ marketplaceKey, progress }))
    } catch (e) {
      const message = `Amazon ${marketplaceLabel(marketplaceKey)} refresh failed; existing cached rows for that marketplace were kept.`
      amazonWarnings.push(message)
      console.warn('[amazon-zoho-stock] Amazon refresh failed:', marketplaceKey, e?.message || e)
      if (marketplaceKeys.length === 1) throw e
    }
  }
  if (amazonResults.length === 0) {
    const err = new Error('Amazon refresh failed for all marketplaces')
    err.code = 'AMAZON_ZOHO_STOCK_AMAZON_FAILED'
    throw err
  }
  const skus = []
  for (const result of amazonResults) {
    for (const listing of result.listings) skus.push(listing.sellerSku)
  }
  let zohoWarning = null
  let zohoResult
  try {
    zohoResult = await fetchZohoStockForSkus({ skus, progress })
  } catch (e) {
    zohoWarning = 'Zoho stock refresh failed; Amazon listings were refreshed with Zoho status Unknown.'
    console.warn('[amazon-zoho-stock] Zoho refresh failed:', e?.message || e)
    zohoResult = {
      zohoBySku: new Map(),
      warehouse: { warehouseName: process.env.ZOHO_LIFE_SMILE_WAREHOUSE_NAME || 'Life Smile Warehouse' },
      fetchedAt: null,
    }
  }
  const comparisonGeneratedAt = new Date().toISOString()
  let totalRows = 0
  for (const result of amazonResults) {
    const rows = mergeRows({
      listings: result.listings,
      inventoryBySku: result.inventoryBySku,
      zohoBySku: zohoResult.zohoBySku,
      amazonFetchedAt: result.amazonFetchedAt,
      zohoFetchedAt: zohoResult.fetchedAt,
      comparisonGeneratedAt,
      zohoUnavailable: Boolean(zohoWarning),
      zohoWarehouseName: zohoResult.warehouse?.warehouseName,
    })
    if (zohoWarning) {
      rows.forEach((row) => {
        row.warnings = [...(row.warnings || []), zohoWarning]
      })
    }
    if (amazonWarnings.length > 0) {
      rows.forEach((row) => {
        row.warnings = [...(row.warnings || []), ...amazonWarnings]
      })
    }
    await store.replaceMarketplaceRows(result.marketplaceKey, rows)
    totalRows += rows.length
  }
  return {
    totalRows,
    marketplaces: marketplaceKeys,
    comparisonGeneratedAt,
  }
}

async function readCachedAmazonZohoStock(filters = {}) {
  const result = await store.selectComparisonRows(filters)
  const meta = await store.getComparisonSummary(filters)
  const warnings = []
  const generated = await store.getLatestComparisonGeneratedAt(filters.marketplace || 'all')
  warnings.push(...await store.getWarningMessages(filters))
  if (!generated) warnings.push('No cached comparison data is available yet. Run refresh to generate it.')
  const ttlMinutes = Math.max(1, parseInt(String(process.env.AMAZON_ZOHO_STOCK_CACHE_TTL_MINUTES || '15'), 10) || 15)
  if (generated && Date.now() - new Date(generated).getTime() > ttlMinutes * 60_000) {
    warnings.push(`Cached comparison data is older than ${ttlMinutes} minutes. Run refresh for fresh stock.`)
  }
  return {
    success: true,
    data: result.rows,
    pagination: result.pagination,
    summary: meta.summary,
    warnings,
    timestamps: meta.timestamps,
  }
}

function csvEscape(value) {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows) {
  const headers = [
    'Marketplace',
    'SKU',
    'ASIN',
    'Title',
    'Price Amount',
    'Currency',
    'Amazon Available FBA',
    'Amazon Reserved',
    'Amazon Inbound',
    'Amazon Unfulfillable',
    'Zoho Life Smile Available',
    'Zoho Actual',
    'Zoho Committed',
    'Difference',
    'Zoho Status',
    'Amazon Status',
    'Recommended Action',
    'Amazon Last Fetched At',
    'Zoho Last Fetched At',
    'Comparison Generated At',
  ]
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push([
      row.marketplace,
      row.sellerSku,
      row.asin,
      row.title,
      row.price?.amount,
      row.price?.currencyCode,
      row.amazon?.availableQty,
      row.amazon?.reservedQty,
      row.amazon?.inboundQty,
      row.amazon?.unfulfillableQty,
      row.zoho?.availableQty,
      row.zoho?.actualQty,
      row.zoho?.committedQty,
      row.comparison?.difference,
      row.zoho?.stockStatus,
      row.amazon?.stockStatus,
      row.comparison?.recommendedAction,
      row.timestamps?.amazonLastFetchedAt,
      row.timestamps?.zohoLastFetchedAt,
      row.timestamps?.comparisonGeneratedAt,
    ].map(csvEscape).join(','))
  }
  return lines.join('\n')
}

async function exportAmazonZohoStockCsv(filters = {}) {
  const rows = await store.selectAllComparisonRows(filters)
  return rowsToCsv(rows)
}

module.exports = {
  refreshAmazonZohoStockComparison,
  readCachedAmazonZohoStock,
  exportAmazonZohoStockCsv,
  _internals: {
    normalizeSku,
    parseDelimitedReport,
    mapListingRow,
    mergeRows,
    deriveRecommendedAction,
    rowsToCsv,
  },
}
