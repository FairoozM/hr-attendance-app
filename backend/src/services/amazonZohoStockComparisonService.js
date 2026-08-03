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
  fetchAllLifeSmileWarehouseStock,
  matchZohoStockFromWarehouseDump,
  buildZohoStockEntry,
  zohoItemLookupKeys,
  indexZohoWarehouseItems,
  lookupZohoEntry,
  buildAmazonSkuSet,
  normalizeSku,
} = require('./zohoLifeSmileWarehouseService')
const {
  buildAmbiguityAwareVigilIndexes,
  itemNameMatchSources,
  matchSkuToVigilWithAmbiguity,
} = require('../utils/purchasePlanningSkuMatcher')
const { ensureNoonCatalogCache } = require('./noon/noonSnapshotSyncService')
const { getNoonProductSnapshotsForAudit } = require('./noon/noonSnapshotStore')
const { syncStaleNoonStock } = require('./noon/noonStockService')
const { resolveNoonMatchKeys } = require('./skuChannelCoverageMatching')

const ZOHO_ONLY_LISTING_STATUS = 'ZOHO_ONLY'
const NOON_ONLY_LISTING_STATUS = 'NOON_ONLY'
const CREATE_LISTING_ACTION = 'Create listing on Amazon'

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function isZohoItemActive(raw) {
  if (!raw || typeof raw !== 'object') return false
  const status = String(raw.status || raw.item_status || '').trim().toLowerCase()
  if (status === 'inactive' || status === 'deleted') return false
  return true
}

function noonCountryCode() {
  return 'ae'
}

function noonWarehouseCode(countryCode) {
  const countrySpecific = process.env[`NOON_WAREHOUSE_CODE_${String(countryCode).toUpperCase()}`]
  return String(countrySpecific || process.env.NOON_WAREHOUSE_CODE || '').trim()
}

function isActiveNoonSnapshot(snapshot) {
  return snapshot?.is_active === true || snapshot?.isActive === true
}

function noonPayload(snapshot, countryCode) {
  if (!snapshot) {
    return {
      partnerSku: '',
      sku: '',
      title: '',
      countryCode,
      isActive: null,
      listingStatus: 'Not Found',
      stockQty: null,
      stockSyncedAt: null,
      catalogSyncedAt: null,
    }
  }
  return {
    partnerSku: snapshot.partner_sku || snapshot.partnerSku || '',
    sku: snapshot.noon_sku || snapshot.sku || '',
    title: snapshot.title || '',
    countryCode,
    isActive: isActiveNoonSnapshot(snapshot),
    listingStatus:
      snapshot.is_active === false
        ? 'INACTIVE'
        : snapshot.pricing_status_code || snapshot.pricingStatusCode || 'ACTIVE',
    stockQty:
      snapshot.stock_quantity == null && snapshot.stockQuantity == null
        ? null
        : toNumber(snapshot.stock_quantity ?? snapshot.stockQuantity),
    stockSyncedAt: snapshot.stock_synced_at || snapshot.stockSyncedAt || null,
    catalogSyncedAt: snapshot.last_synced_at || snapshot.lastSyncedAt || null,
  }
}

function buildNoonSnapshotIndex(snapshots) {
  const index = new Map()
  const ambiguous = new Set()
  for (const snapshot of snapshots || []) {
    if (!isActiveNoonSnapshot(snapshot)) continue
    for (const candidate of resolveNoonMatchKeys(snapshot)) {
      const previous = index.get(candidate.key)
      if (previous && previous !== snapshot) {
        ambiguous.add(candidate.key)
        continue
      }
      index.set(candidate.key, snapshot)
    }
  }
  for (const key of ambiguous) index.delete(key)
  return index
}

function rowNoonLookupKeys(row) {
  const keys = buildAmazonSkuSet([row?.sellerSku, row?.normalizedSku])
  for (const key of zohoItemLookupKeys(row?.zoho || {}, row?.zoho || {})) keys.add(key)
  return keys
}

