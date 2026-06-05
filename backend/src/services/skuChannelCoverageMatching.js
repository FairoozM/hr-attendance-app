const { normalizeSkuKey } = require('../utils/normalizeSkuKey')

/** @typedef {'COMPLETE'|'AMAZON_ONLY'|'NOON_ONLY'|'MISSING_AMAZON'|'MISSING_ALL_CHANNELS'} CoverageStatus */

/**
 * @param {{ sku?: string, name?: string }} zohoItem
 * @returns {{ key: string | null, source: 'sku' | 'item_name' | null }}
 */
function resolveZohoMatchKey(zohoItem) {
  const skuKey = normalizeSkuKey(zohoItem?.sku)
  if (skuKey) return { key: skuKey, source: 'sku' }
  const nameKey = normalizeSkuKey(zohoItem?.name)
  if (nameKey) return { key: nameKey, source: 'item_name' }
  return { key: null, source: null }
}

/**
 * @param {Array<{ normalizedKey: string, rawSku: string, status: string, qty?: number | null, asin?: string }>} entries
 * @returns {Map<string, { rawSku: string, status: string, qty?: number | null, asin?: string }>}
 */
function buildChannelIndex(entries) {
  const index = new Map()
  for (const entry of entries || []) {
    const key = entry?.normalizedKey
    if (!key || index.has(key)) continue
    index.set(key, {
      rawSku: entry.rawSku || '',
      status: entry.status || '',
      qty: entry.qty ?? null,
      asin: entry.asin || '',
    })
  }
  return index
}

/**
 * @param {boolean} matched
 * @param {{ rawSku?: string, status?: string } | undefined} channel
 * @returns {{ matched: boolean, sku: string | null, status: string | null }}
 */
function channelMatchFields(matched, channel) {
  return {
    matched,
    sku: matched && channel?.rawSku ? channel.rawSku : null,
    status: matched && channel?.status ? channel.status : null,
  }
}

/**
 * @param {boolean} amazonMatchedAny
 * @param {boolean} noonMatched
 * @returns {CoverageStatus}
 */
function deriveCoverageStatus(amazonMatchedAny, noonMatched) {
  if (amazonMatchedAny && noonMatched) return 'COMPLETE'
  if (amazonMatchedAny && !noonMatched) return 'AMAZON_ONLY'
  if (!amazonMatchedAny && noonMatched) return 'NOON_ONLY'
  return 'MISSING_ALL_CHANNELS'
}

/**
 * @param {object} row
 * @returns {string}
 */
function buildMismatchNotes(row) {
  const parts = []
  if (!row.amazonUaeMatched && !row.amazonKsaMatched) {
    parts.push('Not listed on Amazon UAE or KSA')
  } else if (!row.amazonUaeMatched) {
    parts.push('Missing from Amazon UAE')
  } else if (!row.amazonKsaMatched) {
    parts.push('Missing from Amazon KSA')
  }
  if (!row.noonMatched) {
    parts.push('Not listed on Noon')
  }
  if (row.matchKeySource === 'item_name') {
    parts.push('Matched using Zoho item name (no Zoho SKU)')
  }
  if (parts.length === 0) {
    return 'Listed on all tracked channels'
  }
  return parts.join(' · ')
}

/**
 * @param {Array<{
 *   zohoItemId: string,
 *   zohoItemName: string,
 *   zohoSku: string,
 *   zohoStockQty?: number | null,
 *   isActive?: boolean,
 * }>} zohoItems
 * @param {{
 *   amazonUae: Map<string, object>,
 *   amazonKsa: Map<string, object>,
 *   noon: Map<string, object>,
 * }} indexes
 * @returns {object[]}
 */
