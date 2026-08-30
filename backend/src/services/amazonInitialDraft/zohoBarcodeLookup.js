'use strict'

/**
 * Exact-SKU Zoho barcode lookup for the Amazon Initial Draft Generator.
 *
 * Reuses the existing Zoho Inventory client and the zoho_item_cache table. Matching is
 * exact on the trimmed SKU string (no fuzzy expansion). The Zoho barcode itself is never
 * rewritten — only read as text for the GTIN transform step.
 */

const { readZohoConfig, INVENTORY_V1 } = require('../../integrations/zoho/zohoConfig')
const { fetchItemById } = require('../../integrations/zoho/zohoInventoryClient')
const { zohoInventoryJsonRequest } = require('../zohoApiClient')
const { findItemsBySkus } = require('../zohoBulkInvoiceStore')

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

function extractBarcodeText(item) {
  if (!item || typeof item !== 'object') return ''
  const rawJson = item.raw_json && typeof item.raw_json === 'object' ? item.raw_json : null
  const candidates = [item.upc, item.ean, item.isbn, rawJson?.upc, rawJson?.ean, rawJson?.isbn]
  for (const candidate of candidates) {
    const text = String(candidate == null ? '' : candidate).trim()
    if (text) return text
  }
  return ''
}

function pickExactSkuMatches(items, sku) {
  const needle = cleanSku(sku)
  if (!needle) return []
  return (Array.isArray(items) ? items : []).filter((item) => cleanSku(item?.sku) === needle)
}

async function searchZohoItemsByExactSku(sku) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const err = new Error('Zoho is not configured on the server.')
    err.code = 'ZOHO_NOT_CONFIGURED'
    throw err
  }
  const needle = cleanSku(sku)
  if (!needle) return []

  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  p.set('search_text', needle)
  p.set('page', '1')
  p.set('per_page', '25')
  if (String(process.env.ZOHO_ITEMS_INCLUDE_INACTIVE || '').trim() !== '1') {
    p.set('filter_by', 'Status.Active')
  }

  const json = await zohoInventoryJsonRequest(`${INVENTORY_V1}/items`, p, 'GET', undefined, {
    source: 'amazon_initial_draft_zoho_barcode_search',
    skipCache: true,
  })
  return pickExactSkuMatches(Array.isArray(json?.items) ? json.items : [], needle)
}

/**
 * @param {string} sku
 * @returns {Promise<{
 *   sku: string,
 *   status: 'found'|'not-found'|'ambiguous'|'error'|'zoho-not-configured',
 *   zohoSku: string,
 *   itemId: string,
 *   barcode: string,
 *   reason: string|null,
 * }>}
 */
async function lookupZohoBarcodeByExactSku(sku) {
  const needle = cleanSku(sku)
  if (!needle) {
    return {
      sku: '',
      status: 'not-found',
      zohoSku: '',
      itemId: '',
      barcode: '',
      reason: 'sku-blank',
    }
  }

  try {
    const cached = pickExactSkuMatches(await findItemsBySkus([needle]), needle)
    if (cached.length > 1) {
      return {
        sku: needle,
        status: 'ambiguous',
        zohoSku: '',
        itemId: '',
        barcode: '',
        reason: 'zoho-sku-ambiguous',
      }
    }

    let item = cached[0] || null
    if (item?.item_id) {
      try {
        const detail = await fetchItemById(String(item.item_id), {
          source: 'amazon_initial_draft_zoho_barcode_detail',
        })
        if (detail && cleanSku(detail.sku) === needle) item = detail
      } catch {
        // Fall through to the cached row — upc may already be present on raw_json.
      }
    }

    if (!item) {
      const c = readZohoConfig()
      if (c.code !== 'ok') {
        return {
          sku: needle,
          status: 'zoho-not-configured',
          zohoSku: '',
          itemId: '',
          barcode: '',
          reason: 'zoho-not-configured',
        }
      }

      const searched = await searchZohoItemsByExactSku(needle)
      if (searched.length > 1) {
        return {
          sku: needle,
          status: 'ambiguous',
          zohoSku: '',
          itemId: '',
          barcode: '',
          reason: 'zoho-sku-ambiguous',
        }
      }
      if (searched.length === 1 && searched[0].item_id) {
        const detail = await fetchItemById(String(searched[0].item_id), {
          source: 'amazon_initial_draft_zoho_barcode_detail',
        })
        if (detail && cleanSku(detail.sku) === needle) item = detail
        else if (cleanSku(searched[0].sku) === needle) item = searched[0]
      }
    }

    if (!item) {
      return {
        sku: needle,
        status: 'not-found',
        zohoSku: '',
        itemId: '',
        barcode: '',
        reason: 'zoho-sku-not-found',
      }
    }

    return {
      sku: needle,
      status: 'found',
      zohoSku: cleanSku(item.sku),
      itemId: item.item_id != null ? String(item.item_id) : '',
      barcode: extractBarcodeText(item),
      reason: null,
    }
  } catch (err) {
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return {
        sku: needle,
        status: 'zoho-not-configured',
        zohoSku: '',
        itemId: '',
        barcode: '',
        reason: 'zoho-not-configured',
      }
    }
    return {
      sku: needle,
      status: 'error',
      zohoSku: '',
      itemId: '',
      barcode: '',
      reason: (err && err.message) || 'zoho-lookup-failed',
    }
  }
}

/**
 * Batch lookup. One Zoho round-trip path per distinct SKU.
 * @param {string[]} skus
 * @returns {Promise<Map<string, object>>}
 */
async function lookupZohoBarcodesByExactSkus(skus) {
  const unique = []
  const seen = new Set()
  for (const sku of Array.isArray(skus) ? skus : []) {
    const clean = cleanSku(sku)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    unique.push(clean)
  }

  const map = new Map()
  for (const sku of unique) {
    map.set(sku, await lookupZohoBarcodeByExactSku(sku))
  }
  return map
}

module.exports = {
  extractBarcodeText,
  lookupZohoBarcodeByExactSku,
  lookupZohoBarcodesByExactSkus,
  pickExactSkuMatches,
}
