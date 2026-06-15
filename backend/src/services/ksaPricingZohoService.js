const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')
const { fetchItemById } = require('../integrations/zoho/zohoInventoryClient')
const { zohoInventoryJsonRequest } = require('./zohoApiClient')
const { findItemsBySkuOrName } = require('./zohoBulkInvoiceStore')
const { expandExactMatchVariants, expandMatchCandidates, normalizeSku } = require('../utils/purchasePlanningSkuMatcher')

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeSkuKey(value) {
  return normalizeSku(value)
}

function lookupKeys(raw) {
  const out = new Set()
  for (const candidate of expandMatchCandidates(raw)) {
    if (candidate.key) out.add(candidate.key)
  }
  for (const variant of expandExactMatchVariants(raw)) {
    if (variant) out.add(variant)
  }
  const clean = cleanSku(raw)
  if (clean) out.add(clean)
  return [...out]
}

function rawJsonField(item, field) {
  const raw = item?.raw_json
  if (!raw || typeof raw !== 'object') return ''
  const value = raw[field]
  return value == null ? '' : String(value).trim()
}

function itemLookupKeys(item) {
  const out = new Set()
  const add = (raw) => {
    for (const key of lookupKeys(raw)) {
      if (key) out.add(normalizeSkuKey(key))
    }
  }
  add(item?.sku)
  add(item?.item_code)
  add(item?.code)
  add(item?.name)
  add(item?.item_name)
  add(item?.part_number)
  add(rawJsonField(item, 'sku'))
  add(rawJsonField(item, 'item_code'))
  add(rawJsonField(item, 'code'))
  add(rawJsonField(item, 'name'))
  add(rawJsonField(item, 'item_name'))
  add(rawJsonField(item, 'part_number'))
  return out
}

function pickBestItemMatch(items, needle) {
  const wanted = lookupKeys(needle).map(normalizeSkuKey).filter(Boolean)
  const wantedSet = new Set(wanted)
  const rows = Array.isArray(items) ? items : []

  for (const wantedKey of wanted) {
    const exact = rows.find((row) => normalizeSkuKey(row?.sku) === wantedKey)
    if (exact) return exact
  }
  for (const wantedKey of wanted) {
    const exactName = rows.find((row) => normalizeSkuKey(row?.name || row?.item_name) === wantedKey)
    if (exactName) return exactName
  }
  for (const row of rows) {
    const keys = itemLookupKeys(row)
    for (const key of keys) {
      if (wantedSet.has(key)) return row
    }
  }
  return null
}

function parseDimension(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function extractPackageDetails(item) {
  const pkg = item?.package_details && typeof item.package_details === 'object' ? item.package_details : {}
  const length = parseDimension(pkg.length)
  const width = parseDimension(pkg.width)
  const height = parseDimension(pkg.height)
  const dimensionUnit = String(pkg.dimension_unit || 'cm').trim().toLowerCase() === 'in' ? 'in' : 'cm'
  const hasAll = length != null && width != null && height != null
  return {
    length: length ?? null,
    width: width ?? null,
    height: height ?? null,
    dimensionUnit,
    hasAll,
  }
}

function mapLookupResult({ sku, item, source, status, message }) {
  const dims = item ? extractPackageDetails(item) : { length: null, width: null, height: null, dimensionUnit: 'cm', hasAll: false }
  return {
    sku,
    itemId: item?.item_id ? String(item.item_id) : '',
    itemName: item?.name || item?.item_name ? String(item.name || item.item_name) : '',
    length: dims.length,
    width: dims.width,
    height: dims.height,
    dimensionUnit: dims.dimensionUnit,
    zohoDimensionStatus: status,
    message: message || '',
    source,
  }
}

async function fetchItemDetailById(itemId) {
  const id = cleanSku(itemId)
  if (!id) return null
  return fetchItemById(id, { source: 'ksa_pricing_dimensions', skipCache: true })
}

async function searchZohoItemsByText(searchText, { activeOnly = true } = {}) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const err = new Error('Zoho is not configured on the server.')
    err.code = 'ZOHO_NOT_CONFIGURED'
    throw err
  }
  const needle = cleanSku(searchText)
  if (!needle) return []

  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  p.set('search_text', needle)
  p.set('page', '1')
  p.set('per_page', '25')
  if (activeOnly && String(process.env.ZOHO_ITEMS_INCLUDE_INACTIVE || '').trim() !== '1') {
    p.set('filter_by', 'Status.Active')
  }

  const json = await zohoInventoryJsonRequest(`${INVENTORY_V1}/items`, p, 'GET', undefined, {
    source: 'ksa_pricing_item_search',
    skipCache: true,
  })
  return Array.isArray(json?.items) ? json.items : []
}