function buildCoverageRows(zohoItems, indexes) {
  const rows = []
  for (const item of zohoItems || []) {
    const { key: normalizedZohoKey, source: matchKeySource } = resolveZohoMatchKey(item)
    const uae = normalizedZohoKey ? indexes.amazonUae.get(normalizedZohoKey) : undefined
    const ksa = normalizedZohoKey ? indexes.amazonKsa.get(normalizedZohoKey) : undefined
    const noon = normalizedZohoKey ? indexes.noon.get(normalizedZohoKey) : undefined

    const amazonUaeMatched = Boolean(uae)
    const amazonKsaMatched = Boolean(ksa)
    const amazonMatchedAny = amazonUaeMatched || amazonKsaMatched
    const noonMatched = Boolean(noon)

    const uaeFields = channelMatchFields(amazonUaeMatched, uae)
    const ksaFields = channelMatchFields(amazonKsaMatched, ksa)
    const noonFields = channelMatchFields(noonMatched, noon)

    let coverageStatus = deriveCoverageStatus(amazonMatchedAny, noonMatched)
    if (!amazonMatchedAny && coverageStatus === 'MISSING_ALL_CHANNELS') {
      coverageStatus = 'MISSING_ALL_CHANNELS'
    } else if (!amazonMatchedAny) {
      coverageStatus = noonMatched ? 'NOON_ONLY' : 'MISSING_ALL_CHANNELS'
    }

    const row = {
      zohoItemId: item.zohoItemId || '',
      zohoItemName: item.zohoItemName || '',
      zohoSku: item.zohoSku || '',
      zohoStockQty: item.zohoStockQty ?? null,
      normalizedZohoKey,
      matchKeySource,
      amazonUaeMatched,
      amazonKsaMatched,
      amazonMatchedAny,
      noonMatched,
      amazonUaeSku: uaeFields.sku,
      amazonKsaSku: ksaFields.sku,
      noonSku: noonFields.sku,
      amazonUaeStatus: uaeFields.status,
      amazonKsaStatus: ksaFields.status,
      noonStatus: noonFields.status,
      coverageStatus,
      notes: '',
    }
    row.notes = buildMismatchNotes({ ...row, matchKeySource })
    rows.push(row)
  }
  return rows
}

/**
 * @param {object[]} rows
 * @returns {object}
 */
function computeSummaryCards(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    totalActiveZohoItems: list.length,
    matchedAmazonUae: list.filter((r) => r.amazonUaeMatched).length,
    matchedAmazonKsa: list.filter((r) => r.amazonKsaMatched).length,
    matchedAmazonAny: list.filter((r) => r.amazonMatchedAny).length,
    matchedNoon: list.filter((r) => r.noonMatched).length,
    missingAmazon: list.filter((r) => !r.amazonMatchedAny).length,
    missingNoon: list.filter((r) => !r.noonMatched).length,
    missingAllChannels: list.filter((r) => !r.amazonMatchedAny && !r.noonMatched).length,
  }
}

const COVERAGE_FILTERS = new Set([
  'all',
  'missingAmazon',
  'missingNoon',
  'missingAllChannels',
  'complete',
  'amazonUaeMatched',
  'amazonKsaMatched',
])

/**
 * @param {object[]} rows
 * @param {{ filter?: string, search?: string }} options
 * @returns {object[]}
 */
function filterCoverageRows(rows, options = {}) {
  const filter = COVERAGE_FILTERS.has(String(options.filter || 'all'))
    ? String(options.filter || 'all')
    : 'all'
  const search = normalizeSkuKey(options.search) || ''
  let filtered = Array.isArray(rows) ? rows.slice() : []

  if (filter === 'missingAmazon') {
    filtered = filtered.filter((r) => !r.amazonMatchedAny)
  } else if (filter === 'missingNoon') {
    filtered = filtered.filter((r) => !r.noonMatched)
  } else if (filter === 'missingAllChannels') {
    filtered = filtered.filter((r) => !r.amazonMatchedAny && !r.noonMatched)
  } else if (filter === 'complete') {
    filtered = filtered.filter((r) => r.coverageStatus === 'COMPLETE')
  } else if (filter === 'amazonUaeMatched') {
    filtered = filtered.filter((r) => r.amazonUaeMatched)
  } else if (filter === 'amazonKsaMatched') {
    filtered = filtered.filter((r) => r.amazonKsaMatched)
  }

  if (search) {
    filtered = filtered.filter((r) => {
      const nameKey = normalizeSkuKey(r.zohoItemName)
      const skuKey = normalizeSkuKey(r.zohoSku)
      const idKey = normalizeSkuKey(r.zohoItemId)
      return (
        (nameKey && nameKey.includes(search)) ||
        (skuKey && skuKey.includes(search)) ||
        (idKey && idKey.includes(search))
      )
    })
  }

  return filtered
}

