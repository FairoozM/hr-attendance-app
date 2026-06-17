#!/usr/bin/env node
/**
 * Lists top-SKU rows (same window as BI default) that still have no imageUrl after catalog + override resolution.
 * Scope: top 30 revenue SKUs only (same as dashboard). Does not print secrets.
 *
 * Usage:
 *   node scripts/debug-amazon-missing-images.js uae
 *   node scripts/debug-amazon-missing-images.js ksa
 *   npm run debug:amazon-missing-images -- uae
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { getAmazonOrdersDashboard } = require('../src/services/amazonOrdersDashboardService')
const { ensureAmazonSkuImageOverrideTables } = require('../src/services/amazonSkuImageOverrideStore')
const { pool } = require('../src/db')

const MS_BEFORE_NOW = 130_000
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000

async function main() {
  await ensureAmazonSkuImageOverrideTables()
  const mkArg = (process.argv[2] || 'uae').trim().toLowerCase()
  const mk = mkArg === 'ksa' ? 'ksa' : 'uae'
  const now = Date.now()
  const createdBefore = new Date(now - MS_BEFORE_NOW)
  const createdAfter = new Date(now - DEFAULT_RANGE_MS)

  const data = await getAmazonOrdersDashboard({
    marketplaceKey: mk,
    createdAfter,
    createdBefore,
    includeSkuImages: true,
  })

  const rows = (data.topSkus || []).filter((r) => !r.imageUrl && r.asin)
  const out = {
    marketplaceKey: mk,
    dateWindowNote: 'Same default ~7d window as BI (purchase_date vs now−130s)',
    topSkuCapNote: 'Only the top 30 SKUs by line revenue (dashboard limit)',
    missingImageCount: rows.length,
    rows: rows.map((r) => ({
      sellerSku: r.sellerSku,
      asin: r.asin,
      titlePreview: (r.title || '').slice(0, 80),
      orderCount: r.orderCount,
      reason: 'no_display_image_after_catalog_and_overrides',
      suggestedAction: 'Add HTTPS override (admin API or npm run amazon:add-sku-image-override)',
    })),
  }
  console.log(JSON.stringify(out, null, 2))
}

main()
  .catch((e) => {
    console.error(e?.message || e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => {}))