async function searchZohoItemBySku(sku) {
  const needle = cleanSku(sku)
  if (!needle) return null

  const terms = lookupKeys(needle)
  const seenItemIds = new Set()

  for (const activeOnly of [true, false]) {
    for (const term of terms) {
      const list = await searchZohoItemsByText(term, { activeOnly })
      for (const row of list) {
        const itemId = row?.item_id != null ? String(row.item_id) : ''
        if (itemId) seenItemIds.add(itemId)
      }
      const pick = pickBestItemMatch(list, needle)
      if (pick?.item_id) return fetchItemDetailById(pick.item_id)
    }
  }

  // Last resort: if Zoho returned exactly one unique item across all searches, verify it matches.
  if (seenItemIds.size === 1) {
    const [onlyId] = [...seenItemIds]
    const detail = await fetchItemDetailById(onlyId)
    if (detail && pickBestItemMatch([detail], needle)) return detail
  }

  return null
}

async function lookupSkuDimensions(sku) {
  const needle = cleanSku(sku)
  if (!needle) {
    return mapLookupResult({
      sku: needle,
      item: null,
      source: 'client',
      status: 'invalid',
      message: 'Item code is required',
    })
  }

  try {
    const cachedRows = await findItemsBySkuOrName(lookupKeys(needle))
    const cached = pickBestItemMatch(cachedRows, needle) || cachedRows[0]
    if (cached?.item_id) {
      const detail = await fetchItemDetailById(cached.item_id)
      if (detail) {
        const dims = extractPackageDetails(detail)
        return mapLookupResult({
          sku: cleanSku(detail.sku) || needle,
          item: detail,
          source: 'zoho_detail',
          status: dims.hasAll ? 'found' : 'missing_dimensions',
          message: dims.hasAll ? 'Dimensions loaded from Zoho' : 'Zoho item found but package dimensions are incomplete',
        })
      }
    }

    const searched = await searchZohoItemBySku(needle)
    if (!searched) {
      return mapLookupResult({
        sku: needle,
        item: null,
        source: 'zoho_search',
        status: 'not_found',
        message: 'SKU not found in Zoho Inventory',
      })
    }

    const dims = extractPackageDetails(searched)
    return mapLookupResult({
      sku: cleanSku(searched.sku) || needle,
      item: searched,
      source: 'zoho_search',
      status: dims.hasAll ? 'found' : 'missing_dimensions',
      message: dims.hasAll ? 'Dimensions loaded from Zoho' : 'Zoho item found but package dimensions are incomplete',
    })
  } catch (err) {
    return mapLookupResult({
      sku: needle,
      item: null,
      source: 'zoho_error',
      status: 'error',
      message: err?.message || 'Zoho lookup failed',
    })
  }
}

async function lookupSkuDimensionsBatch(skus) {
  const unique = Array.from(new Set((Array.isArray(skus) ? skus : []).map(cleanSku).filter(Boolean)))
  const results = []
  for (const sku of unique.slice(0, 80)) {
    results.push(await lookupSkuDimensions(sku))
  }
  return results
}

module.exports = {
  lookupSkuDimensions,
  lookupSkuDimensionsBatch,
  extractPackageDetails,
  _internals: {
    lookupKeys,
    itemLookupKeys,
    pickBestItemMatch,
  },
}
