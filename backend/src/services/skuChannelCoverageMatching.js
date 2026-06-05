const { normalizeSkuKey } = require('../utils/normalizeSkuKey')
const { expandExactMatchVariants } = require('../utils/purchasePlanningSkuMatcher')
const { zohoItemLookupKeys } = require('./zohoLifeSmileWarehouseService')

/** @typedef {'COMPLETE'|'AMAZON_ONLY'|'NOON_ONLY'|'MISSING_AMAZON'|'MISSING_ALL_CHANNELS'} CoverageStatus */

function zohoExpandMatchEnabled() {
  const raw = String(process.env.AMAZON_ZOHO_EXPAND_SKU_MATCH || '1').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'no'
}

/**
 * @param {{ sku?: string, zohoSku?: string, name?: string, zohoItemName?: string, item_code?: string, code?: string, part_number?: string }} zohoItem
 * @returns {{ key: string | null, source: 'sku' | 'item_name' | 'alias' | null }}
 */
function resolveZohoMatchKey(zohoItem) {
  const sku = String(zohoItem?.zohoSku || zohoItem?.sku || '').trim()
  const name = String(zohoItem?.zohoItemName || zohoItem?.name || '').trim()
  const skuKey = normalizeSkuKey(sku)
  if (skuKey) return { key: skuKey, source: 'sku' }
  const nameKey = normalizeSkuKey(name)
  if (nameKey) return { key: nameKey, source: 'item_name' }
  return { key: null, source: null }
}

/**
 * All Zoho keys used elsewhere for Amazon↔Zoho joins (sku, name, item_code, exact variants).
 * @param {object} zohoItem
 * @returns {Array<{ key: string, source: 'sku' | 'item_name' | 'alias' }>}
 */
function resolveZohoLookupKeys(zohoItem) {
  const sku = String(zohoItem?.zohoSku || zohoItem?.sku || '').trim()
  const name = String(zohoItem?.zohoItemName || zohoItem?.name || '').trim()
  const entry = { sku, itemName: name }
  const keys = zohoItemLookupKeys(zohoItem, entry)
  const primarySku = normalizeSkuKey(sku)
  const primaryName = normalizeSkuKey(name)
  const ordered = []
  const seen = new Set()

  function push(key, source) {
    if (!key || seen.has(key)) return
    seen.add(key)
    ordered.push({ key, source })
  }

  if (primarySku) push(primarySku, 'sku')
  if (primaryName) push(primaryName, 'item_name')
  for (const key of keys) {
    if (primarySku && key === primarySku) continue
    if (primaryName && key === primaryName) continue
    push(key, 'alias')
  }

  return ordered
}

/**
 * @param {Map<string, object>} index
 * @param {Array<{ key: string, source: 'sku' | 'item_name' | 'alias' }>} zohoKeys
 * @returns {{ hit: object, matchedKey: string, source: 'sku' | 'item_name' | 'alias' } | null}
 */
function lookupChannelMatch(index, zohoKeys) {
  for (const candidate of zohoKeys || []) {
    const tryKeys = [candidate.key]
    if (zohoExpandMatchEnabled()) {
      for (const variant of expandExactMatchVariants(candidate.key)) {
        if (!tryKeys.includes(variant)) tryKeys.push(variant)
      }
    }
    for (const key of tryKeys) {
      const hit = index.get(key)
      if (hit) {
        return { hit, matchedKey: key, source: candidate.source }
      }
    }
  }
  return null
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
    const zohoLookupKeys = resolveZohoLookupKeys(item)
    const { key: normalizedZohoKey, source: matchKeySource } = resolveZohoMatchKey(item)
    const uaeMatch = lookupChannelMatch(indexes.amazonUae, zohoLookupKeys)
    const ksaMatch = lookupChannelMatch(indexes.amazonKsa, zohoLookupKeys)
    const noonMatch = lookupChannelMatch(indexes.noon, zohoLookupKeys)
    const uae = uaeMatch?.hit
    const ksa = ksaMatch?.hit
    const noon = noonMatch?.hit

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
  const entries = []
  for (const listing of listings || []) {
    const rawSku = listing.sellerSku || listing.normalizedSku || ''
    const normalizedKey = normalizeSkuKey(listing.normalizedSku || listing.sellerSku)
    if (!normalizedKey) continue
    entries.push({
      normalizedKey,
      rawSku: String(rawSku).trim() || normalizedKey,
      status: listing.listingStatus || 'ACTIVE',
      qty: listing.availableQty ?? null,
      asin: listing.asin || '',
    })
    if (zohoExpandMatchEnabled()) {
      for (const variant of expandExactMatchVariants(rawSku)) {
        const variantKey = normalizeSkuKey(variant)
        if (!variantKey || variantKey === normalizedKey) continue
        entries.push({
          normalizedKey: variantKey,
          rawSku: String(rawSku).trim() || variantKey,
          status: listing.listingStatus || 'ACTIVE',
          qty: listing.availableQty ?? null,
          asin: listing.asin || '',
        })
      }
    }
  }
  return entries
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

/**
 * Noon seller PSKU (e.g. R23G) may appear as `psku` or `partner_sku` in catalog API.
 * Avoid indexing Noon's long internal SKU when it differs from partner_sku.
 * @param {object} item
 * @returns {Array<{ key: string, rawSku: string }>}
 */
function resolveNoonMatchKeys(item) {
  const psku = String(item.psku || item.p_sku || item.pSku || '').trim()
  const partnerSku = String(item.partnerSku || item.partner_sku || '').trim()
  const noonSku = String(item.sku || item.noon_sku || item.noonSku || '').trim()
  const displaySku = psku || partnerSku || noonSku
  const keys = []
  const seen = new Set()

  function add(raw) {
    const key = normalizeSkuKey(raw)
    if (!key || seen.has(key)) return
    seen.add(key)
    keys.push({ key, rawSku: String(raw).trim() || displaySku })
  }

  if (psku) add(psku)
  if (partnerSku) add(partnerSku)
  if (
    noonSku &&
    (!partnerSku || normalizeSkuKey(noonSku) === normalizeSkuKey(partnerSku))
  ) {
    add(noonSku)
  }

  return keys.map((entry) => ({ ...entry, rawSku: entry.rawSku || displaySku }))
}

/**
 * @param {object[]} items
 * @returns {Array<{ normalizedKey: string, rawSku: string, status: string, qty?: number | null }>}
 */
function mapNoonItemsToIndexEntries(items) {
  const entries = []
  for (const item of items || []) {
    const status =
      item.isActive === false
        ? 'INACTIVE'
        : item.status || item.pricingStatusCode || item.pricing_status_code || 'ACTIVE'
    const qty = item.stockQuantity ?? item.stock_quantity ?? null
    const matchKeys = resolveNoonMatchKeys(item)
    for (const match of matchKeys) {
      entries.push({
        normalizedKey: match.key,
        rawSku: match.rawSku,
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
  resolveZohoLookupKeys,
  lookupChannelMatch,
  buildChannelIndex,
  deriveCoverageStatus,
  buildCoverageRows,
  computeSummaryCards,
  filterCoverageRows,
  mapAmazonListingsToIndexEntries,
  mapNoonItemsToIndexEntries,
  resolveNoonMatchKeys,
  buildMismatchNotes,
  buildVigilIndex,
  attachVigilToCoverageRows,
}
