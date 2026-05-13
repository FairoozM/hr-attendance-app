#!/usr/bin/env node
/**
 * Runs syncAmazonOrders for a marketplace (guarded; safe console output only).
 *
 * Usage:
 *   node scripts/test-amazon-cache-sync.js uae 1
 *   node scripts/test-amazon-cache-sync.js ksa 1
 *
 * Second arg: daysBack (1–7). Window ends ~2 minutes ago UTC.
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { normalizeMarketplaceKey } = require('../src/services/amazonSpApiService')
const { syncAmazonOrders } = require('../src/services/amazonOrdersSyncService')

function iso8601Z(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function isRegionKey(arg) {
  const a = String(arg || '').trim().toLowerCase()
  return a === 'uae' || a === 'ksa'
}

async function main() {
  const args = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean)
  if (args.length < 2 || !isRegionKey(args[0])) {
    console.log('Usage: node scripts/test-amazon-cache-sync.js <uae|ksa> <daysBack 1-7>')
    process.exit(1)
  }
  const marketplaceKey = normalizeMarketplaceKey(args[0])
  let days = parseInt(args[1], 10)
  if (!Number.isFinite(days) || days < 1) days = 1
  if (days > 7) days = 7

  const now = Date.now()
  const createdBefore = new Date(now - 130_000)
  const createdAfter = new Date(createdBefore.getTime() - days * 24 * 60 * 60 * 1000)

  console.log(`marketplaceKey=${marketplaceKey} window ${iso8601Z(createdAfter)} .. ${iso8601Z(createdBefore)}`)

  const summary = await syncAmazonOrders({
    marketplaceKey,
    createdAfter,
    createdBefore,
    includeItems: true,
    force: true,
    forceAllowed: true,
  })

  console.log('RESULT (safe summary):')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error('FAILED:', e.message || e)
  process.exit(1)
})