/**
 * Map Amazon listing rows to channel index entries (seller SKU only).
 * @param {object[]} listings
 * @returns {Array<{ normalizedKey: string, rawSku: string, status: string, qty?: number | null, asin?: string }>}
 */
function mapAmazonListingsToIndexEntries(listings) {
  return (listings || []).map((listing) => ({
    normalizedKey: normalizeSkuKey(listing.sellerSku),
    rawSku: listing.sellerSku || '',
    status: listing.listingStatus || 'ACTIVE',
    qty: listing.availableQty ?? null,
    asin: listing.asin || '',
  })).filter((e) => e.normalizedKey)
}

/**
 * Map Noon catalog/snapshot rows to channel index entries (partner SKU primary).
 * @param {object[]} items
 * @returns {Array<{ normalizedKey: string, rawSku: string, status: string, qty?: number | null }>}
 */
function toVigilStockQty(value) {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * @param {Array<{ itemCode?: string, normalizedItemCode?: string, itemName?: string, availableStock?: number }>} vigilRows
 * @returns {Map<string, { vigilSku: string, vigilStockQty: number | null, vigilItemName: string }>}
 */
function buildVigilIndex(vigilRows) {
  const index = new Map()
  for (const row of vigilRows || []) {
    const rawSku = String(row.itemCode || row.normalizedItemCode || '').trim()
    const key = normalizeSkuKey(rawSku)
    if (!key || index.has(key)) continue
    index.set(key, {
      vigilSku: rawSku,
      vigilStockQty: toVigilStockQty(row.availableStock),
      vigilItemName: String(row.itemName || '').trim(),
    })
  }
  return index
}

/**
 * @param {object[]} rows
 * @param {Array<{ itemCode?: string, normalizedItemCode?: string, itemName?: string, availableStock?: number }>} vigilRows
 * @returns {object[]}
 */
function attachVigilToCoverageRows(rows, vigilRows) {
  const list = Array.isArray(vigilRows) ? vigilRows : []
  if (list.length === 0) {
    return (rows || []).map((row) => ({
      ...row,
      vigilMatched: false,
      vigilSku: null,
      vigilStockQty: null,
      vigilItemName: null,
    }))
  }
  const index = buildVigilIndex(list)
  return (rows || []).map((row) => {
    const key = row.normalizedZohoKey || normalizeSkuKey(row.zohoSku) || normalizeSkuKey(row.zohoItemName)
    const vigil = key ? index.get(key) : undefined
    return {
      ...row,
      vigilMatched: Boolean(vigil),
      vigilSku: vigil?.vigilSku ?? null,
      vigilStockQty: vigil?.vigilStockQty ?? null,
      vigilItemName: vigil?.vigilItemName ?? null,
    }
  })
}

function mapNoonItemsToIndexEntries(items) {
  const entries = []
  for (const item of items || []) {
    const partnerSku = item.partnerSku || item.partner_sku || ''
    const noonSku = item.sku || item.noon_sku || item.noonSku || ''
    const status = item.isActive === false ? 'INACTIVE' : item.status || item.pricingStatusCode || item.pricing_status_code || 'ACTIVE'
    const qty = item.stockQuantity ?? item.stock_quantity ?? null
    const keys = [normalizeSkuKey(partnerSku), normalizeSkuKey(noonSku)].filter(Boolean)
    const uniqueKeys = [...new Set(keys)]
    for (const key of uniqueKeys) {
      entries.push({
        normalizedKey: key,
        rawSku: partnerSku || noonSku,
        status: String(status),
        qty,
      })
    }
  }
  return entries
}

module.exports = {
  COVERAGE_FILTERS,
  resolveZohoMatchKey,
  buildChannelIndex,
  deriveCoverageStatus,
  buildCoverageRows,
  computeSummaryCards,
  filterCoverageRows,
  mapAmazonListingsToIndexEntries,
  mapNoonItemsToIndexEntries,
  buildMismatchNotes,
  buildVigilIndex,
  attachVigilToCoverageRows,
}
