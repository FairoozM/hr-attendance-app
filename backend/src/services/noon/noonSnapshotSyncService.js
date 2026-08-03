const { noonPost } = require('./noonClient')
const {
  fetchAllEligibleCatalogItems,
  getEligibleCatalogItems,
  normalizePricingCountryCode,
} = require('./noonProductService')
const {
  claimNoonSync,
  completeNoonSync,
  getNoonSyncState,
  listNoonProductSnapshots,
  markMissingNoonSnapshotsInactive,
  upsertNoonProductSnapshot,
} = require('./noonSnapshotStore')

const PRICING_GET_PATH = '/pricing/v1/pricing/get'
const fullSyncInFlight = new Map()
let catalogFetchInFlight = null
let recentCatalog = null

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function catalogCacheTtlHours() {
  return boundedNumber(process.env.NOON_CATALOG_CACHE_TTL_HOURS, 6, 1, 168)
}

function apiPacingMs() {
  return boundedNumber(process.env.NOON_API_PACING_MS, 250, 0, 5000)
}

function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(String(limit || '100'), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 100
  return Math.min(parsed, 100)
}

function pricingStatusCode(pricingItem) {
  const status = pricingItem && pricingItem.status
  if (status && typeof status === 'object' && typeof status.status_code === 'string') {
    return status.status_code
  }
  return ''
}

function makePricingMap(pricingItems) {
  const map = new Map()
  for (const item of pricingItems) {
    if (!item || typeof item !== 'object') continue
    const partnerSku = typeof item.partner_sku === 'string' ? item.partner_sku.trim() : ''
    if (partnerSku) map.set(partnerSku, item)
  }
  return map
}

async function fetchPricingForPartnerSkus(partnerSkus, countryCode) {
  const requestedCountryCode = normalizePricingCountryCode(countryCode)
  const uniqueSkus = Array.from(new Set(partnerSkus.map((sku) => String(sku || '').trim()).filter(Boolean)))
  const chunks = chunkArray(uniqueSkus, 50)
  const pricingItems = []
  const errors = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const body = {
      items: chunk.map((partnerSku) => ({
        partner_sku: partnerSku,
        country_code: requestedCountryCode,
      })),
    }

    try {
      const response = await noonPost(PRICING_GET_PATH, body)
      const rawItems = response.data && Array.isArray(response.data.items) ? response.data.items : []
      pricingItems.push(...rawItems)
    } catch (error) {
      errors.push({
        code: error && error.code ? error.code : 'NOON_PRICING_SYNC_ERROR',
        message: error && error.message ? error.message : 'Pricing request failed.',
        status: error && error.httpStatus ? error.httpStatus : null,
        path: error && error.meta ? error.meta.path : PRICING_GET_PATH,
      })
    }
    if (index < chunks.length - 1) await sleep(apiPacingMs())
  }

  return {
    requested: uniqueSkus.length,
    returned: pricingItems.length,
    items: pricingItems,
    errors,
  }
}

async function persistCatalogPricing(catalogItems, countryCode) {
  const partnerSkus = catalogItems.map((item) => item && item.partnerSku).filter(Boolean)
  const pricing = await fetchPricingForPartnerSkus(partnerSkus, countryCode)
  const pricingMap = makePricingMap(pricing.items)
  const errors = [...pricing.errors]
  let upserted = 0

  for (const catalogItem of catalogItems) {
    const partnerSku = catalogItem && catalogItem.partnerSku ? catalogItem.partnerSku : ''
    if (!partnerSku) {
      errors.push({
        code: 'NOON_CATALOG_ITEM_MISSING_PARTNER_SKU',
        message: 'Catalog item skipped because partner_sku was missing.',
      })
      continue
    }

    const pricingItem = pricingMap.get(partnerSku) || null
    try {
      await upsertNoonProductSnapshot({
        partnerSku,
        noonSku: catalogItem.sku,
        psku: catalogItem.psku,
        title: catalogItem.title,
        imageUrl: catalogItem.imageUrl,
        barcode: catalogItem.barcode,
        pbarcode: catalogItem.pbarcode,
        storageType: catalogItem.storageType,
        countryCode,
        price: pricingItem ? pricingItem.price : null,
        msrp: pricingItem ? pricingItem.msrp : null,
        isActive: pricingItem ? pricingItem.is_active : null,
        pricingStatusCode: pricingStatusCode(pricingItem),
        rawCatalogJson: catalogItem.raw || {},
        rawPricingJson: pricingItem || {},
      })
      upserted += 1
    } catch (error) {
      errors.push({
        code: 'NOON_SNAPSHOT_UPSERT_FAILED',
        partnerSku,
        message: error && error.message ? error.message : 'Snapshot upsert failed.',
      })
    }
  }

  return {
    ok: errors.length === 0,
    countryCode,
    totalCatalogItems: catalogItems.length,
    pricingRequested: pricing.requested,
    pricingReturned: pricing.returned,
    upserted,
    errors,
  }
}

