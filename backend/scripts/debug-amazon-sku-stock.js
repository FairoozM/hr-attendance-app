#!/usr/bin/env node
/**
 * Debug Amazon stock for one SKU: cached DB row + live FBA API + AFN report slice.
 * Usage: node scripts/debug-amazon-sku-stock.js 2FP17SET-BEIGE [uae|ksa]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { query, pool } = require('../src/db')
const {
  fetchAmazonInventoryForListings,
  mergeAmazonInventoryRecords,
  mapInventorySummary,
  mapAfnManageInventoryRow,
} = require('../src/services/amazonListingsInventoryReadService')
const { getAmazonFbaInventorySummaries, throwAmazonSpApiIfFailed } = require('../src/services/amazonSpApiService')
const { marketplaceIdForKey } = require('../src/services/amazonSpApiService')
const { normalizeSku } = require('../src/utils/normalizeSku')

const sku = process.argv[2] || '2FP17SET-BEIGE'
const mk = (process.argv[3] || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'

async function readCache() {
  const norm = normalizeSku(sku)
  const res = await query(
    `SELECT seller_sku, marketplace, listing_status,
            amazon_total_qty, amazon_available_qty, amazon_reserved_qty,
            amazon_stock_status, zoho_available_qty, zoho_stock_status,
            amazon_last_fetched_at, comparison_generated_at,
            raw_safe_json
     FROM amazon_zoho_stock_comparison
     WHERE marketplace_key = $1 AND normalized_sku = $2`,
    [mk, norm]
  )
  return res.rows[0] || null
}

async function readLiveFbaApi() {
  const marketplaceId = marketplaceIdForKey(mk)
  const res = await getAmazonFbaInventorySummaries({
    marketplaceKey: mk,
    marketplaceId,
    sellerSkus: [sku],
  })
  throwAmazonSpApiIfFailed(res, 'getFbaInventorySummaries', mk)
  const payload = res.data?.payload || res.data
  const list = payload?.inventorySummaries || []
  return list[0] ? mapInventorySummary(list[0]) : null
}

async function readLiveMerged() {
  const marketplaceId = marketplaceIdForKey(mk)
  const listings = [
    {
      marketplaceKey: mk,
      marketplace: mk === 'ksa' ? 'KSA' : 'UAE',
      marketplaceId,
      sellerSku: sku,
      normalizedSku: normalizeSku(sku),
      listingStatus: 'ACTIVE',
    },
  ]
  const result = await fetchAmazonInventoryForListings({
    marketplaceKey: mk,
    marketplaceId,
    listings,
    progress: (p) => console.log('[progress]', p.step),
  })
  const inv = result.inventoryBySku.get(normalizeSku(sku))
  return { inv, afnReportWarning: result.afnReportWarning, fetchedAt: result.fetchedAt }
}

async function main() {
  console.log('SKU:', sku, '| marketplace:', mk, '| normalized:', normalizeSku(sku))
  console.log('--- Cached row (amazon_zoho_stock_comparison) ---')
  try {
    const row = await readCache()
    if (!row) {
      console.log('(not in cache — run Refresh on Amazon + Zoho Stock for', mk.toUpperCase(), ')')
    } else {
      console.log(JSON.stringify(row, null, 2))
    }
  } catch (e) {
    console.log('Cache query failed:', e.message)
  }

  console.log('\n--- Live Amazon FBA API (GET /fba/inventory/v1/summaries) ---')
  try {
    const api = await readLiveFbaApi()
    console.log(api ? JSON.stringify(api, null, 2) : '(no summary returned for this SKU)')
  } catch (e) {
    console.log('FBA API failed:', e.message)
  }

  console.log('\n--- Live merged (FBA API + AFN manage inventory report) ---')
  try {
    const merged = await readLiveMerged()
    console.log(JSON.stringify(merged, null, 2))
  } catch (e) {
    console.log('Merged fetch failed:', e.message)
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
