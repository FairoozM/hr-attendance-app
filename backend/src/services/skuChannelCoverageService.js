const { fetchAllItemsRaw, readZohoConfig } = require('../integrations/zoho/zohoAdapter')
const { normalizeZohoInventoryItem } = require('../integrations/zoho/zohoItemFamily')
const { stockOnHandField } = require('../controllers/debugZohoController')
const { fetchActiveAmazonListings } = require('./amazonListingsInventoryReadService')
const { getEligibleCatalogItems } = require('./noon/noonProductService')
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
  if (status && ['inactive', 'deleted'].includes(status)) return false
  if (raw.is_active === false || raw.is_item_active === false) return false
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

async function fetchAmazonListingsForMarketplace(marketplaceKey) {
  const result = await fetchActiveAmazonListings({ marketplaceKey })
  return {
    marketplaceKey,
    listings: result.listings || [],
    fetchedAt: result.fetchedAt || new Date().toISOString(),
    warning: result.suppressedWarning || null,
  }
}

async function fetchNoonCatalogItems() {
  try {
    const live = await getEligibleCatalogItems()
    if (live?.items?.length) {
      return {
        items: live.items,
        source: 'live',
        fetchedAt: new Date().toISOString(),
        warning: null,
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

async function buildCoverageSnapshot({ forceRefresh = false } = {}) {
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

    const [zohoRaw, amazonUaeResult, amazonKsaResult, noonResult] = await Promise.all([
      fetchAllItemsRaw(),
      fetchAmazonListingsForMarketplace('uae'),
      fetchAmazonListingsForMarketplace('ksa'),
      fetchNoonCatalogItems(),
    ])

    if (amazonUaeResult.warning) warnings.push(amazonUaeResult.warning)
    if (amazonKsaResult.warning) warnings.push(amazonKsaResult.warning)
    if (noonResult.warning) warnings.push(noonResult.warning)

    const zohoItems = mapActiveZohoItems(zohoRaw)
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
        amazonUaeListingCount: amazonUaeResult.listings.length,
        amazonKsaListingCount: amazonKsaResult.listings.length,
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

async function exportSkuChannelCoverageXlsx(options = {}) {
  const forceRefresh = options.refresh === true || String(options.refresh || '') === '1'
  const snapshot = await buildCoverageSnapshot({ forceRefresh })
  const buffer = await buildSkuChannelCoverageXlsxBuffer({
    rows: snapshot.rows,
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