async function persistPricingDiscovery(candidateSkus, countryCode) {
  const pricing = await fetchPricingForPartnerSkus(candidateSkus, countryCode)
  const validItems = pricing.items.filter((item) => pricingStatusCode(item).toUpperCase() === 'OK')
  const errors = [...pricing.errors]
  let upserted = 0

  for (const pricingItem of validItems) {
    const partnerSku = typeof pricingItem.partner_sku === 'string' ? pricingItem.partner_sku.trim() : ''
    if (!partnerSku) continue
    try {
      await upsertNoonProductSnapshot({
        partnerSku,
        countryCode,
        price: pricingItem.price,
        msrp: pricingItem.msrp,
        isActive: pricingItem.is_active,
        pricingStatusCode: pricingStatusCode(pricingItem),
        rawCatalogJson: {},
        rawPricingJson: pricingItem,
      })
      upserted += 1
    } catch (error) {
      errors.push({
        code: 'NOON_SNAPSHOT_UPSERT_FAILED',
        partnerSku,
        message: error && error.message ? error.message : 'Snapshot upsert failed.',
      })
    }
  }

  return {
    ok: errors.length === 0,
    countryCode,
    source: 'pricing-discovery',
    totalCatalogItems: validItems.length,
    pricingRequested: pricing.requested,
    pricingReturned: pricing.returned,
    upserted,
    markedInactive: 0,
    errors,
  }
}

function isGlobalSellerCatalogError(error) {
  return /only available to global sellers/i.test(String(error?.message || error || ''))
}

async function syncNoonCatalogPricing(options = {}) {
  const countryCode = normalizePricingCountryCode(options.countryCode || options.country_code)
  const limit = normalizeLimit(options.limit)
  const catalog = await getEligibleCatalogItems({ limit })
  return persistCatalogPricing(Array.isArray(catalog.items) ? catalog.items : [], countryCode)
}

async function syncNoonCatalogPricingFull(options = {}) {
  const countryCode = normalizePricingCountryCode(options.countryCode || options.country_code)
  const candidateSkus = Array.isArray(options.candidateSkus) ? options.candidateSkus : []
  const now = Date.now()
  let catalog
  try {
    if (!recentCatalog || now - recentCatalog.fetchedAt > 5 * 60 * 1000) {
      if (!catalogFetchInFlight) {
        catalogFetchInFlight = fetchAllEligibleCatalogItems({ pacingMs: apiPacingMs() })
          .then((fetchedCatalog) => {
            recentCatalog = { catalog: fetchedCatalog, fetchedAt: Date.now() }
            return fetchedCatalog
          })
          .finally(() => {
            catalogFetchInFlight = null
          })
      }
    }
    catalog = recentCatalog && now - recentCatalog.fetchedAt <= 5 * 60 * 1000
      ? recentCatalog.catalog
      : await catalogFetchInFlight
  } catch (error) {
    if (!isGlobalSellerCatalogError(error) || candidateSkus.length === 0) throw error
    const fallback = await persistPricingDiscovery(candidateSkus, countryCode)
    fallback.catalogWarning = String(error.message || error)
    return fallback
  }

  const catalogItems = Array.isArray(catalog.items) ? catalog.items : []
  const result = await persistCatalogPricing(catalogItems, countryCode)
  result.pageCount = catalog.pageCount || 0
  if (result.ok) {
    result.markedInactive = await markMissingNoonSnapshotsInactive(countryCode, catalogItems.map((item) => item.partnerSku))
  } else {
    result.markedInactive = 0
  }
  return result
}

function syncStateIsFresh(state, now = Date.now()) {
  const timestamp = state?.last_catalog_sync_at ? new Date(state.last_catalog_sync_at).getTime() : 0
  return timestamp > 0 && now - timestamp < catalogCacheTtlHours() * 60 * 60 * 1000
}

async function ensureNoonCatalogCache(options = {}) {
  const countryCode = normalizePricingCountryCode(options.countryCode || options.country_code)
  const force = Boolean(options.force)
  const state = await getNoonSyncState(countryCode)
  if (!force && syncStateIsFresh(state)) {
    return { ok: true, countryCode, cached: true, state }
  }
  if (fullSyncInFlight.has(countryCode)) return fullSyncInFlight.get(countryCode)

  const claimed = await claimNoonSync(countryCode)
  if (!claimed) {
    return { ok: true, countryCode, cached: true, inProgress: true, state: await getNoonSyncState(countryCode) }
  }

  const promise = syncNoonCatalogPricingFull({
    countryCode,
    candidateSkus: options.candidateSkus,
  })
    .then(async (result) => {
      await completeNoonSync(countryCode, {
        status: result.ok ? 'completed' : 'failed',
        catalogSynced: result.ok,
        catalogItems: result.totalCatalogItems,
        error: result.ok ? '' : result.errors.map((error) => error.message).join('; ').slice(0, 2000),
      })
      return { ...result, cached: false }
    })
    .catch(async (error) => {
      await completeNoonSync(countryCode, {
        status: 'failed',
        error: String(error?.message || error).slice(0, 2000),
      })
      throw error
    })
    .finally(() => fullSyncInFlight.delete(countryCode))
  fullSyncInFlight.set(countryCode, promise)
  return promise
}

module.exports = {
  catalogCacheTtlHours,
  ensureNoonCatalogCache,
  fetchPricingForPartnerSkus,
  listNoonProductSnapshots,
  syncNoonCatalogPricing,
  syncNoonCatalogPricingFull,
  syncStateIsFresh,
}
