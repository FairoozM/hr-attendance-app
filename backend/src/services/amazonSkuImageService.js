/**
 * Resolve primary catalog images for ASINs via Search Catalog Items (rate-limited SP-API)
 * plus DB cache (amazon_catalog_item_cache). URLs are allowlisted to Amazon image hosts only.
 */

const { searchAmazonCatalogItems } = require('./amazonSpApiService')
const catalogCache = require('./amazonCatalogItemCacheStore')
const { batchResolveSkuImageOverrides } = require('./amazonSkuImageOverrideStore')
const { getZohoImagesBySkus, zohoNormalizeSkuKey } = require('./zohoItemImageLookupService')
const { MAX_CATALOG_IMAGE_ASINS_PER_REQUEST, MAX_CATALOG_IMAGE_ENRICHMENT_BATCHES } = require('../config/amazonSpApiGuardrails')

const MAX_ASINS_PER_API_REQUEST = MAX_CATALOG_IMAGE_ASINS_PER_REQUEST
/** Max catalog API round-trips per caller request (batch size × rounds caps total ASINs refreshed). */
const MAX_CATALOG_API_ASINS_PER_DASHBOARD = MAX_CATALOG_IMAGE_ASINS_PER_REQUEST
const MAX_CATALOG_ENRICHMENT_ROUNDS = Math.max(1, parseInt(String(MAX_CATALOG_IMAGE_ENRICHMENT_BATCHES), 10) || 15)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const CATALOG_INCLUDED_DATA = 'summaries,images'
const DEFAULT_IMAGE_FETCH_FAIL_MESSAGE = 'Catalog image lookup failed or returned no image'

function catalogMarketplaceKeyForImages(dashboardMarketplaceKey) {
  return dashboardMarketplaceKey === 'ksa' ? 'ksa' : 'uae'
}

/** Composite key matching grouped `urlByAsin` from resolveCatalogPrimaryImagesByAsinWithCache. */
function catalogImageLookupKey(catalogMk, asin) {
  const mk = catalogMk === 'ksa' ? 'ksa' : 'uae'
  const a = normalizeAsin(asin)
  return a ? `${mk}|${a}` : ''
}

function normalizeAsin(a) {
  const s = String(a || '').trim().toUpperCase()
  if (s.length < 10 || s.length > 32) return ''
  return s
}

