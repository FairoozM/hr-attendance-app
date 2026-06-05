const { fetchAllItemsRaw, readZohoConfig } = require('../integrations/zoho/zohoAdapter')
const { normalizeZohoInventoryItem } = require('../integrations/zoho/zohoItemFamily')
const { stockOnHandField } = require('../controllers/debugZohoController')
const { fetchActiveAmazonListings } = require('./amazonListingsInventoryReadService')
const amazonZohoStockStore = require('./amazonZohoStockComparisonStore')
const { fetchAllEligibleCatalogItems } = require('./noon/noonProductService')
const { getNoonProductSnapshotsForAudit } = require('./noon/noonSnapshotStore')
const {
  buildChannelIndex,
  buildCoverageRows,
  computeSummaryCards,
  filterCoverageRows,
  mapAmazonListingsToIndexEntries,
  mapNoonItemsToIndexEntries,
} = require('./skuChannelCoverageMatching')
const { buildSkuChannelCoverageXlsxBuffer } = require('./skuChannelCoverageXlsxService')

const DEFAULT_CACHE_TTL_MS =
  process.env.SKU_COVERAGE_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.SKU_COVERAGE_CACHE_TTL_MS, 10) || 0)
    : 15 * 60 * 1000

/** @type {{ rows: object[], summary: object, meta: object, expiresAt: number } | null} */
let _cache = null
/** @type {Promise<object> | null} */
let _fetchInFlight = null

function isZohoItemActive(raw) {
  if (!raw || typeof raw !== 'object') return false
  const status = String(raw.status || raw.item_status || '').trim().toLowerCase()
  if (status === 'inactive' || status === 'deleted') return false
  return true
}

/**
 * @param {object[]} rawItems
 * @returns {object[]}
 */
function mapActiveZohoItems(rawItems) {
  const cfg = readZohoConfig()
  const familyFieldId = cfg.code === 'ok' ? cfg.familyCustomFieldId : null
  return (rawItems || [])
    .filter(isZohoItemActive)
    .map((raw) => {
      const normalized = normalizeZohoInventoryItem(raw, familyFieldId)
      return {
        zohoItemId: normalized.item_id,
        zohoItemName: normalized.name,
        zohoSku: normalized.sku,
        zohoStockQty: stockOnHandField(raw),
        isActive: true,
        sku: normalized.sku,
        name: normalized.name,
      }
    })
}

function mapCachedAmazonRows(rows) {
  return (rows || []).map((row) => ({
    sellerSku: row.sellerSku,
    listingStatus: row.listingStatus || 'ACTIVE',
    asin: row.asin || '',
  }))
}

