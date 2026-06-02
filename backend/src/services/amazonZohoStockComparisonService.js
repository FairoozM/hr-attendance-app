const { marketplaceIdForKey } = require('./amazonSpApiService')
const store = require('./amazonZohoStockComparisonStore')
const {
  fetchActiveAmazonListings,
  fetchAmazonInventoryForListings,
  marketplaceLabel,
} = require('./amazonListingsInventoryReadService')
const {
  fetchZohoStockForSkus,
  normalizeSku,
} = require('./zohoLifeSmileWarehouseService')

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
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
    amazonFetchedAt: new Date(
      Math.max(new Date(listingResult.fetchedAt).getTime(), new Date(invResult.fetchedAt).getTime())
    ).toISOString(),
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
  warnings.push(...(await store.getWarningMessages(filters)))
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
    lines.push(
      [
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
      ]
        .map(csvEscape)
        .join(',')
    )
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
    mergeRows,
    deriveRecommendedAction,
    rowsToCsv,
  },
}
