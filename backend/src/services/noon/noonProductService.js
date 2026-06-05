const { noonGet, noonPost } = require('./noonClient')
const { NoonServiceError } = require('./noonErrors')

const PRICING_GET_PATH = '/pricing/v1/pricing/get'
const VALID_PRICING_COUNTRY_CODES = new Set(['ae', 'sa', 'eg'])
const VALID_PRICING_BODY_SHAPES = new Set(['items', 'data', 'array'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function findString(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()

  function walk(value) {
    if (!value || typeof value !== 'object') return ''
    if (visited.has(value)) return ''
    visited.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item)
        if (nested) return nested
      }
      return ''
    }

    for (const [key, entry] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key)) && typeof entry === 'string' && entry.trim()) {
        return entry.trim()
      }
    }

    for (const entry of Object.values(value)) {
      const nested = walk(entry)
      if (nested) return nested
    }

    return ''
  }

  return walk(source)
}

function findArrayLength(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()

  function walk(value) {
    if (!value || typeof value !== 'object') return null
    if (visited.has(value)) return null
    visited.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item)
        if (nested != null) return nested
      }
      return null
    }

    for (const [key, entry] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key)) && Array.isArray(entry)) {
        return entry.length
      }
    }

    for (const entry of Object.values(value)) {
      const nested = walk(entry)
      if (nested != null) return nested
    }

    return null
  }

  return walk(source)
}

function normalizeWhoamiSummary(raw) {
  return {
    email: findString(raw, ['email', 'email_address', 'username', 'user_email']),
    displayName: findString(raw, ['display_name', 'full_name', 'name']),
    projectCode: findString(raw, ['project_code', 'default_project_code', 'projectCode']),
    partnerCode: findString(raw, ['partner_code', 'partnerCode']),
    role: findString(raw, ['role', 'role_name']),
  }
}

function normalizeProductSummary(partnerSku, raw) {
  return {
    partnerSku,
    sku: findString(raw, ['partner_sku', 'partnerSku', 'sku']),
    title: findString(raw, ['title', 'name', 'product_title']),
    brand: findString(raw, ['brand', 'brand_name']),
    status: findString(raw, ['status', 'state']),
    offersCount: findArrayLength(raw, ['offers', 'product_offers', 'items']),
  }
}

function normalizeCatalogItem(rawItem) {
  return {
    partnerSku: findString(rawItem, ['partner_sku', 'partnerSku', 'seller_sku', 'sellerSku']),
    sku: findString(rawItem, ['sku', 'zsku', 'noon_sku', 'noonSku']),
    psku: findString(rawItem, ['psku', 'p_sku', 'pSku']),
    title: findString(rawItem, ['title', 'name', 'product_title', 'productTitle']),
    imageUrl: findString(rawItem, [
      'image_url',
      'imageUrl',
      'main_image_url',
      'mainImageUrl',
      'thumbnail_url',
      'thumbnailUrl',
      'image',
    ]),
    barcode: findString(rawItem, ['barcode', 'ean', 'gtin', 'upc']),
    pbarcode: findString(rawItem, ['pbarcode', 'p_barcode', 'pBarcode', 'partner_barcode', 'partnerBarcode']),
    storageType: findString(rawItem, ['storage_type', 'storageType', 'fulfillment_type', 'fulfillmentType']),
    raw: rawItem,
  }
}

function findArrayByKeys(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()

  function walk(value) {
    if (!value || typeof value !== 'object') return null
    if (visited.has(value)) return null
    visited.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item)
        if (nested) return nested
      }
      return null
    }

    for (const [key, entry] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key)) && Array.isArray(entry)) return entry
    }

    for (const entry of Object.values(value)) {
      const nested = walk(entry)
      if (nested) return nested
    }

    return null
  }

  return walk(source)
}

function findFirstObjectArray(source) {
  const visited = new Set()

  function walk(value) {
    if (!value || typeof value !== 'object') return null
    if (visited.has(value)) return null
    visited.add(value)

    if (Array.isArray(value)) {
      if (value.length && value.some((entry) => isRecord(entry))) return value
      for (const item of value) {
        const nested = walk(item)
        if (nested) return nested
      }
      return null
    }

    for (const entry of Object.values(value)) {
      const nested = walk(entry)
      if (nested) return nested
    }

    return null
  }

  return walk(source)
}

function pickCatalogItemsArray(raw) {
  const keyedArray = findArrayByKeys(raw, [
    'items',
    'results',
    'catalog_items',
    'eligible_items',
    'data',
    'payload',
  ])
  if (Array.isArray(keyedArray)) return keyedArray
  if (Array.isArray(raw) && raw.some((entry) => isRecord(entry))) return raw
  return findFirstObjectArray(raw) || []
}

