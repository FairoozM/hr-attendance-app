#!/usr/bin/env node
/**
 * Ensures catalog item cache table, then resolves one ASIN through the same path as the BI dashboard
 * (DB cache + Search Catalog Items when stale/missing). Prints JSON only — no secrets, tokens, or PII.
 *
 * Usage:
 *   cd backend && node scripts/test-amazon-catalog-image-cache.js uae B0XXXXXXXXX
 *   cd backend && npm run test:amazon-catalog-image-cache -- uae B0XXXXXXXXX
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

function usage() {
  console.log('Usage: node scripts/test-amazon-catalog-image-cache.js <uae|ksa> <ASIN>')
  console.log('Example: node scripts/test-amazon-catalog-image-cache.js uae B08N5WRWNW')
}

async function main() {
  const argv = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean)
  if (argv.length < 2) {
    usage()
    process.exitCode = 1
    return
  }
  const mkRaw = argv[0].toLowerCase()
  const asin = argv[1]
  if (mkRaw !== 'uae' && mkRaw !== 'ksa') {
    console.error('First argument must be uae or ksa')
    usage()
    process.exitCode = 1
    return
  }

  const { pool } = require('../src/db')
  const { ensureAmazonCatalogItemCacheTables } = require('../src/services/amazonCatalogItemCacheStore')
  const { fetchCatalogItemSnapshotForTest } = require('../src/services/amazonSkuImageService')

  try {
    await ensureAmazonCatalogItemCacheTables()
    const out = await fetchCatalogItemSnapshotForTest(mkRaw, asin)
    const safe = {
      ok: out.ok,
      marketplaceKey: out.marketplaceKey,
      asin: out.asin,
      hadRowBefore: out.hadRowBefore,
      wasFreshBefore: out.wasFreshBefore,
      imageFetchStatus: out.imageFetchStatus,
      imageUrl: out.imageUrl,
      cachedTitle: out.cached?.title ?? null,
      cachedBrand: out.cached?.brand ?? null,
      cachedLastSyncedAt: out.cached?.lastSyncedAt ?? null,
      meta: out.meta ?? null,
    }
    if (!out.ok) {
      safe.error = out.error
    }
    console.log(JSON.stringify(safe, null, 2))
    if (!out.ok) process.exitCode = 1
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error'
    console.error('FAILED:', msg)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

main()
