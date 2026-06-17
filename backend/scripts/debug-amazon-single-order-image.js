#!/usr/bin/env node
/**
 * Diagnose why one cached Amazon order line has no thumbnail on the Orders page.
 * Default: local DB/cache reads only.
 * --refetch: always one live Search Catalog Items call for the line ASIN (ignores cache TTL), then upserts cache.
 * --shape (requires --refetch): print safe response shape from that same live item (no second catalog call).
 *
 * Usage:
 *   node scripts/debug-amazon-single-order-image.js <uae|ksa> <amazonOrderId> <sellerSku>
 *   node scripts/debug-amazon-single-order-image.js uae 407-7802870-0764303 ZDS-2-10L --refetch
 *   node scripts/debug-amazon-single-order-image.js uae 407-7802870-0764303 ZDS-2-10L --refetch --shape
 *
 * --shape requires --refetch: one Catalog Items call to inspect response shape (no raw body).
 * Does not print full image URLs, tokens, secrets, buyer PII, raw JSON, or auth headers.
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

function usage() {
  console.log(
    'Usage: node scripts/debug-amazon-single-order-image.js <uae|ksa> <amazonOrderId> <sellerSku> [--refetch] [--shape]',
  )
  console.log(
    'Example: node scripts/debug-amazon-single-order-image.js uae 407-7802870-0764303 ZDS-2-10L',
  )
  console.log('  --shape requires --refetch (shape is derived from the same forced live catalog response).')
}

function normalizeMk(s) {
  const t = String(s || '').toLowerCase().trim()
  return t === 'ksa' ? 'ksa' : 'uae'
}

function normalizeAsin(a) {
  const s = String(a || '').trim().toUpperCase()
  if (s.length < 10 || s.length > 32) return ''
  return s
}

function hostOnly(url) {
  if (url == null || typeof url !== 'string') return null
  let t = url.trim()
  if (!t) return null
  if (t.startsWith('//')) t = `https:${t}`
  if (/^http:\/\//i.test(t)) t = t.replace(/^http:\/\//i, 'https://')
  try {
    return new URL(t).hostname.toLowerCase()
  } catch {
    return '(unparseable)'
  }
}

function titlePreview(t, max = 120) {
  if (t == null || typeof t !== 'string') return null
  const s = t.trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function isoOrNull(d) {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(t.getTime())) return null
  return t.toISOString()
}

function resolveReason({
  orderFound,
  orderItemFound,
  asin,
  catalogCacheRowFound,
  catalogImageUrlPresent,
}) {
  if (!orderFound) return 'MISSING_ORDER'
  if (!orderItemFound) return 'MISSING_ORDER_ITEM'
  if (!asin) return 'MISSING_ASIN'
  if (!catalogCacheRowFound) return 'NO_CATALOG_CACHE_ROW'
  if (!catalogImageUrlPresent) return 'CACHE_ROW_NO_IMAGE'
  return 'IMAGE_AVAILABLE_BACKEND'
}

async function main() {
  const raw = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean)
  const refetch = raw.includes('--refetch')
  const shape = raw.includes('--shape')
  const argv = raw.filter((x) => x !== '--refetch' && x !== '--shape')
  if (shape && !refetch) {
    console.error('ERROR: --shape requires --refetch (catalog call).')
    usage()
    process.exitCode = 1
    return
  }
  if (argv.length < 3) {
    usage()
    process.exitCode = 1
    return
  }

  const marketplaceKey = normalizeMk(argv[0])
  const amazonOrderId = String(argv[1]).trim()
  const sellerSku = String(argv[2]).trim()

  if (!amazonOrderId || !sellerSku) {
    usage()
    process.exitCode = 1
    return
  }

  const { pool, query } = require('../src/db')
  const { ensureAmazonOrdersCacheTables } = require('../src/services/amazonOrdersCacheStore')
  const { ensureAmazonCatalogItemCacheTables, getCatalogItemCacheByAsins } = require(
    '../src/services/amazonCatalogItemCacheStore',
  )
  const {
    forceRefreshCatalogPrimaryImageForAsin,
    describeCatalogItemImageShapeSafe,
  } = require('../src/services/amazonSkuImageService')

  try {
    await ensureAmazonOrdersCacheTables()
    await ensureAmazonCatalogItemCacheTables()

    const orderRes = await query(
      `SELECT amazon_order_id, purchase_date, order_status, items_sync_pending
       FROM amazon_orders
       WHERE marketplace_key = $1 AND amazon_order_id = $2
       LIMIT 1`,
      [marketplaceKey, amazonOrderId],
    )
    const orderFound = orderRes.rows.length > 0

    const itemRes = await query(
      `SELECT asin, seller_sku, title, last_synced_at
       FROM amazon_order_items
       WHERE marketplace_key = $1 AND amazon_order_id = $2 AND seller_sku = $3
       ORDER BY id ASC
       LIMIT 1`,
      [marketplaceKey, amazonOrderId, sellerSku],
    )
    let orderItemFound = itemRes.rows.length > 0
    let itemRow = itemRes.rows[0] || null

    if (orderFound && !orderItemFound) {
      const alt = await query(
        `SELECT asin, seller_sku, title, last_synced_at
         FROM amazon_order_items
         WHERE marketplace_key = $1 AND amazon_order_id = $2 AND TRIM(seller_sku) ILIKE TRIM($3)
         ORDER BY id ASC
         LIMIT 1`,
        [marketplaceKey, amazonOrderId, sellerSku],
      )
      if (alt.rows.length) {
        orderItemFound = true
        itemRow = alt.rows[0]
      }
    }

    let otherLineCount = 0
    const sampleSkus = []
    if (orderFound && !orderItemFound) {
      const cnt = await query(
        `SELECT COUNT(*)::int AS c FROM amazon_order_items WHERE marketplace_key = $1 AND amazon_order_id = $2`,
        [marketplaceKey, amazonOrderId],
      )
      otherLineCount = cnt.rows[0]?.c ?? 0
      const sk = await query(
        `SELECT seller_sku FROM amazon_order_items
         WHERE marketplace_key = $1 AND amazon_order_id = $2
         ORDER BY id ASC
         LIMIT 5`,
        [marketplaceKey, amazonOrderId],
      )
      for (const r of sk.rows) {
        if (r.seller_sku != null && String(r.seller_sku).trim()) sampleSkus.push(String(r.seller_sku).trim().slice(0, 80))
      }
    }

    const asin = itemRow ? normalizeAsin(itemRow.asin) : ''

    let catalogCacheRowFound = false
    let catalogImageUrlPresent = false
    let imageUrlHost = null
    let catalogLastSyncedAt = null

    if (asin) {
      const cmap = await getCatalogItemCacheByAsins(marketplaceKey, [asin])
      const cached = cmap.get(asin)
      if (cached) {
        catalogCacheRowFound = true
        const u = cached.imageUrl && String(cached.imageUrl).trim()
        catalogImageUrlPresent = Boolean(u)
        imageUrlHost = u ? hostOnly(u) : null
        catalogLastSyncedAt = isoOrNull(cached.lastSyncedAt)
      }
    }

    const reason = resolveReason({
      orderFound,
      orderItemFound,
      asin,
      catalogCacheRowFound,
      catalogImageUrlPresent,
    })

    const titlePv = titlePreview(itemRow?.title != null ? String(itemRow.title) : null)

    console.log(`marketplaceKey: ${marketplaceKey}`)
    console.log(`amazonOrderId: ${amazonOrderId}`)
    console.log(`sellerSku: ${sellerSku}`)
    console.log(`orderRowFound: ${orderFound ? 'true' : 'false'}`)
    console.log(`orderItemRowFound: ${orderItemFound ? 'true' : 'false'}`)
    console.log(`asin: ${asin || '(none)'}`)
    if (itemRow && itemRow.asin != null && String(itemRow.asin).trim() && !asin) {
      const snip = String(itemRow.asin).trim().slice(0, 24)
      console.log(`asinDbSnippetInvalid: ${snip}`)
    }
    console.log(`itemTitlePreview: ${titlePv || '—'}`)
    console.log(`orderItemLastSyncedAt: ${itemRow?.last_synced_at ? isoOrNull(itemRow.last_synced_at) : 'null'}`)
    console.log(`catalogCacheRowFound: ${catalogCacheRowFound ? 'true' : 'false'}`)
    console.log(`catalogCacheImageUrlPresent: ${catalogImageUrlPresent ? 'true' : 'false'}`)
    console.log(`imageUrlHostOnly: ${imageUrlHost || '—'}`)
    console.log(`catalogCacheLastSyncedAt: ${catalogLastSyncedAt || 'null'}`)
    console.log(`reason: ${reason}`)

    if (orderFound && !orderItemFound) {
      console.log(`orderOtherLineCount: ${otherLineCount}`)
      if (sampleSkus.length) console.log(`sampleSellerSkusOnOrder: ${sampleSkus.join(', ')}`)
    }

    if (refetch) {
      console.log('')
      console.log('--- live catalog refetch (one ASIN, TTL bypass) ---')
      if (!asin) {
        console.log('refetchSkipped: true (no valid ASIN on order line)')
        process.exitCode = 1
        return
      }

      const skuForCache =
        orderItemFound && itemRow?.seller_sku != null && String(itemRow.seller_sku).trim()
          ? String(itemRow.seller_sku).trim().slice(0, 512)
          : null

      const live = await forceRefreshCatalogPrimaryImageForAsin(marketplaceKey, asin, skuForCache)

      if (shape) {
        console.log('')
        console.log('--- catalog shape (safe) ---')
        console.log(`ASIN: ${asin}`)
        const d = describeCatalogItemImageShapeSafe(live.catalogItem)
        console.log(`summaries exists: ${d.summariesExists ? 'true' : 'false'}`)
        console.log(`summaries[0].mainImage exists: ${d.summaries0MainImageExists ? 'true' : 'false'}`)
        console.log(
          `summaries[0].mainImage keys: ${d.summaries0MainImageKeys.length ? d.summaries0MainImageKeys.join(', ') : '—'}`,
        )
        console.log(`images exists: ${d.imagesExists ? 'true' : 'false'}`)
        console.log(`images length: ${d.imagesArrayLength}`)
        console.log(
          `first image block keys: ${d.firstImageBlockKeys.length ? d.firstImageBlockKeys.join(', ') : '—'}`,
        )
        console.log(
          `nested image keys (first item): ${d.firstNestedImagesKeys.length ? d.firstNestedImagesKeys.join(', ') : '—'}`,
        )
        for (const c of d.pathCandidatesHostOnly) {
          console.log(`pathCandidateHostOnly: ${c.path} :: ${c.host}`)
        }
        if (!d.pathCandidatesHostOnly.length) console.log('pathCandidateHostOnly: (none)')
      }

      console.log('')
      console.log('--- live refetch result ---')
      console.log(`liveCatalogCalled: ${live.liveCatalogCalled ? 'true' : 'false'}`)
      console.log(`liveCatalogStatus: ${live.liveCatalogStatus}`)
      if (live.httpStatus != null) console.log(`liveCatalogHttpStatus: ${live.httpStatus}`)
      if (live.itemsReturned != null) console.log(`liveCatalogItemsReturned: ${live.itemsReturned}`)
      console.log(`catalogItemMatched: ${live.catalogItemMatched ? 'true' : 'false'}`)
      console.log(`imageFoundFromLive: ${live.imageFoundFromLive ? 'true' : 'false'}`)
      console.log(`imageHostOnly: ${live.imageUrl ? hostOnly(live.imageUrl) : '—'}`)
      if (live.safeError) console.log(`liveCatalogSafeError: ${live.safeError}`)
      console.log(`reasonAfterLiveRefetch: ${live.reasonAfterLiveRefetch != null ? live.reasonAfterLiveRefetch : '—'}`)

      const afterMap = await getCatalogItemCacheByAsins(marketplaceKey, [asin])
      const after = afterMap.get(asin)
      const urlAfter = after?.imageUrl && String(after.imageUrl).trim()
      console.log(`cacheImageUrlPresentAfterLive: ${urlAfter ? 'true' : 'false'}`)
      console.log(`cacheImageHostAfterLive: ${urlAfter ? hostOnly(urlAfter) : '—'}`)
    }
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error'
    console.error('FAILED:', msg)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

main()
