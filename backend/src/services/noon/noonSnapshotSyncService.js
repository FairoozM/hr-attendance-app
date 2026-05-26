const { noonPost } = require('./noonClient')
const {
  getEligibleCatalogItems,
  normalizePricingCountryCode,
} = require('./noonProductService')
const {
  listNoonProductSnapshots,
  upsertNoonProductSnapshot,
} = require('./noonSnapshotStore')

const PRICING_GET_PATH = '/pricing/v1/pricing/get'

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

  for (const chunk of chunks) {
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
  }

  return {
    requested: uniqueSkus.length,
    returned: pricingItems.length,
    items: pricingItems,
    errors,
  }
}

async function syncNoonCatalogPricing(options = {}) {
  const countryCode = normalizePricingCountryCode(options.countryCode || options.country_code)
  const limit = normalizeLimit(options.limit)
  const catalog = await getEligibleCatalogItems({ limit })
  const catalogItems = Array.isArray(catalog.items) ? catalog.items : []
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

module.exports = {
  fetchPricingForPartnerSkus,
  listNoonProductSnapshots,
  syncNoonCatalogPricing,
}
