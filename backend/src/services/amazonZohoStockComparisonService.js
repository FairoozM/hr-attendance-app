const { marketplaceIdForKey } = require('./amazonSpApiService')
const store = require('./amazonZohoStockComparisonStore')
const {
  fetchActiveAmazonListings,
  fetchAmazonInventoryForListings,
  fetchAfnManageInventoryBySku,
  marketplaceLabel,
  afnReportWarningMessage,
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
      stockStatus: zohoUnavailable ? 'Unknown' : 'Not Found',
    }
    const amazonOnHand = toNumber(amazon.totalQty, toNumber(amazon.availableQty))
    const amazonFulfillable = toNumber(amazon.availableQty)
    const zohoAvailable = toNumber(zoho.availableQty)
    const difference = zohoAvailable - amazonOnHand
    const recommendedAction = deriveRecommendedAction({
      amazonAvailable: amazonOnHand,
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

  let afnReportBySku = new Map()
  let afnReportWarning = null
  let afnReportFailed = false
  try {
    progress?.({
      step: `Fetching Amazon ${marketplaceLabel(marketplaceKey)} AFN manage inventory report`,
      current: 0,
      total: listingResult.listings.length,
    })
    const afnResult = await fetchAfnManageInventoryBySku({ marketplaceKey, progress })
    afnReportBySku = afnResult.inventoryBySku
    if (afnReportBySku.size === 0) {
      afnReportWarning =
        'AFN manage inventory report returned no rows; FBA API quantities are used where available.'
    }
  } catch (e) {
    afnReportFailed = true
    afnReportWarning = afnReportWarningMessage(e)
    console.warn('[amazon-zoho-stock] AFN report failed:', marketplaceKey, e?.message || e)
  }

  const invActive = await fetchAmazonInventoryForListings({
    marketplaceKey,
    marketplaceId,
    listings: listingResult.listings,
    progress,
    afnReportBySku,
    skipAfnReport: true,
    afnReportFailed,
  })

  const inventoryBySku = new Map(invActive.inventoryBySku)
  const fetchedTimes = [listingResult.fetchedAt, invActive.fetchedAt].map((t) => new Date(t).getTime())
  const warnings = []
  if (listingResult.suppressedWarning) warnings.push(listingResult.suppressedWarning)
  if (afnReportWarning) warnings.push(afnReportWarning)
  if (invActive.afnReportWarning) warnings.push(invActive.afnReportWarning)
  const meta = listingResult.filterMeta
  if (meta?.sellerFlexOnly && (meta.excludedFbm > 0 || meta.excludedSuppressed > 0)) {
    warnings.push(
      `Seller Flex scope: kept ${meta.sellerFlexCount} Amazon-fulfilled listings; excluded ${meta.excludedFbm} FBM/MFN and ${meta.excludedSuppressed} search-suppressed.`
    )
  }

  return {
    marketplaceKey,
    listings: listingResult.listings,
    inventoryBySku,
    inactiveWarning: warnings.length ? warnings.join(' ') : null,
    inactiveOosCount: 0,
    amazonFetchedAt: new Date(Math.max(...fetchedTimes)).toISOString(),
  }
}

function attachRowWarnings(rows, messages) {
  const list = messages.filter(Boolean)
  if (list.length === 0) return rows
  return rows.map((row) => ({
    ...row,
    warnings: [...(row.warnings || []), ...list],
  }))
}

async function refreshAmazonZohoStockComparison({ marketplace = 'all', progress, onMarketplaceComplete } = {}) {
  const mkRaw = String(marketplace || 'all').trim().toLowerCase()
  const marketplaceKeys = mkRaw === 'uae' || mkRaw === 'ksa' ? [mkRaw] : ['uae', 'ksa']
  const amazonWarnings = []
  const comparisonGeneratedAt = new Date().toISOString()
  let totalRows = 0
  const zohoMeta = { warehouses: [], matchRates: [] }

  for (const marketplaceKey of marketplaceKeys) {
    let amazonResult
    try {
      amazonResult = await refreshMarketplace({ marketplaceKey, progress })
    } catch (e) {
      const message = `Amazon ${marketplaceLabel(marketplaceKey)} refresh failed; existing cached rows for that marketplace were kept.`
      amazonWarnings.push(message)
      console.warn('[amazon-zoho-stock] Amazon refresh failed:', marketplaceKey, e?.message || e)
      if (marketplaceKeys.length === 1) throw e
      continue
    }

    let zohoWarning = null
    let zohoResult
    try {
      zohoResult = await fetchZohoStockForSkus({
        skus: amazonResult.listings.map((l) => l.sellerSku),
        progress,
      })
      zohoMeta.warehouses.push(zohoResult.warehouse)
      zohoMeta.matchRates.push({
        marketplaceKey,
        matched: zohoResult.matchStats?.matched || 0,
        requested: zohoResult.matchStats?.requested || amazonResult.listings.length,
        zohoItemsScanned: zohoResult.matchStats?.zohoItemsScanned || 0,
      })
      const requested = zohoResult.matchStats?.requested || 0
      const matched = zohoResult.matchStats?.matched || 0
      if (requested > 0 && matched / requested < 0.1) {
        zohoWarning = `Zoho matched only ${matched} of ${requested} Amazon SKUs for ${marketplaceLabel(marketplaceKey)}. Check ZOHO_LIFE_SMILE_WAREHOUSE_ID / warehouse name and SKU formats.`
      }
    } catch (e) {
      zohoWarning = 'Zoho stock refresh failed; Amazon listings were refreshed with Zoho status Unknown.'
      console.warn('[amazon-zoho-stock] Zoho refresh failed:', e?.message || e)
      zohoResult = {
        zohoBySku: new Map(),
        warehouse: { warehouseName: process.env.ZOHO_LIFE_SMILE_WAREHOUSE_NAME || 'Life Smile Warehouse' },
        fetchedAt: null,
        matchStats: { matched: 0, requested: amazonResult.listings.length, zohoItemsScanned: 0 },
      }
    }

    let rows = mergeRows({
      listings: amazonResult.listings,
      inventoryBySku: amazonResult.inventoryBySku,
      zohoBySku: zohoResult.zohoBySku,
      amazonFetchedAt: amazonResult.amazonFetchedAt,
      zohoFetchedAt: zohoResult.fetchedAt,
      comparisonGeneratedAt,
      zohoUnavailable: Boolean(zohoWarning),
      zohoWarehouseName: zohoResult.warehouse?.warehouseName,
    })
    rows = attachRowWarnings(rows, [zohoWarning, ...amazonWarnings, amazonResult.inactiveWarning])
    await store.replaceMarketplaceRows(amazonResult.marketplaceKey, rows)
    totalRows += rows.length

    if (typeof onMarketplaceComplete === 'function') {
      await onMarketplaceComplete({
        marketplaceKey: amazonResult.marketplaceKey,
        rowsInserted: rows.length,
        zohoMatchStats: zohoResult.matchStats,
      })
    }
  }

  if (totalRows === 0 && amazonWarnings.length >= marketplaceKeys.length) {
    const err = new Error('Amazon refresh failed for all marketplaces')
    err.code = 'AMAZON_ZOHO_STOCK_AMAZON_FAILED'
    throw err
  }

  return {
    totalRows,
    marketplaces: marketplaceKeys,
    comparisonGeneratedAt,
    zohoMeta,
  }
}

async function readCachedAmazonZohoStock(filters = {}, options = {}) {
  const result = await store.selectComparisonRows(filters)
  const meta = await store.getComparisonSummary(filters)
  const warnings = []
  const generated = await store.getLatestComparisonGeneratedAt(filters.marketplace || 'all')
  warnings.push(...(await store.getWarningMessages(filters)))
  if (!generated) warnings.push('No cached comparison data is available yet. Run refresh to generate it.')
  const ttlMinutes = Math.max(1, parseInt(String(process.env.AMAZON_ZOHO_STOCK_CACHE_TTL_MINUTES || '15'), 10) || 15)
  const refreshRunning = Boolean(options.refreshRunning)
  if (
    !refreshRunning &&
    generated &&
    Date.now() - new Date(generated).getTime() > ttlMinutes * 60_000
  ) {
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
    'Seller Flex On-Hand',
    'Seller Flex Fulfillable',
    'Zoho Available For Sale',
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
        row.amazon?.totalQty ?? row.amazon?.availableQty,
        row.amazon?.availableQty,
        row.zoho?.availableQty,
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