function attachNoonToRows(rows, snapshots, countryCode) {
  const index = buildNoonSnapshotIndex(snapshots)
  const matchedPartnerSkus = new Set()
  const nextRows = (rows || []).map((row) => {
    let match = null
    for (const key of rowNoonLookupKeys(row)) {
      match = index.get(key)
      if (match) break
    }
    if (match) matchedPartnerSkus.add(String(match.partner_sku || match.partnerSku || ''))
    return { ...row, noon: noonPayload(match, countryCode) }
  })
  return { rows: nextRows, matchedPartnerSkus }
}

function appendNoonOnlyRows({
  rows,
  snapshots,
  countryCode,
  marketplaceKey,
  marketplaceId,
  warehouseStock,
  amazonFetchedAt,
  zohoFetchedAt,
  comparisonGeneratedAt,
}) {
  const result = rows.slice()
  const usedNoonSkus = new Set(
    rows.map((row) => String(row.noon?.partnerSku || '')).filter(Boolean)
  )
  const usedKeys = new Set(rows.map((row) => row.normalizedSku).filter(Boolean))
  const zohoIndex = warehouseStock
    ? indexZohoWarehouseItems(
        warehouseStock.rawItems,
        warehouseStock.warehouse?.warehouseName,
        warehouseStock.warehouse?.warehouseId
      )
    : new Map()

  for (const snapshot of snapshots || []) {
    if (!isActiveNoonSnapshot(snapshot)) continue
    const partnerSku = String(snapshot.partner_sku || snapshot.partnerSku || '').trim()
    if (!partnerSku || usedNoonSkus.has(partnerSku)) continue
    const matchKeys = resolveNoonMatchKeys(snapshot)
    const normalizedSku = matchKeys[0]?.key || normalizeSku(partnerSku)
    if (!normalizedSku || usedKeys.has(normalizedSku)) continue

    let zoho = null
    for (const match of matchKeys) {
      zoho = lookupZohoEntry(zohoIndex, match.key)
      if (zoho) break
    }
    const zohoAvailable = toNumber(zoho?.availableQty)
    result.push({
      marketplaceKey,
      marketplace: marketplaceLabel(marketplaceKey),
      marketplaceId,
      sellerSku: matchKeys[0]?.rawSku || partnerSku,
      normalizedSku,
      asin: '',
      title: snapshot.title || partnerSku,
      image: snapshot.image_url || '',
      listingStatus: NOON_ONLY_LISTING_STATUS,
      fulfillmentChannel: '',
      price: {
        amount: snapshot.price == null ? null : toNumber(snapshot.price),
        currencyCode: marketplaceKey === 'ksa' ? 'SAR' : 'AED',
      },
      amazon: { availableQty: 0, totalQty: 0, stockStatus: 'Not Found' },
      zoho: zoho || {
        itemId: '',
        sku: '',
        normalizedSku,
        itemName: '',
        itemType: '',
        warehouseName: warehouseStock?.warehouse?.warehouseName || '',
        availableQty: 0,
        stockStatus: warehouseStock ? 'Not Found' : 'Unknown',
      },
      noon: noonPayload(snapshot, countryCode),
      comparison: {
        difference: zohoAvailable,
        isMismatch: false,
        recommendedAction: CREATE_LISTING_ACTION,
      },
      timestamps: {
        amazonLastFetchedAt: amazonFetchedAt,
        zohoLastFetchedAt: zohoFetchedAt,
        comparisonGeneratedAt,
      },
    })
    usedKeys.add(normalizedSku)
    usedNoonSkus.add(partnerSku)
  }
  return result
}