function isSafeAmazonImageUrl(u) {
  if (u == null || typeof u !== 'string') return null
  let t = u.trim()
  if (t.startsWith('//')) t = `https:${t}`
  if (/^http:\/\//i.test(t)) t = t.replace(/^http:\/\//i, 'https://')
  if (t.length < 12 || t.length > 2048) return null
  if (!/^https:\/\//i.test(t)) return null
  let host = ''
  try {
    host = new URL(t).hostname.toLowerCase()
  } catch {
    return null
  }
  const ok =
    host.endsWith('media-amazon.com') ||
    host.endsWith('ssl-images-amazon.com') ||
    host.endsWith('ssl-images-amazon.de') ||
    host.endsWith('images-amazon.com') ||
    host.endsWith('images-na.ssl-images-amazon.com') ||
    host.endsWith('images-eu.ssl-images-amazon.com') ||
    host === 'ecx.images-amazon.com'
  return ok ? t : null
}

function pickImageLinkFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null
  const stringUrlKeys = ['link', 'url', 'resourceUrl', 'href', 'src', 'uri']
  for (const k of stringUrlKeys) {
    if (typeof obj[k] === 'string' && obj[k].trim()) {
      const u = isSafeAmazonImageUrl(obj[k])
      if (u) return u
    }
  }
  for (const k of ['large', 'medium', 'small', 'hires', 'highRes', 'lowRes']) {
    const inner = obj[k]
    if (inner && typeof inner === 'object') {
      const u = pickImageLinkFromObject(inner)
      if (u) return u
    }
  }
  return null
}

/**
 * Walk `images` tree when structure differs slightly (extra nesting, alternate keys).
 * @param {unknown} node
 * @param {number} depth
 * @returns {string|null}
 */
function extractImageUrlFromImagesTree(node, depth = 0) {
  if (depth > 8 || node == null) return null
  if (typeof node === 'string') {
    const u = isSafeAmazonImageUrl(node)
    return u
  }
  if (Array.isArray(node)) {
    for (const el of node) {
      const u = extractImageUrlFromImagesTree(el, depth + 1)
      if (u) return u
    }
    return null
  }
  if (typeof node === 'object') {
    const direct = pickImageLinkFromObject(node)
    if (direct) return direct
    for (const k of Object.keys(node)) {
      const u = extractImageUrlFromImagesTree(node[k], depth + 1)
      if (u) return u
    }
  }
  return null
}
/**
 * Best-effort extraction from Catalog Items API (summaries + images datasets).
 * @param {object} item
 * @returns {string|null}
 */
function extractMainImageUrl(item) {
  if (!item || typeof item !== 'object') return null

  const summaries = item.summaries
  if (Array.isArray(summaries)) {
    for (const sm of summaries) {
      if (!sm || typeof sm !== 'object') continue
      const m = sm.mainImage || sm.primaryImage
      if (m && typeof m === 'object') {
        const u = pickImageLinkFromObject(m)
        if (u) return u
      }
      const smImages = sm.images
      if (Array.isArray(smImages)) {
        for (const block of smImages) {
          if (!block || typeof block !== 'object') continue
          const innerList = block.images
          if (Array.isArray(innerList)) {
            for (const img of innerList) {
              const u = img && typeof img === 'object' ? pickImageLinkFromObject(img) : null
              if (u) return u
            }
          }
          const u = pickImageLinkFromObject(block) || extractImageUrlFromImagesTree(block, 0)
          if (u) return u
        }
      }
    }
  }

  const rawImages = item.images
  if (rawImages && typeof rawImages === 'object' && !Array.isArray(rawImages)) {
    const u = pickImageLinkFromObject(rawImages) || extractImageUrlFromImagesTree(rawImages, 0)
    if (u) return u
  }

  const images = Array.isArray(rawImages) ? rawImages : null
  if (Array.isArray(images)) {
    for (const block of images) {
      if (!block || typeof block !== 'object') continue
      const innerList = block.images
      if (Array.isArray(innerList)) {
        const preferred = ['MAIN', 'MAIN_SHOT', 'PT01', 'PT02', 'FRONT', 'PRIMARY']
        for (const variant of preferred) {
          for (const img of innerList) {
            if (!img || typeof img !== 'object') continue
            const v = String(img.variant || '').toUpperCase()
            if (v === variant) {
              const u = pickImageLinkFromObject(img)
              if (u) return u
            }
          }
        }
        for (const img of innerList) {
          const u = pickImageLinkFromObject(img)
          if (u) return u
        }
      }
      const u = pickImageLinkFromObject(block) || extractImageUrlFromImagesTree(block, 0)
      if (u) return u
    }
  }

  return null
}

function firstSummary(item) {
  if (!item || typeof item !== 'object') return null
  const summaries = item.summaries
  if (!Array.isArray(summaries) || summaries.length === 0) return null
  const sm = summaries[0]
  return sm && typeof sm === 'object' ? sm : null
}

function extractTitle(item) {
  const sm = firstSummary(item)
  if (!sm || typeof sm.itemName !== 'string') return null
  const t = sm.itemName.trim()
  return t ? t.slice(0, 2000) : null
}

function extractBrand(item) {
  const sm = firstSummary(item)
  if (!sm || typeof sm.brand !== 'string') return null
  const t = sm.brand.trim()
  return t ? t.slice(0, 512) : null
}

/**
 * Safe diagnostics for one Catalog Items `items[]` element (no secrets, no full URLs).
 * @param {object|null|undefined} item
 */
function describeCatalogItemImageShapeSafe(item) {
  const hostFromString = (s) => {
    if (typeof s !== 'string' || !/^https?:\/\//i.test(s.trim())) return null
    let t = s.trim()
    if (t.startsWith('//')) t = `https:${t}`
    if (/^http:\/\//i.test(t)) t = t.replace(/^http:\/\//i, 'https://')
    try {
      return new URL(t).hostname.toLowerCase()
    } catch {
      return '(unparseable)'
    }
  }

  const base = {
    asin: item?.asin != null ? String(item.asin).trim().toUpperCase() : null,
    shapeItemIsObject: Boolean(item && typeof item === 'object'),
    summariesExists: false,
    summaries0MainImageExists: false,
    summaries0MainImageKeys: [],
    imagesExists: false,
    imagesArrayLength: 0,
    firstImageBlockKeys: [],
    firstNestedImagesKeys: [],
    objectKeyEndingLinkOrUrlExists: false,
    pathCandidatesHostOnly: [],
    extractedImageHostViaExtractMainImageUrl: null,
  }

  if (!item || typeof item !== 'object') return base

  const summaries = item.summaries
  base.summariesExists = Array.isArray(summaries)
  const sm0 = Array.isArray(summaries) && summaries[0] && typeof summaries[0] === 'object' ? summaries[0] : null
  if (sm0) {
    const mi = sm0.mainImage || sm0.primaryImage
    if (mi && typeof mi === 'object') {
      base.summaries0MainImageExists = true
      base.summaries0MainImageKeys = Object.keys(mi).sort()
    }
  }

  const rawImg = item.images
  if (rawImg && typeof rawImg === 'object' && !Array.isArray(rawImg)) {
    base.imagesExists = true
    base.imagesArrayLength = 1
    base.firstImageBlockKeys = Object.keys(rawImg).sort()
    const inner = rawImg.images
    if (Array.isArray(inner) && inner[0] && typeof inner[0] === 'object') {
      base.firstNestedImagesKeys = Object.keys(inner[0]).sort()
    }
  } else if (Array.isArray(rawImg)) {
    base.imagesExists = true
    base.imagesArrayLength = rawImg.length
    const b0 = rawImg[0]
    if (b0 && typeof b0 === 'object') {
      base.firstImageBlockKeys = Object.keys(b0).sort()
      const inner = b0.images
      if (Array.isArray(inner) && inner[0] && typeof inner[0] === 'object') {
        base.firstNestedImagesKeys = Object.keys(inner[0]).sort()
      }
    }
  }

  const cand = new Map()

  function walk(node, pth, depth) {
    if (depth > 16 || node == null) return
    if (typeof node === 'string') {
      const h = hostFromString(node)
      if (h && pth) cand.set(pth, h)
      return
    }
    if (typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, `${pth}[${i}]`, depth + 1))
      return
    }
    for (const k of Object.keys(node)) {
      const lk = String(k).toLowerCase()
      if (lk.endsWith('link') || lk.endsWith('url')) base.objectKeyEndingLinkOrUrlExists = true
      const nextPath = pth ? `${pth}.${k}` : k
      const v = node[k]
      if (typeof v === 'string') {
        const h = hostFromString(v)
        if (h) cand.set(nextPath, h)
      } else {
        walk(v, nextPath, depth + 1)
      }
    }
  }

  walk(item, 'item', 0)

  base.pathCandidatesHostOnly = [...cand.entries()].slice(0, 40).map(([path, host]) => ({ path, host }))

  const extracted = extractMainImageUrl(item)
  base.extractedImageHostViaExtractMainImageUrl = extracted ? hostFromString(extracted) : null

  return base
}

/**
 * Small JSON blob for cache only (no secrets; trim summaries).
 * @param {object} item — catalog API item
 */
function buildRawSafeJson(item) {
  if (!item || typeof item !== 'object') return null
  const sm = firstSummary(item)
  if (!sm) return null
  const mainImage = sm.mainImage || sm.primaryImage
  const mi =
    mainImage && typeof mainImage === 'object'
      ? {
          link: typeof mainImage.link === 'string' ? mainImage.link.slice(0, 2048) : undefined,
          url: typeof mainImage.url === 'string' ? mainImage.url.slice(0, 2048) : undefined,
          resourceUrl:
            typeof mainImage.resourceUrl === 'string' ? mainImage.resourceUrl.slice(0, 2048) : undefined,
        }
      : undefined
  return {
    asin: item.asin != null ? String(item.asin).trim().toUpperCase() : undefined,
    summaries: [
      {
        marketplaceId: sm.marketplaceId != null ? String(sm.marketplaceId) : undefined,
        itemName: sm.itemName != null ? String(sm.itemName).slice(0, 2000) : undefined,
        brand: sm.brand != null ? String(sm.brand).slice(0, 512) : undefined,
        mainImage: mi,
      },
    ],
  }
}

function isFresh(lastSyncedAt) {
  if (!lastSyncedAt || !(lastSyncedAt instanceof Date) || Number.isNaN(lastSyncedAt.getTime())) return false
  return Date.now() - lastSyncedAt.getTime() < CACHE_TTL_MS
}

function debugCatalogImages(payload) {
  if (String(process.env.AMAZON_DEBUG_CATALOG_IMAGES || '').trim() !== '1') return
  try {
    console.log('[amazon-debug-catalog-images]', JSON.stringify(payload))
  } catch {
    console.log('[amazon-debug-catalog-images]', '(payload stringify failed)')
  }
}

/**
 * @param {'uae'|'ksa'} catalogMk — SP-API / cache marketplace for this batch
 * @param {Array<{ asin: string|null, sellerSku?: string|null }>} topSkuRows
 * @param {{ debugDashboardKey?: string }} [opts]
 */
async function resolveCatalogPrimaryImagesForCatalogMarketplace(catalogMk, topSkuRows, opts = {}) {
  const dbg = opts.debugDashboardKey != null ? opts.debugDashboardKey : catalogMk
  const ordered = []
  const seen = new Set()
  for (const r of topSkuRows || []) {
    const asin = normalizeAsin(r.asin)
    if (!asin || seen.has(asin)) continue
    seen.add(asin)
    const sku = r.sellerSku != null ? String(r.sellerSku).trim().slice(0, 512) : null
    ordered.push({ asin, sellerSku: sku || null })
  }

  const meta = {
    catalogMarketplaceKey: catalogMk,
    uniqueAsinCount: ordered.length,
    asinsServedFromFreshCache: 0,
    asinsServedFromStaleCache: 0,
    asinsSentToApi: 0,
    cacheTtlDays: 7,
  }

  const urlByAsin = Object.create(null)
  if (!ordered.length) {
    debugCatalogImages({
      debugLabel: String(dbg),
      catalogMarketplaceKey: catalogMk,
      topSkuAsinRowsIn: (topSkuRows || []).length,
      uniqueAsinCount: 0,
      freshCacheHits: 0,
      staleOrMissingCount: 0,
      sentToApi: 0,
      fetchedImageCount: 0,
      failedBatch: 0,
      imageFetchStatus: 'cache',
    })
    return { urlByAsin, imageFetchStatus: 'cache', imageFetchMessage: null, meta }
  }

  const allAsins = ordered.map((x) => x.asin)
  let cacheMap
  try {
    cacheMap = await catalogCache.getCatalogItemCacheByAsins(catalogMk, allAsins)
  } catch {
    cacheMap = new Map()
  }

  /** @type {{ asin: string, sellerSku: string|null, lastSyncedAt: Date|null }[]} */
  const needsApi = []

  for (const { asin, sellerSku } of ordered) {
    const row = cacheMap.get(asin)
    if (row && isFresh(row.lastSyncedAt)) {
      urlByAsin[asin] = row.imageUrl || null
      meta.asinsServedFromFreshCache += 1
      continue
    }
    if (row && row.imageUrl) {
      urlByAsin[asin] = row.imageUrl
      meta.asinsServedFromStaleCache += 1
    } else {
      urlByAsin[asin] = null
    }
    const lastSyncedAt = row?.lastSyncedAt || null
    needsApi.push({ asin, sellerSku, lastSyncedAt })
  }

  needsApi.sort((a, b) => {
    const ta = a.lastSyncedAt?.getTime?.() ?? 0
    const tb = b.lastSyncedAt?.getTime?.() ?? 0
    if (ta === tb) return 0
    if (ta === 0) return -1
    if (tb === 0) return 1
    return ta - tb
  })

  if (!needsApi.length) {
    const fetchedImageCount = allAsins.filter((a) => typeof urlByAsin[a] === 'string' && urlByAsin[a]).length
    debugCatalogImages({
      debugLabel: String(dbg),
      catalogMarketplaceKey: catalogMk,
      topSkuAsinRowsIn: (topSkuRows || []).length,
      uniqueAsinCount: ordered.length,
      freshCacheHits: meta.asinsServedFromFreshCache,
      staleOrMissingCount: 0,
      sentToApi: 0,
      fetchedImageCount,
      failedBatch: 0,
      imageFetchStatus: 'cache',
    })
    return { urlByAsin, imageFetchStatus: 'cache', imageFetchMessage: null, meta }
  }

  let remaining = needsApi.slice()
  let totalSentToApi = 0
  let catalogApiBatchCount = 0
  let anyHttpOk = false
  let terminalFailure = false
  let lastHttpStatus = 200

  for (let round = 0; round < MAX_CATALOG_ENRICHMENT_ROUNDS && remaining.length > 0; round += 1) {
    const toFetch = remaining.slice(0, MAX_CATALOG_API_ASINS_PER_DASHBOARD)
    const chunk = toFetch.map((x) => x.asin)
    const skuByAsin = Object.fromEntries(toFetch.map((x) => [x.asin, x.sellerSku]))
    const chunkSet = new Set(chunk)

    let status = 0
    let data = null
    try {
      const res = await searchAmazonCatalogItems({
        marketplaceKey: catalogMk,
        identifiers: chunk,
        identifiersType: 'ASIN',
        includedData: CATALOG_INCLUDED_DATA,
      })
      status = res.status
      data = res.data
    } catch {
      terminalFailure = true
      remaining = remaining.filter((r) => !chunkSet.has(r.asin))
      break
    }

    lastHttpStatus = status
    if (status !== 200 || !data || typeof data !== 'object') {
      terminalFailure = true
      remaining = remaining.filter((r) => !chunkSet.has(r.asin))
      break
    }

    totalSentToApi += chunk.length
    catalogApiBatchCount += 1
    anyHttpOk = true

    const items = Array.isArray(data.items) ? data.items : []
    const returned = new Set()
    const upserts = []
    for (const it of items) {
      const asin = it?.asin != null ? normalizeAsin(it.asin) : ''
      if (!asin) continue
      returned.add(asin)
      const imageUrl = extractMainImageUrl(it)
      if (imageUrl) {
        urlByAsin[asin] = imageUrl
      } else if (!urlByAsin[asin]) {
        urlByAsin[asin] = null
      }
      const title = extractTitle(it)
      const brand = extractBrand(it)
      const rawSafeJson = buildRawSafeJson(it)
      upserts.push({
        asin,
        sellerSku: skuByAsin[asin] || null,
        title,
        imageUrl,
        brand,
        rawSafeJson,
      })
    }

    try {
      await catalogCache.upsertCatalogItemCacheRows(catalogMk, upserts)
    } catch {
      /* non-fatal — URLs still returned in-memory for this response */
    }

    for (const asin of chunk) {
      if (!returned.has(asin)) {
        try {
          await catalogCache.touchCatalogItemCacheLastSynced(catalogMk, asin, skuByAsin[asin] || null)
        } catch {
          /* ignore */
        }
      }
    }

    remaining = remaining.filter((r) => !chunkSet.has(r.asin))
  }

  const fetchedImageCount = allAsins.filter((a) => typeof urlByAsin[a] === 'string' && urlByAsin[a]).length
  meta.asinsSentToApi = totalSentToApi
  meta.catalogApiBatchCount = catalogApiBatchCount

  let imageFetchStatus = 'fetched'
  let imageFetchMessage = null
  if (totalSentToApi === 0) {
    imageFetchStatus = 'cache'
  } else if (terminalFailure && !anyHttpOk) {
    imageFetchStatus = 'failed'
    imageFetchMessage = DEFAULT_IMAGE_FETCH_FAIL_MESSAGE
  }

  debugCatalogImages({
    debugLabel: String(dbg),
    catalogMarketplaceKey: catalogMk,
    topSkuAsinRowsIn: (topSkuRows || []).length,
    uniqueAsinCount: ordered.length,
    freshCacheHits: meta.asinsServedFromFreshCache,
    staleOrMissingCount: needsApi.length,
    sentToApi: totalSentToApi,
    catalogApiBatchCount,
    fetchedImageCount,
    failedBatch: terminalFailure && !anyHttpOk ? 1 : 0,
    httpStatus: lastHttpStatus,
    imageFetchStatus,
  })

  if (imageFetchStatus === 'failed') {
    return {
      urlByAsin,
      imageFetchStatus,
      imageFetchMessage,
      meta: { ...meta, statusCode: lastHttpStatus },
    }
  }

  return { urlByAsin, imageFetchStatus, imageFetchMessage: null, meta }
}

/**
 * Resolves images for top-SKU rows. When every row includes `catalogMarketplaceKey` ('uae'|'ksa'),
 * runs separate cache/API batches per region so KSA order lines use .sa catalog and UAE lines use .ae.
 * Returned `urlByAsin` keys are `"uae|B0…"` / `"ksa|B0…"`. Otherwise uses dashboard filter only (legacy plain ASIN keys).
 */
async function resolveCatalogPrimaryImagesByAsinWithCache(dashboardMarketplaceKey, topSkuRows) {
  const rows = topSkuRows || []
  const usePerRowMk =
    rows.length > 0 &&
    rows.every((r) => r && (r.catalogMarketplaceKey === 'uae' || r.catalogMarketplaceKey === 'ksa'))

  if (!usePerRowMk) {
    const mk = catalogMarketplaceKeyForImages(dashboardMarketplaceKey)
    return resolveCatalogPrimaryImagesForCatalogMarketplace(mk, rows, {
      debugDashboardKey: dashboardMarketplaceKey,
    })
  }

  const urlByAsin = Object.create(null)
  let imageFetchStatus = 'cache'
  let imageFetchMessage = null
  const metas = []

  const byMk = new Map()
  for (const r of rows) {
    const cmk = r.catalogMarketplaceKey === 'ksa' ? 'ksa' : 'uae'
    const asin = normalizeAsin(r.asin)
    if (!asin) continue
    if (!byMk.has(cmk)) byMk.set(cmk, [])
    const sku = r.sellerSku != null ? String(r.sellerSku).trim().slice(0, 512) : null
    byMk.get(cmk).push({ asin, sellerSku: sku || null })
  }

  for (const [cmk, mkRows] of byMk) {
    const out = await resolveCatalogPrimaryImagesForCatalogMarketplace(cmk, mkRows, {
      debugDashboardKey: dashboardMarketplaceKey,
    })
    metas.push(out.meta || {})
    for (const [asin, url] of Object.entries(out.urlByAsin)) {
      if (!asin) continue
      urlByAsin[`${cmk}|${asin}`] = url
    }
    if (out.imageFetchStatus === 'failed') {
      imageFetchStatus = 'failed'
      imageFetchMessage = out.imageFetchMessage || DEFAULT_IMAGE_FETCH_FAIL_MESSAGE
    } else if (out.imageFetchStatus === 'fetched' && imageFetchStatus === 'cache') {
      imageFetchStatus = 'fetched'
    }
  }

  return {
    urlByAsin,
    imageFetchStatus,
    imageFetchMessage,
    meta: { groupedByCatalogMarketplace: true, perMarketplace: metas },
  }
}

/**
 * Legacy direct API path (no DB reads). Prefer resolveCatalogPrimaryImagesByAsinWithCache for dashboard.
 * @param {string} dashboardMarketplaceKey
 * @param {string[]} asins
 * @returns {Promise<Record<string, string>>}
 */
async function resolveCatalogPrimaryImagesByAsin(dashboardMarketplaceKey, asins) {
  const mk = catalogMarketplaceKeyForImages(dashboardMarketplaceKey)
  const unique = []
  const seen = new Set()
  for (const a of asins || []) {
    const s = normalizeAsin(a)
    if (!s || seen.has(s)) continue
    seen.add(s)
    unique.push(s)
    if (unique.length >= MAX_CATALOG_API_ASINS_PER_DASHBOARD) break
  }
  const out = {}
  const chunk = unique.slice(0, MAX_ASINS_PER_API_REQUEST)
  if (!chunk.length) return out
  try {
    const { status, data } = await searchAmazonCatalogItems({
      marketplaceKey: mk,
      identifiers: chunk,
      identifiersType: 'ASIN',
      includedData: CATALOG_INCLUDED_DATA,
    })
    if (status !== 200 || !data || typeof data !== 'object') return out
    const items = Array.isArray(data.items) ? data.items : []
    for (const it of items) {
      const asin = it?.asin != null ? normalizeAsin(it.asin) : ''
      const url = extractMainImageUrl(it)
      if (asin && url) out[asin] = url
    }
  } catch {
    /* non-fatal */
  }
  return out
}

/**
 * Pick display line for an order: first line with a plausible ASIN, else first line.
 * @param {object} order — shape from `selectCachedOrdersWithItems` (items[].ASIN, SellerSKU, Title)
 * @returns {{ sellerSku: string|null, asin: string|null, title: string|null }}
 */
function pickPrimaryLineItemFromOrder(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  const normalizeTitle = (t) => {
    if (t == null || typeof t !== 'string') return null
    const s = t.trim()
    return s ? s.slice(0, 500) : null
  }
  const lineToPrimary = (it) => {
    if (!it || typeof it !== 'object') return { sellerSku: null, asin: null, title: null }
    const skuRaw = it.SellerSKU != null ? String(it.SellerSKU).trim() : ''
    const asinRaw = it.ASIN != null ? String(it.ASIN).trim().toUpperCase() : ''
    const asin = normalizeAsin(asinRaw)
    return {
      sellerSku: skuRaw ? skuRaw.slice(0, 512) : null,
      asin: asin || null,
      title: normalizeTitle(it.Title),
    }
  }
  for (const it of items) {
    const p = lineToPrimary(it)
    if (p.asin) return p
  }
  if (items.length) return lineToPrimary(items[0])
  return { sellerSku: null, asin: null, title: null }
}

/**
 * Adds `primaryItem: { sellerSku, asin, title, imageUrl }` to each order using DB catalog cache + batched catalog API (same limits as dashboard).
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {object[]} orders
 * @param {boolean} includeSkuImages
 */
async function enrichOrdersWithPrimaryItemImages(marketplaceKey, orders, includeSkuImages) {
  const mk = marketplaceKey === 'ksa' ? 'ksa' : 'uae'
  const list = Array.isArray(orders) ? orders : []
  if (!includeSkuImages) {
    return list.map((o) => {
      const pi = pickPrimaryLineItemFromOrder(o)
      return {
        ...o,
        primaryItem: {
          sellerSku: pi.sellerSku,
          asin: pi.asin,
          title: pi.title,
          imageUrl: null,
          imageSource: 'none',
          zohoItemId: null,
        },
      }
    })
  }
  const rowsForCatalog = []
  const rowsForOverride = []
  for (const o of list) {
    const pi = pickPrimaryLineItemFromOrder(o)
    rowsForOverride.push({ sellerSku: pi.sellerSku, asin: pi.asin })
    if (pi.asin) {
      rowsForCatalog.push({ asin: pi.asin, sellerSku: pi.sellerSku, catalogMarketplaceKey: mk })
    }
  }
  let urlByKey = Object.create(null)
  if (rowsForCatalog.length) {
    try {
      const out = await resolveCatalogPrimaryImagesByAsinWithCache(mk, rowsForCatalog)
      urlByKey = out.urlByAsin && typeof out.urlByAsin === 'object' ? out.urlByAsin : {}
    } catch {
      urlByKey = Object.create(null)
    }
  }
  let overrideByLineKey = new Map()
  try {
    overrideByLineKey = await batchResolveSkuImageOverrides(mk, rowsForOverride)
  } catch {
    overrideByLineKey = new Map()
  }

  const zohoSkuInputs = []
  for (const r of rowsForOverride) {
    const s = r.sellerSku != null ? String(r.sellerSku).trim() : ''
    if (s && s !== '(no sku)') zohoSkuInputs.push(s)
  }
  let zohoBySku = new Map()
  try {
    zohoBySku = await getZohoImagesBySkus({ skus: [...new Set(zohoSkuInputs)] })
  } catch {
    zohoBySku = new Map()
  }

  return list.map((o) => {
    const pi = pickPrimaryLineItemFromOrder(o)
    const key = catalogImageLookupKey(mk, pi.asin)
    const raw =
      key && Object.prototype.hasOwnProperty.call(urlByKey, key) ? urlByKey[key] : null
    const rawStr = typeof raw === 'string' && raw.trim().toLowerCase().startsWith('http') ? raw.trim() : null
    const fromCatalog = rawStr && isSafeAmazonImageUrl(rawStr)
    let imageUrl = fromCatalog || null
    let imageSource = fromCatalog ? 'amazon_catalog' : 'none'
    let zohoItemId = null

    if (!imageUrl) {
      const skuForZoho = pi.sellerSku != null ? String(pi.sellerSku).trim() : ''
      if (skuForZoho && skuForZoho !== '(no sku)') {
        const z = zohoBySku.get(zohoNormalizeSkuKey(skuForZoho))
        if (z && z.imageUrl) {
          imageUrl = z.imageUrl
          imageSource = 'zoho_item'
          zohoItemId = z.itemId
        }
      }
    }

    if (!imageUrl) {
      const asinN = normalizeAsin(pi.asin || '')
      const skuN = pi.sellerSku != null ? String(pi.sellerSku).trim().slice(0, 512) : ''
      const ovKey = `${skuN}\t${asinN}`
      const hit = overrideByLineKey.get(ovKey)
      if (hit && hit.imageUrl) {
        imageUrl = hit.imageUrl
        imageSource = hit.imageSource === 'asin_override' ? 'asin_override' : 'sku_override'
      }
    }
    return {
      ...o,
      primaryItem: {
        sellerSku: pi.sellerSku,
        asin: pi.asin,
        title: pi.title,
        imageUrl,
        imageSource,
        zohoItemId,
      },
    }
  })
}

/**
 * One ASIN: always calls Search Catalog Items (bypasses cache TTL), then upserts `amazon_catalog_item_cache`
 * with `forceReplaceImageUrl` so a null image from Amazon clears a stale thumbnail.
 * Spacing and logging use the same `searchAmazonCatalogItems` path as production.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {string} asin
 * @param {string|null} [sellerSku]
 * @returns {Promise<{
 *   liveCatalogCalled: boolean,
 *   liveCatalogStatus: 'success'|'failed'|'skipped',
 *   httpStatus: number,
 *   itemsReturned: number,
 *   catalogItemMatched: boolean,
 *   imageUrl: string|null,
 *   imageFoundFromLive: boolean,
 *   reasonAfterLiveRefetch: string,
 *   catalogItem: object|null,
 *   safeError: string|null
 * }>}
 */
async function forceRefreshCatalogPrimaryImageForAsin(marketplaceKey, asin, sellerSku = null) {
  const mk = catalogCache.normalizeCatalogCacheMarketplaceKey(marketplaceKey)
  const a = normalizeAsin(asin)
  if (!a) {
    return {
      liveCatalogCalled: false,
      liveCatalogStatus: 'skipped',
      httpStatus: 0,
      itemsReturned: 0,
      catalogItemMatched: false,
      imageUrl: null,
      imageFoundFromLive: false,
      reasonAfterLiveRefetch: null,
      catalogItem: null,
      safeError: 'invalid_asin',
    }
  }

  let httpStatus = 0
  let data = null
  try {
    const res = await searchAmazonCatalogItems({
      marketplaceKey: mk,
      identifiers: [a],
      identifiersType: 'ASIN',
      includedData: CATALOG_INCLUDED_DATA,
    })
    httpStatus = res.status
    data = res.data
  } catch (e) {
    return {
      liveCatalogCalled: true,
      liveCatalogStatus: 'failed',
      httpStatus: 0,
      itemsReturned: 0,
      catalogItemMatched: false,
      imageUrl: null,
      imageFoundFromLive: false,
      reasonAfterLiveRefetch: 'LIVE_CATALOG_FAILED',
      catalogItem: null,
      safeError: String(e?.message || e).slice(0, 240),
    }
  }

  if (httpStatus !== 200 || !data || typeof data !== 'object') {
    return {
      liveCatalogCalled: true,
      liveCatalogStatus: 'failed',
      httpStatus,
      itemsReturned: 0,
      catalogItemMatched: false,
      imageUrl: null,
      imageFoundFromLive: false,
      reasonAfterLiveRefetch: 'LIVE_CATALOG_FAILED',
      catalogItem: null,
      safeError: null,
    }
  }

  const items = Array.isArray(data.items) ? data.items : []
  const matched = items.find((it) => normalizeAsin(it?.asin) === a) || null

  if (!matched) {
    return {
      liveCatalogCalled: true,
      liveCatalogStatus: 'success',
      httpStatus,
      itemsReturned: items.length,
      catalogItemMatched: false,
      imageUrl: null,
      imageFoundFromLive: false,
      reasonAfterLiveRefetch: 'LIVE_CATALOG_NO_IMAGE',
      catalogItem: null,
      safeError: null,
    }
  }

  const imageUrl = extractMainImageUrl(matched)
  const shapeInfo = describeCatalogItemImageShapeSafe(matched)
  const hasHttpsCandidates = (shapeInfo.pathCandidatesHostOnly || []).length > 0
  let reasonAfterLiveRefetch = 'LIVE_CATALOG_NO_IMAGE'
  if (imageUrl) {
    reasonAfterLiveRefetch = 'IMAGE_AVAILABLE_BACKEND'
  } else if (hasHttpsCandidates) {
    reasonAfterLiveRefetch = 'PARSER_NO_IMAGE_PATH'
  }

  const sku =
    sellerSku != null && String(sellerSku).trim() ? String(sellerSku).trim().slice(0, 512) : null

  try {
    await catalogCache.upsertCatalogItemCacheRows(
      mk,
      [
        {
          asin: a,
          sellerSku: sku,
          title: extractTitle(matched),
          brand: extractBrand(matched),
          imageUrl,
          rawSafeJson: buildRawSafeJson(matched),
        },
      ],
      { forceReplaceImageUrl: true }
    )
  } catch (e) {
    return {
      liveCatalogCalled: true,
      liveCatalogStatus: 'failed',
      httpStatus,
      itemsReturned: items.length,
      catalogItemMatched: true,
      imageUrl,
      imageFoundFromLive: Boolean(imageUrl),
      reasonAfterLiveRefetch: 'LIVE_CATALOG_FAILED',
      catalogItem: matched,
      safeError: String(e?.message || e).slice(0, 240),
    }
  }

  return {
    liveCatalogCalled: true,
    liveCatalogStatus: 'success',
    httpStatus,
    itemsReturned: items.length,
    catalogItemMatched: true,
    imageUrl,
    imageFoundFromLive: Boolean(imageUrl),
    reasonAfterLiveRefetch,
    catalogItem: matched,
    safeError: null,
  }
}

/**
 * Admin/test: one ASIN through cache (read fresh row, optionally force API via stale bypass by deleting row in DB only).
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {string} asin
 */
async function fetchCatalogItemSnapshotForTest(marketplaceKey, asin) {
  const a = normalizeAsin(asin)
  if (!a) return { ok: false, error: 'invalid_asin' }
  const mk = catalogCache.normalizeCatalogCacheMarketplaceKey(marketplaceKey)
  const before = await catalogCache.getCatalogItemCacheByAsins(mk, [a])
  const hadRow = before.has(a)
  const wasFresh = hadRow && isFresh(before.get(a).lastSyncedAt)

  const { urlByAsin, imageFetchStatus, imageFetchMessage, meta } = await resolveCatalogPrimaryImagesForCatalogMarketplace(
    mk,
    [{ asin: a, sellerSku: null }],
    { debugDashboardKey: mk }
  )

  const after = await catalogCache.getCatalogItemCacheByAsins(mk, [a])
  const row = after.get(a) || null

  return {
    ok: true,
    marketplaceKey: mk,
    asin: a,
    hadRowBefore: hadRow,
    wasFreshBefore: wasFresh,
    imageFetchStatus,
    imageFetchMessage: imageFetchMessage || null,
    imageUrl: urlByAsin[a] || null,
    cached: row
      ? {
          title: row.title,
          brand: row.brand,
          lastSyncedAt: row.lastSyncedAt.toISOString(),
        }
      : null,
    meta,
  }
}

module.exports = {
  enrichOrdersWithPrimaryItemImages,
  pickPrimaryLineItemFromOrder,
  resolveCatalogPrimaryImagesByAsin,
  resolveCatalogPrimaryImagesByAsinWithCache,
  resolveCatalogPrimaryImagesForCatalogMarketplace,
  catalogImageLookupKey,
  fetchCatalogItemSnapshotForTest,
  forceRefreshCatalogPrimaryImageForAsin,
  catalogMarketplaceKeyForImages,
  extractMainImageUrl,
  describeCatalogItemImageShapeSafe,
  extractTitle,
  extractBrand,
  buildRawSafeJson,
  CACHE_TTL_MS,
  MAX_CATALOG_API_ASINS_PER_DASHBOARD,
  CATALOG_INCLUDED_DATA,
  isSafeAmazonImageUrl,
}