async function fetchAmazonListingsFromCache(marketplaceKey) {
  const mk = String(marketplaceKey || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
  const rows = await amazonZohoStockStore.selectAllComparisonRows({
    marketplace: mk,
    stockFilter: 'all',
  })
  const fetchedAt = await amazonZohoStockStore.getLatestComparisonGeneratedAt(mk)
  return {
    marketplaceKey: mk,
    listings: mapCachedAmazonRows(rows),
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    source: 'cache',
    warning:
      rows.length === 0
        ? `No cached Amazon ${mk.toUpperCase()} listings yet. Run Amazon + Zoho Stock refresh, then reload this page.`
        : null,
  }
}

async function fetchAmazonListingsLive(marketplaceKey) {
  const result = await fetchActiveAmazonListings({ marketplaceKey })
  const warnings = []
  if (result.suppressedWarning) warnings.push(result.suppressedWarning)
  return {
    marketplaceKey,
    listings: result.listings || [],
    fetchedAt: result.fetchedAt || new Date().toISOString(),
    source: 'live',
    warning: warnings.length ? warnings.join(' ') : null,
  }
}

async function fetchAmazonListingsForMarketplace(marketplaceKey, { forceLive = false } = {}) {
  if (!forceLive) {
    const cached = await fetchAmazonListingsFromCache(marketplaceKey)
    if (cached.listings.length > 0) return cached
  }
  try {
    return await fetchAmazonListingsLive(marketplaceKey)
  } catch (err) {
    console.warn(
      `[sku-coverage] Amazon ${marketplaceKey} live fetch failed:`,
      err?.message || err
    )
    const cached = await fetchAmazonListingsFromCache(marketplaceKey)
    const liveMsg = err?.message ? ` ${err.message}` : ''
    cached.warning = cached.warning
      ? `${cached.warning} Live Amazon fetch also failed.${liveMsg}`
      : `Amazon ${String(marketplaceKey).toUpperCase()} live fetch failed; using cache if available.${liveMsg}`
    return cached
  }
}

async function fetchZohoActiveItems() {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    const err = new Error('Zoho is not configured for this server.')
    err.code = 'ZOHO_NOT_CONFIGURED'
    throw err
  }
  const raw = await fetchAllItemsRaw()
  const arr = Array.isArray(raw) ? raw : []
  const items = mapActiveZohoItems(arr)
  if (items.length === 0 && arr.length > 0) {
    console.warn(
      `[sku-coverage] Zoho returned ${arr.length} items but none passed active filter`
    )
  }
  return {
    items,
    rawCount: arr.length,
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchNoonCatalogItems() {
  try {
    const live = await fetchAllEligibleCatalogItems()
    if (live?.items?.length) {
      return {
        items: live.items,
        source: 'live',
        fetchedAt: new Date().toISOString(),
        warning: null,
        pageCount: live.pageCount,
        totalCount: live.totalCount,
      }
    }
  } catch (err) {
    console.warn('[sku-coverage] Noon live catalog failed, falling back to snapshots:', err?.message || err)
  }

  const snapshots = await getNoonProductSnapshotsForAudit('ae')
  const activeSnapshots = snapshots.filter((row) => row.is_active !== false)
  return {
    items: activeSnapshots.map((row) => ({
      partnerSku: row.partner_sku,
      psku: row.psku,
      sku: row.noon_sku,
      isActive: row.is_active,
      status: row.is_active === false ? 'INACTIVE' : 'ACTIVE',
      pricingStatusCode: row.pricing_status_code,
      stockQuantity: row.stock_quantity,
    })),
    source: 'snapshot',
    fetchedAt: activeSnapshots[0]?.last_synced_at || new Date().toISOString(),
    warning: 'Noon live API unavailable — using cached snapshots (AE).',
  }
}

async function buildCoverageSnapshot({ forceRefresh = false, forceLiveAmazon = false } = {}) {
  if (!forceRefresh && _cache && Date.now() < _cache.expiresAt) {
    return _cache
  }

  if (_fetchInFlight && !forceRefresh) {
    const payload = await _fetchInFlight
    return payload
  }

  _fetchInFlight = (async () => {
    const warnings = []
    const fetchedAt = new Date().toISOString()
    const zohoResult = await fetchZohoActiveItems()
    const [amazonUaeResult, amazonKsaResult, noonResult] = await Promise.all([
      fetchAmazonListingsForMarketplace('uae', { forceLive: forceLiveAmazon }),
      fetchAmazonListingsForMarketplace('ksa', { forceLive: forceLiveAmazon }),
      fetchNoonCatalogItems(),
    ])

    if (zohoResult.rawCount > 0 && zohoResult.items.length === 0) {
      warnings.push(
        `Zoho returned ${zohoResult.rawCount} items but none were treated as active. Check Zoho item status fields.`
      )
    }
    if (amazonUaeResult.warning) warnings.push(amazonUaeResult.warning)
    if (amazonKsaResult.warning) warnings.push(amazonKsaResult.warning)
    if (noonResult.warning) warnings.push(noonResult.warning)

    const zohoItems = zohoResult.items
    const indexes = {
      amazonUae: buildChannelIndex(mapAmazonListingsToIndexEntries(amazonUaeResult.listings)),
      amazonKsa: buildChannelIndex(mapAmazonListingsToIndexEntries(amazonKsaResult.listings)),
      noon: buildChannelIndex(mapNoonItemsToIndexEntries(noonResult.items)),
    }

    const rows = buildCoverageRows(zohoItems, indexes)
    const summary = computeSummaryCards(rows)

    const payload = {
      rows,
      summary,
      meta: {
        generatedAt: fetchedAt,
        zohoItemCount: zohoItems.length,
        zohoRawCount: zohoResult.rawCount,
        zohoFetchedAt: zohoResult.fetchedAt,
        amazonUaeListingCount: amazonUaeResult.listings.length,
        amazonKsaListingCount: amazonKsaResult.listings.length,
        amazonUaeSource: amazonUaeResult.source,
        amazonKsaSource: amazonKsaResult.source,
        amazonUaeFetchedAt: amazonUaeResult.fetchedAt,
        amazonKsaFetchedAt: amazonKsaResult.fetchedAt,
        noonItemCount: noonResult.items.length,
        noonSource: noonResult.source,
        warnings,
        cacheExpiresAt:
          DEFAULT_CACHE_TTL_MS > 0 ? new Date(Date.now() + DEFAULT_CACHE_TTL_MS).toISOString() : null,
      },
      expiresAt: DEFAULT_CACHE_TTL_MS > 0 ? Date.now() + DEFAULT_CACHE_TTL_MS : Date.now(),
    }

    if (DEFAULT_CACHE_TTL_MS > 0) {
      _cache = payload
    }

    return payload
  })().finally(() => {
    _fetchInFlight = null
  })

  return _fetchInFlight
}

function clearSkuChannelCoverageCache() {
  _cache = null
}

/**
 * @param {{ filter?: string, search?: string, refresh?: boolean }} options
 */
async function getSkuChannelCoverageSummary(options = {}) {
  const forceRefresh = options.refresh === true || String(options.refresh || '') === '1'
  const snapshot = await buildCoverageSnapshot({ forceRefresh })
  const filteredRows = filterCoverageRows(snapshot.rows, {
    filter: options.filter,
    search: options.search,
  })

  return {
    success: true,
    summary: snapshot.summary,
    rows: filteredRows,
    meta: {
      ...snapshot.meta,
      filteredCount: filteredRows.length,
      totalCount: snapshot.rows.length,
      fromCache: !forceRefresh && _cache && Date.now() <= _cache.expiresAt,
    },
  }
}

const { attachVigilToCoverageRows } = require('./skuChannelCoverageMatching')

async function exportSkuChannelCoverageXlsx(options = {}, { vigilRows = [] } = {}) {
  const forceRefresh = options.refresh === true || String(options.refresh || '') === '1'
  const snapshot = await buildCoverageSnapshot({ forceRefresh })
  const rows = attachVigilToCoverageRows(snapshot.rows, vigilRows)
  const buffer = await buildSkuChannelCoverageXlsxBuffer({
    rows,
    summary: snapshot.summary,
    meta: snapshot.meta,
  })
  const stamp = new Date().toISOString().slice(0, 10)
  return {
    buffer,
    filename: `sku-channel-coverage-${stamp}.xlsx`,
    rowCount: snapshot.rows.length,
  }
}

module.exports = {
  getSkuChannelCoverageSummary,
  exportSkuChannelCoverageXlsx,
  clearSkuChannelCoverageCache,
  buildCoverageSnapshot,
}