function filterCatalogItems(items, options = {}) {
  const limitValue = Number.parseInt(String(options.limit || ''), 10)
  const search = String(options.search || '').trim().toLowerCase()

  let filtered = Array.isArray(items) ? items.slice() : []
  if (search) {
    filtered = filtered.filter((item) => {
      const haystack = [
        item && item.partnerSku,
        item && item.sku,
        item && item.psku,
        item && item.title,
        item && item.pbarcode,
        item && item.barcode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(search)
    })
  }

  if (Number.isFinite(limitValue) && limitValue > 0) {
    filtered = filtered.slice(0, limitValue)
  }

  return filtered
}

function ensurePartnerSku(partnerSku) {
  const normalizedSku = String(partnerSku || '').trim()
  if (!normalizedSku) {
    throw new NoonServiceError('NOON_PARTNER_SKU_REQUIRED', 'partnerSku is required.', 400)
  }
  return normalizedSku
}

function normalizePricingCountryCode(countryCode) {
  const normalized = String(countryCode || 'ae').trim().toLowerCase()
  return VALID_PRICING_COUNTRY_CODES.has(normalized) ? normalized : 'ae'
}

function normalizePricingBodyShape(bodyShape) {
  const normalized = String(bodyShape || 'items').trim().toLowerCase()
  return VALID_PRICING_BODY_SHAPES.has(normalized) ? normalized : 'items'
}

function buildPricingGetBody(partnerSku, countryCode, bodyShape = 'items') {
  const item = {
    partner_sku: partnerSku,
    country_code: normalizePricingCountryCode(countryCode),
  }
  const normalizedShape = normalizePricingBodyShape(bodyShape)

  if (normalizedShape === 'data') {
    return { data: [item] }
  }
  if (normalizedShape === 'array') {
    return [item]
  }
  return { items: [item] }
}

function serializeDiagnosticError(error) {
  if (error instanceof NoonServiceError) {
    return {
      code: error.code,
      message: error.message,
      noonStatus: error.httpStatus,
      details: error.details || [],
      path: error.meta && error.meta.path ? error.meta.path : undefined,
      url: error.meta && error.meta.url ? error.meta.url : undefined,
      safeBody: error.meta && Object.prototype.hasOwnProperty.call(error.meta, 'safeBody')
        ? error.meta.safeBody
        : undefined,
    }
  }

  return {
    code: 'NOON_UNKNOWN_ERROR',
    message: 'Noon request failed.',
  }
}

async function runDiagnosticEndpoint(service, method, requestPath, partnerSku, body, options = {}) {
  try {
    const response =
      method === 'GET'
        ? await noonGet(requestPath)
        : await noonPost(requestPath, body)

    return {
      ok: true,
      service,
      method,
      path: requestPath,
      url: response.request && response.request.url ? response.request.url : undefined,
      noonStatus: response.status,
      ...(options.includeRequestBody ? { requestBody: body } : {}),
      raw: response.data,
    }
  } catch (error) {
    return {
      ok: false,
      service,
      method,
      path: requestPath,
      partnerSku,
      ...(options.includeRequestBody ? { requestBody: body } : {}),
      error: serializeDiagnosticError(error),
    }
  }
}

async function getWhoami() {
  const response = await noonGet('/identity/v1/whoami')
  return {
    raw: response.data,
    summary: normalizeWhoamiSummary(response.data),
  }
}

async function getProductOffers(partnerSku) {
  const normalizedSku = ensurePartnerSku(partnerSku)
  const encodedSku = encodeURIComponent(normalizedSku)
  const response = await noonGet(`/v1/product/${encodedSku}`)

  return {
    raw: response.data,
    summary: normalizeProductSummary(normalizedSku, response.data),
  }
}

const CATALOG_ITEMS_PATH = '/fbn/inbound/v1/catalog/items'
const CATALOG_MAX_PAGES = 100

function catalogItemsPath(nextToken) {
  if (!nextToken) return CATALOG_ITEMS_PATH
  const params = new URLSearchParams()
  params.set('next_token', String(nextToken))
  return `${CATALOG_ITEMS_PATH}?${params.toString()}`
}

async function fetchCatalogItemsPage(nextToken = null) {
  let response
  try {
    response = await noonGet(catalogItemsPath(nextToken))
  } catch (error) {
    if (error instanceof NoonServiceError) {
      error.meta = {
        ...(error.meta || {}),
        service: 'fbn-inbound',
      }
    }
    throw error
  }
  const data = response.data || {}
  const rawItems = pickCatalogItemsArray(data)
  const next =
    data.next_token != null && String(data.next_token).trim()
      ? String(data.next_token).trim()
      : data.nextToken != null && String(data.nextToken).trim()
        ? String(data.nextToken).trim()
        : null
  return {
    rawItems,
    nextToken: next,
    response,
  }
}

/**
 * Paginate through all eligible catalog items (Noon returns 100/page + next_token).
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, items: object[], totalCount: number, pageCount: number }>}
 */
async function fetchAllEligibleCatalogItems(options = {}) {
  const normalizedItems = []
  let nextToken = null
  let pageCount = 0
  let lastResponse = null

  do {
    pageCount += 1
    if (pageCount > CATALOG_MAX_PAGES) break
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchCatalogItemsPage(nextToken)
    lastResponse = page.response
    const pageItems = Array.isArray(page.rawItems) ? page.rawItems : []
    normalizedItems.push(...pageItems.map(normalizeCatalogItem))
    nextToken = page.nextToken
  } while (nextToken)

  const filteredItems = filterCatalogItems(normalizedItems, options)
  return {
    ok: true,
    service: 'fbn-inbound',
    path:
      lastResponse && lastResponse.request && lastResponse.request.path
        ? lastResponse.request.path
        : CATALOG_ITEMS_PATH,
    url: lastResponse && lastResponse.request ? lastResponse.request.url : undefined,
    noonStatus: lastResponse ? lastResponse.status : null,
    count: filteredItems.length,
    totalCount: normalizedItems.length,
    pageCount,
    items: filteredItems,
  }
}

async function getEligibleCatalogItems(options = {}) {
  const page = await fetchCatalogItemsPage(null)
  const normalizedItems = (Array.isArray(page.rawItems) ? page.rawItems : []).map(normalizeCatalogItem)
  const filteredItems = filterCatalogItems(normalizedItems, options)

  return {
    ok: true,
    service: 'fbn-inbound',
    path:
      page.response && page.response.request && page.response.request.path
        ? page.response.request.path
        : CATALOG_ITEMS_PATH,
    url: page.response && page.response.request ? page.response.request.url : undefined,
    noonStatus: page.response ? page.response.status : null,
    count: filteredItems.length,
    totalCount: normalizedItems.length,
    items: filteredItems,
    raw: page.response ? page.response.data : null,
  }
}

async function debugProductLookup(partnerSku, options = {}) {
  const normalizedSku = ensurePartnerSku(partnerSku)
  const encodedSku = encodeURIComponent(normalizedSku)
  const countryCode = normalizePricingCountryCode(options.countryCode)
  const pricingBodyShape = normalizePricingBodyShape(options.pricingBodyShape)
  const pricingBody = buildPricingGetBody(normalizedSku, countryCode, pricingBodyShape)

  const [productByPartnerSku, pricingGet] = await Promise.all([
    runDiagnosticEndpoint('offer', 'GET', `/v1/product/${encodedSku}`, normalizedSku),
    runDiagnosticEndpoint('pricing', 'POST', PRICING_GET_PATH, normalizedSku, pricingBody, {
      includeRequestBody: true,
    }),
  ])

  return {
    ok: Boolean(productByPartnerSku.ok || pricingGet.ok),
    partnerSku: normalizedSku,
    pricingCountryCode: countryCode,
    pricingBodyShape,
    results: {
      productByPartnerSku,
      pricingGet,
    },
  }
}

async function debugPricingRequestVariants(partnerSku, options = {}) {
  const normalizedSku = ensurePartnerSku(partnerSku)
  const countryCodes = Array.isArray(options.countryCodes) && options.countryCodes.length
    ? options.countryCodes.map(normalizePricingCountryCode)
    : ['ae', 'sa', 'eg']
  const bodyShapes = Array.isArray(options.bodyShapes) && options.bodyShapes.length
    ? options.bodyShapes.map(normalizePricingBodyShape)
    : ['items']

  const tests = []
  for (const countryCode of countryCodes) {
    for (const bodyShape of bodyShapes) {
      const body = buildPricingGetBody(normalizedSku, countryCode, bodyShape)
      tests.push(
        runDiagnosticEndpoint('pricing', 'POST', PRICING_GET_PATH, normalizedSku, body, {
          includeRequestBody: true,
        }).then((result) => ({
          countryCode,
          bodyShape,
          ...result,
        }))
      )
    }
  }

  const results = await Promise.all(tests)
  return {
    ok: results.some((result) => result.ok),
    partnerSku: normalizedSku,
    endpointPath: PRICING_GET_PATH,
    results,
  }
}

module.exports = {
  buildPricingGetBody,
  debugProductLookup,
  debugPricingRequestVariants,
  fetchAllEligibleCatalogItems,
  getEligibleCatalogItems,
  getProductOffers,
  getWhoami,
  normalizeWhoamiSummary,
  normalizePricingCountryCode,
}
