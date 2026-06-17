#!/usr/bin/env node
/**
 * Reads cached Amazon orders from DB only (no live SP-API).
 *
 * Usage:
 *   node scripts/test-amazon-cache-read.js uae
 *   node scripts/test-amazon-cache-read.js ksa
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { normalizeMarketplaceKey } = require('../src/services/amazonSpApiService')
const { getCachedAmazonOrders } = require('../src/services/amazonOrdersSyncService')
const { countCachedOrders } = require('../src/services/amazonOrdersCacheStore')

function isRegionKey(arg) {
  const a = String(arg || '').trim().toLowerCase()
  return a === 'uae' || a === 'ksa'
}

async function main() {
  const args = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean)
  if (args.length < 1 || !isRegionKey(args[0])) {
    console.log('Usage: node scripts/test-amazon-cache-read.js <uae|ksa>')
    process.exit(1)
  }
  const marketplaceKey = normalizeMarketplaceKey(args[0])
  const total = await countCachedOrders(marketplaceKey)
  const data = await getCachedAmazonOrders({ marketplaceKey, limit: 50, offset: 0 })

  console.log(`marketplaceKey=${marketplaceKey}`)
  console.log(`cachedOrderRows=${total}`)
  console.log(`returnedOrders=${data.orders.length} source=${data.source}`)
  let sum = 0
  const cur = new Set()
  for (const o of data.orders) {
    const ot = o.OrderTotal
    if (ot && ot.Amount != null && ot.CurrencyCode) {
      const n = parseFloat(String(ot.Amount).replace(/,/g, ''))
      if (Number.isFinite(n)) {
        cur.add(ot.CurrencyCode)
        if (cur.size === 1) sum += n
      }
    }
  }
  console.log(`orderTotalSum (${[...cur].join(',') || 'n/a'}): ${cur.size === 1 ? sum.toFixed(2) : 'n/a (mixed or missing)'}`)
  const preview = data.orders.slice(0, 5).map((o) => ({
    id: o.AmazonOrderId,
    skus: Array.isArray(o.skus) ? o.skus.slice(0, 5).join(',') : '',
  }))
  console.log('SKU preview (first 5 orders):', JSON.stringify(preview))
}

main().catch((e) => {
  console.error('FAILED:', e.message || e)
  process.exit(1)
})
