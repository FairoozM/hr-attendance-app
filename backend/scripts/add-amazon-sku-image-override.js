#!/usr/bin/env node
/**
 * Upsert a manual HTTPS SKU/ASIN image override (no secrets printed).
 *
 * Usage:
 *   node scripts/add-amazon-sku-image-override.js uae ZDS-2-10L B0G4HPLKM1 https://example.com/image.jpg
 *   node scripts/add-amazon-sku-image-override.js uae ZDS-2-10L https://example.com/image.jpg
 *   npm run amazon:add-sku-image-override -- uae ZDS-2-10L B0XXX https://example.com/image.jpg
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const {
  upsertSkuImageOverride,
  normalizeMarketplaceKeyForOverride,
  ensureAmazonSkuImageOverrideTables,
} = require('../src/services/amazonSkuImageOverrideStore')
const { pool } = require('../src/db')

async function main() {
  await ensureAmazonSkuImageOverrideTables()
  const args = process.argv.slice(2)
  if (args.length < 3) {
    console.error(
      'Usage: node scripts/add-amazon-sku-image-override.js <uae|ksa> <sellerSku> [asin] <https://image-url>',
    )
    process.exitCode = 1
    return
  }
  const mkRaw = args[0]
  const imageUrl = args[args.length - 1]
  const middle = args.slice(1, -1)
  const mk = normalizeMarketplaceKeyForOverride(mkRaw)
  if (mk == null) {
    console.error('Invalid marketplace; use uae or ksa')
    process.exitCode = 1
    return
  }
  let sellerSku = ''
  let asin = null
  if (middle.length === 1) {
    sellerSku = middle[0]
  } else if (middle.length >= 2) {
    sellerSku = middle[0]
    asin = middle[1]
  } else {
    console.error('Missing sellerSku')
    process.exitCode = 1
    return
  }

  const row = await upsertSkuImageOverride({
    marketplaceKey: mk,
    sellerSku,
    asin,
    imageUrl,
    source: 'manual',
    notes: 'CLI upsert',
  })
  const imageSource = row.sellerSku && String(row.sellerSku).trim() !== '' ? 'sku_override' : 'asin_override'
  console.log(
    JSON.stringify(
      {
        ok: true,
        marketplaceKey: row.marketplaceKey,
        sellerSku: row.sellerSku,
        asin: row.asin,
        imageSource,
        id: row.id,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e?.message || e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => {}))
