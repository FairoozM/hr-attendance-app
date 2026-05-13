/**
 * Batch resolve Zoho Inventory thumbnails by seller SKU for Amazon UI fallbacks.
 * Uses the same in-memory SKU map as Zoho item image tools (30 min TTL); no per-SKU Zoho HTTP.
 * Image URLs point at GET /api/amazon/zoho-item-images/:itemId (requireAuth — same gate as Amazon orders).
 */

const { getZohoInventorySkuMap, _internals } = require('../controllers/zohoItemImagesController')
const { REPRESENTATIVE_IMAGE_CACHE_VERSION } = require('./zohoRepresentativeItem')

const { extractImageReference } = _internals

const MAX_SKUS = 1500

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

/** Aligns with Zoho item image controller map keys (trim + lowercase). */
function zohoNormalizeSkuKey(value) {
  return cleanSku(value).toLowerCase()
}

function pickItemId(item) {
  return cleanSku(item && (item.item_id || item.id || item.zoho_representative_item_id))
}

function pickItemName(item) {
  return cleanSku(
    item && (item.name || item.item_name || item.description || item.zoho_representative_name || item.family),
  )
}

function amazonZohoImagePath(itemId) {
  const id = encodeURIComponent(String(itemId).trim())
  return `/api/amazon/zoho-item-images/${id}?r=${REPRESENTATIVE_IMAGE_CACHE_VERSION}`
}

/**
 * @param {{ skus?: string[] }} opts
 * @returns {Promise<Map<string, { imageUrl: string, itemId: string, itemName: string, source: 'zoho' }>>}
 * Map key: `zohoNormalizeSkuKey(sku)` (lowercase trimmed).
 */
async function getZohoImagesBySkus(opts = {}) {
  const map = new Map()
  const raw = Array.isArray(opts.skus) ? opts.skus : []
  const seen = new Set()
  const unique = []
  for (const s of raw) {
    const trimmed = cleanSku(s)
    if (!trimmed) continue
    const k = zohoNormalizeSkuKey(trimmed)
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(trimmed)
    if (unique.length >= MAX_SKUS) break
  }
  if (!unique.length) return map

  let skuMap
  try {
    skuMap = await getZohoInventorySkuMap()
  } catch {
    return map
  }

  for (const sku of unique) {
    const item = skuMap.get(zohoNormalizeSkuKey(sku))
    if (!item) continue
    const itemId = pickItemId(item)
    if (!itemId) continue
    const ref = extractImageReference(item)
    if (!ref) continue

    map.set(zohoNormalizeSkuKey(sku), {
      imageUrl: amazonZohoImagePath(itemId),
      itemId: String(itemId),
      itemName: pickItemName(item).slice(0, 512),
      source: 'zoho',
    })
  }
  return map
}

module.exports = {
  getZohoImagesBySkus,
  zohoNormalizeSkuKey,
  amazonZohoImagePath,
}
