#!/usr/bin/env node
/**
 * Safe summary of Amazon primary-line image resolution (catalog → Zoho SKU → override).
 *
 * Usage:
 *   node scripts/debug-amazon-zoho-images.js uae
 *   node scripts/debug-amazon-zoho-images.js ksa
 *   node scripts/debug-amazon-zoho-images.js uae LIFEP7-MIX-29-1-GREEN
 *   npm run debug:amazon-zoho-images -- uae
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const ordersSync = require('../src/services/amazonOrdersSyncService')
const catalogCache = require('../src/services/amazonCatalogItemCacheStore')
const { getZohoImagesBySkus } = require('../src/services/zohoItemImageLookupService')
const { findBestSkuImageOverride } = require('../src/services/amazonSkuImageOverrideStore')
const { pickPrimaryLineItemFromOrder, isSafeAmazonImageUrl } = require('../src/services/amazonSkuImageService')
const { pool } = require('../src/db')

const MS_BEFORE_NOW = 130_000
const RANGE_MS = 7 * 24 * 60 * 60 * 1000

function hostOnly(u) {
  if (u == null || typeof u !== 'string' || !u.trim()) return null
  const t = u.trim()
  if (t.startsWith('/')) return '(relative-api-path)'
  try {
    return new URL(t).hostname
  } catch {
    return '(unparseable)'
  }
}

function orderMatchesSku(order, target) {
  const want = String(target || '').trim().toLowerCase()
  if (!want) return false
  const pi = pickPrimaryLineItemFromOrder(order)
  if (pi.sellerSku && String(pi.sellerSku).trim().toLowerCase() === want) return true
  const items = Array.isArray(order.items) ? order.items : []
  for (const it of items) {
    const s = it && it.SellerSKU != null ? String(it.SellerSKU).trim().toLowerCase() : ''
    if (s === want) return true
  }
  return false
}

async function debugSingleSku(mk, skuArg) {
  const sku = String(skuArg).trim()
  const now = Date.now()
  const createdBefore = new Date(now - MS_BEFORE_NOW)
  const createdAfter = new Date(now - RANGE_MS)
  const data = await ordersSync.getCachedAmazonOrders({
    marketplaceKey: mk,
    createdAfter,
    createdBefore,
    limit: 500,
    offset: 0,
    includeSkuImages: true,
  })
  const orders = data.orders || []
  const hit = orders.find((o) => orderMatchesSku(o, sku))
  const pi = hit ? hit.primaryItem : null
  const primary = hit ? pickPrimaryLineItemFromOrder(hit) : { sellerSku: sku, asin: null, title: null }

  let catalogHas = false
  if (primary.asin) {
    const m = await catalogCache.getCatalogItemCacheByAsins(mk, [String(primary.asin)])
    const row = m.get(String(primary.asin).trim().toUpperCase())
    catalogHas = !!(row && row.imageUrl && isSafeAmazonImageUrl(String(row.imageUrl)))
  }

  const zMap = await getZohoImagesBySkus({ skus: [sku] }).catch(() => new Map())
  const zKey = String(sku).trim().toLowerCase()
  const z = zMap.get(zKey)
  const ov = await findBestSkuImageOverride({
    marketplaceKey: mk,
    sellerSku: sku,
    asin: primary.asin,
  }).catch(() => ({ imageUrl: null, imageSource: null }))

  const out = {
    mode: 'single_sku',
    marketplaceKey: mk,
    sellerSku: sku,
    amazonOrderFound: Boolean(hit),
    amazonOrderId: hit && hit.amazonOrderId ? String(hit.amazonOrderId) : null,
    primaryAsin: primary.asin || null,
    primaryTitlePreview: primary.title ? String(primary.title).slice(0, 80) : null,
    amazonCatalogImageInCache: catalogHas,
    zohoSkuMatchExists: zMap.has(zKey),
    zohoImageMetadataExists: !!(z && z.imageUrl),
    zohoItemId: z && z.itemId ? String(z.itemId) : null,
    overrideExists: !!(ov && ov.imageUrl),
    resolvedFromEnrichedPrimary: pi
      ? {
          imageSource: pi.imageSource || null,
          imageHostOnly: hostOnly(pi.imageUrl),
          zohoItemId: pi.zohoItemId != null ? String(pi.zohoItemId) : null,
        }
      : null,
  }
  console.log(JSON.stringify(out, null, 2))
}

async function debugBatch(mk) {
  const now = Date.now()
  const createdBefore = new Date(now - MS_BEFORE_NOW)
  const createdAfter = new Date(now - RANGE_MS)
  const data = await ordersSync.getCachedAmazonOrders({
    marketplaceKey: mk,
    createdAfter,
    createdBefore,
    limit: 200,
    offset: 0,
    includeSkuImages: true,
  })
  const orders = data.orders || []
  const skus = new Set()
  let amazonCatalog = 0
  let zoho = 0
  let override = 0
  let none = 0
  const samples = []

  for (const o of orders) {
    const pi = o.primaryItem && typeof o.primaryItem === 'object' ? o.primaryItem : null
    if (!pi) continue
    if (pi.sellerSku) skus.add(String(pi.sellerSku).trim())
    const src = pi.imageSource || 'none'
    if (src === 'amazon_catalog') amazonCatalog += 1
    else if (src === 'zoho_item') zoho += 1
    else if (src === 'sku_override' || src === 'asin_override') override += 1
    else none += 1

    if (samples.length < 12 && pi.sellerSku) {
      samples.push({
        sellerSku: String(pi.sellerSku).slice(0, 80),
        asin: pi.asin || null,
        hasAmazonImage: src === 'amazon_catalog',
        hasZohoImage: src === 'zoho_item',
        hasOverrideImage: src === 'sku_override' || src === 'asin_override',
        finalImageSource: src,
        imageHostOnly: hostOnly(pi.imageUrl),
        titlePreview: pi.title ? String(pi.title).slice(0, 60) : null,
      })
    }
  }

  const out = {
    marketplaceKey: mk,
    dateWindowNote: '~7d purchase_date window ending now−130s',
    amazonRowsChecked: orders.length,
    skusChecked: skus.size,
    amazonCatalogImagesFound: amazonCatalog,
    zohoImagesFound: zoho,
    overrideImagesFound: override,
    stillMissingImages: none,
    sampleRows: samples,
  }
  console.log(JSON.stringify(out, null, 2))
}

async function main() {
  const mkArg = (process.argv[2] || 'uae').trim().toLowerCase()
  const mk = mkArg === 'ksa' ? 'ksa' : 'uae'
  const third = process.argv[3]
  if (third && String(third).trim()) {
    await debugSingleSku(mk, third)
  } else {
    await debugBatch(mk)
  }
}

main()
  .catch((e) => {
    console.error(e?.message || e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => {}))