function deriveRecommendedAction({ amazonAvailable, zohoAvailable, zohoStatus, difference, threshold, amazonStatus }) {
  if (amazonStatus === 'Not Found') return CREATE_LISTING_ACTION
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
    const zohoAvailable = toNumber(zoho.availableQty)
    const difference = zohoAvailable - amazonOnHand
    const recommendedAction = deriveRecommendedAction({
      amazonAvailable: amazonOnHand,
      zohoAvailable,
      zohoStatus: zoho.stockStatus,
      difference,
      threshold,
      amazonStatus: amazon.stockStatus,
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

function matchVigilStockForComparisonItems({ vigilRows, items }) {
  const indexes = buildAmbiguityAwareVigilIndexes(vigilRows)
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const rowKey = String(item?.rowKey || index)
    const amazonSku = String(item?.sellerSku || '').trim()
    const zohoSku = String(item?.zohoSku || '').trim()
    const zohoItemName = String(item?.zohoItemName || '').trim()

    let match = matchSkuToVigilWithAmbiguity(indexes, amazonSku)
    if (!match.matched && !match.ambiguous && zohoSku) {
      match = matchSkuToVigilWithAmbiguity(indexes, zohoSku)
    }
    if (!match.matched && !match.ambiguous && zohoItemName) {
      for (const source of itemNameMatchSources(zohoItemName)) {
        match = matchSkuToVigilWithAmbiguity(indexes, source)
        if (match.matched || match.ambiguous) break
      }
    }

    return {
      rowKey,
      vigilStockQty: match.matched ? toNumber(match.wholesaleAvailableQty) : null,
      matchType: match.matchType,
      ambiguous: Boolean(match.ambiguous),
    }
  })
}

/**
 * Zoho Life Smile warehouse items with no matching Amazon Seller Flex listing for this marketplace.
 * Stored as listing_status = ZOHO_ONLY so existing ACTIVE+AMAZON filters stay unchanged.
 */
function buildAmazonNotFoundRows({
  rawItems,
  warehouse,
  zohoBySku,
  amazonListings,
  marketplaceKey,
  marketplaceId,
  amazonFetchedAt,
  zohoFetchedAt,
  comparisonGeneratedAt,
}) {
  const warehouseName = warehouse?.warehouseName || ''
  const warehouseId = warehouse?.warehouseId || ''
  const matchedItemIds = new Set()
  for (const entry of zohoBySku?.values?.() || []) {
    if (entry?.itemId) matchedItemIds.add(String(entry.itemId))
  }

  const usedNormalizedSkus = new Set()
  const amazonKeySet = buildAmazonSkuSet(
    (amazonListings || []).map((l) => l.sellerSku || l.normalizedSku).filter(Boolean)
  )
  for (const listing of amazonListings || []) {
    const key = listing.normalizedSku || normalizeSku(listing.sellerSku)
    if (key) usedNormalizedSkus.add(key)
  }

  const rows = []
  const seenItemIds = new Set()
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    if (!isZohoItemActive(item)) continue
    const entry = buildZohoStockEntry(item, warehouseName, warehouseId)
    if (!entry) continue
    const itemId = entry.itemId || entry.normalizedSku
    if (!itemId || seenItemIds.has(itemId)) continue
    seenItemIds.add(itemId)

    if (entry.itemId && matchedItemIds.has(String(entry.itemId))) continue

    let onAmazon = false
    for (const key of zohoItemLookupKeys(item, entry)) {
      if (amazonKeySet.has(key)) {
        onAmazon = true
        break
      }
    }
    if (onAmazon) continue

    const normalizedSku = entry.normalizedSku
    if (!normalizedSku || usedNormalizedSkus.has(normalizedSku)) continue
    usedNormalizedSkus.add(normalizedSku)

    const zohoAvailable = toNumber(entry.availableQty)
    rows.push({
      marketplaceKey,
      marketplace: marketplaceLabel(marketplaceKey),
      marketplaceId: marketplaceId || '',
      sellerSku: entry.sku,
      normalizedSku,
      asin: '',
      title: entry.itemName || entry.sku,
      image: '',
      listingStatus: ZOHO_ONLY_LISTING_STATUS,
      fulfillmentChannel: '',
      price: { amount: null, currencyCode: '' },
      amazon: {
        availableQty: 0,
        totalQty: 0,
        stockStatus: 'Not Found',
      },
      zoho: {
        itemId: entry.itemId,
        sku: entry.sku,
        normalizedSku: entry.normalizedSku,
        itemName: entry.itemName,
        itemType: entry.itemType,
        warehouseName: entry.warehouseName,
        availableQty: entry.availableQty,
        stockStatus: entry.stockStatus,
      },
      comparison: {
        difference: zohoAvailable,
        isMismatch: false,
        recommendedAction: CREATE_LISTING_ACTION,
      },
      timestamps: {
        amazonLastFetchedAt: amazonFetchedAt,
        zohoLastFetchedAt: zohoFetchedAt,
        comparisonGeneratedAt,
      },
    })
  }
  return rows
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
    marketplaceId,
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
  void marketplace
  const marketplaceKeys = ['uae']
  const amazonWarnings = []
  const comparisonGeneratedAt = new Date().toISOString()
  let totalRows = 0
  const zohoMeta = { warehouses: [], matchRates: [] }

  let warehouseStock = null
  let zohoFetchWarning = null
  try {
    progress?.({ step: 'Fetching Zoho Life Smile warehouse stock', current: 0, total: 0 })
    warehouseStock = await fetchAllLifeSmileWarehouseStock()
  } catch (e) {
    zohoFetchWarning = 'Zoho stock refresh failed; Amazon listings were refreshed with Zoho status Unknown.'
    console.warn('[amazon-zoho-stock] Zoho warehouse fetch failed:', e?.message || e)
  }

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

    let zohoWarning = zohoFetchWarning
    let zohoResult
    if (warehouseStock) {
      zohoResult = matchZohoStockFromWarehouseDump({
        warehouseStock,
        skus: amazonResult.listings.map((l) => l.sellerSku),
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
    } else {
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

    if (warehouseStock && !zohoFetchWarning) {
      const amazonNotFoundRows = buildAmazonNotFoundRows({
        rawItems: warehouseStock.rawItems,
        warehouse: warehouseStock.warehouse,
        zohoBySku: zohoResult.zohoBySku,
        amazonListings: amazonResult.listings,
        marketplaceKey: amazonResult.marketplaceKey,
        marketplaceId: amazonResult.marketplaceId,
        amazonFetchedAt: amazonResult.amazonFetchedAt,
        zohoFetchedAt: zohoResult.fetchedAt,
        comparisonGeneratedAt,
      })
      rows = rows.concat(amazonNotFoundRows)
    }

    const countryCode = noonCountryCode(marketplaceKey)
    const noonWarnings = []
    try {
      progress?.({ step: `Refreshing Noon ${countryCode.toUpperCase()} catalog cache`, current: 0, total: 0 })
      const catalogSync = await ensureNoonCatalogCache({ countryCode })
      if (catalogSync?.inProgress) {
        noonWarnings.push(`Noon ${countryCode.toUpperCase()} catalog refresh is already running; cached rows were used.`)
      }
      if (Array.isArray(catalogSync?.errors) && catalogSync.errors.length > 0) {
        noonWarnings.push(`Noon ${countryCode.toUpperCase()} catalog refresh completed with errors; cached data may be partial.`)
      }
    } catch (e) {
      noonWarnings.push(`Noon ${countryCode.toUpperCase()} catalog refresh failed; existing Noon cache was used.`)
      console.warn('[amazon-zoho-stock] Noon catalog refresh failed:', countryCode, e?.message || e)
    }

    let noonSnapshots = []
    try {
      noonSnapshots = await getNoonProductSnapshotsForAudit(countryCode)
      const preliminary = attachNoonToRows(rows, noonSnapshots, countryCode)
      progress?.({
        step: `Refreshing stale Noon ${countryCode.toUpperCase()} stock`,
        current: 0,
        total: preliminary.matchedPartnerSkus.size,
      })
      const stockSync = await syncStaleNoonStock({
        countryCode,
        warehouse: noonWarehouseCode(countryCode),
        prioritySkus: [...preliminary.matchedPartnerSkus],
        onProgress: ({ current, total }) =>
          progress?.({
            step: `Refreshing stale Noon ${countryCode.toUpperCase()} stock`,
            current,
            total,
          }),
      })
      if (!stockSync.ok && stockSync.errors?.length) {
        noonWarnings.push(`Some Noon ${countryCode.toUpperCase()} stock quantities could not be refreshed.`)
      }
      if (stockSync.updated > 0) noonSnapshots = await getNoonProductSnapshotsForAudit(countryCode)
    } catch (e) {
      noonWarnings.push(`Noon ${countryCode.toUpperCase()} stock refresh failed; cached stock was used.`)
      console.warn('[amazon-zoho-stock] Noon stock refresh failed:', countryCode, e?.message || e)
    }

    const withNoon = attachNoonToRows(rows, noonSnapshots, countryCode)
    rows = appendNoonOnlyRows({
      rows: withNoon.rows,
      snapshots: noonSnapshots,
      countryCode,
      marketplaceKey,
      marketplaceId: amazonResult.marketplaceId,
      warehouseStock,
      amazonFetchedAt: amazonResult.amazonFetchedAt,
      zohoFetchedAt: zohoResult.fetchedAt,
      comparisonGeneratedAt,
    })

    rows = attachRowWarnings(rows, [
      zohoWarning,
      ...noonWarnings,
      ...amazonWarnings,
      amazonResult.inactiveWarning,
    ])
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

async function refreshStaleNoonStockForComparison({ marketplace = 'all', progress } = {}) {
  void marketplace
  const marketplaceKeys = ['uae']
  let totalRows = 0
  let totalStockUpdated = 0

  for (const marketplaceKey of marketplaceKeys) {
    const countryCode = noonCountryCode(marketplaceKey)
    const cachedRows = await store.selectMarketplaceRowsUnscoped(marketplaceKey)
    let snapshots = await getNoonProductSnapshotsForAudit(countryCode)
    const preliminary = attachNoonToRows(cachedRows, snapshots, countryCode)
    const stockResult = await syncStaleNoonStock({
      countryCode,
      warehouse: noonWarehouseCode(countryCode),
      prioritySkus: [...preliminary.matchedPartnerSkus],
      onProgress: ({ current, total }) =>
        progress?.({
          step: `Refreshing stale Noon ${countryCode.toUpperCase()} stock`,
          current,
          total,
        }),
    })
    totalStockUpdated += stockResult.updated || 0
    if (stockResult.updated > 0) snapshots = await getNoonProductSnapshotsForAudit(countryCode)
    const refreshed = attachNoonToRows(cachedRows, snapshots, countryCode)
    await store.updateMarketplaceNoonRows(marketplaceKey, refreshed.rows)
    totalRows += refreshed.rows.length
  }

  return { totalRows, totalStockUpdated, marketplaces: marketplaceKeys }
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
    'Vigil Stock Qty',
    'Noon Partner SKU',
    'Noon SKU',
    'Noon Live',
    'Noon Status',
    'Noon Stock Qty',
    'Noon Catalog Synced At',
    'Noon Stock Synced At',
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
        row.vigilStockQty,
        row.noon?.partnerSku,
        row.noon?.sku,
        row.noon?.isActive,
        row.noon?.listingStatus,
        row.noon?.stockQty,
        row.noon?.catalogSyncedAt,
        row.noon?.stockSyncedAt,
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

async function exportAmazonZohoStockCsv(filters = {}, vigilRows = []) {
  const rows = await store.selectAllComparisonRows(filters)
  if (!Array.isArray(vigilRows) || vigilRows.length === 0) return rowsToCsv(rows)

  const matches = matchVigilStockForComparisonItems({
    vigilRows,
    items: rows.map((row, index) => ({
      rowKey: String(index),
      sellerSku: row.sellerSku || '',
      zohoSku: row.zoho?.sku || '',
      zohoItemName: row.zoho?.itemName || '',
    })),
  })
  return rowsToCsv(
    rows.map((row, index) => ({
      ...row,
      vigilStockQty: matches[index]?.vigilStockQty ?? null,
    }))
  )
}

module.exports = {
  refreshAmazonZohoStockComparison,
  refreshStaleNoonStockForComparison,
  readCachedAmazonZohoStock,
  exportAmazonZohoStockCsv,
  matchVigilStockForComparisonItems,
  ZOHO_ONLY_LISTING_STATUS,
  NOON_ONLY_LISTING_STATUS,
  CREATE_LISTING_ACTION,
  _internals: {
    normalizeSku,
    mergeRows,
    matchVigilStockForComparisonItems,
    deriveRecommendedAction,
    buildAmazonNotFoundRows,
    appendNoonOnlyRows,
    attachNoonToRows,
    buildNoonSnapshotIndex,
    noonCountryCode,
    isZohoItemActive,
    rowsToCsv,
  },
}
