#!/usr/bin/env node
/**
 * Loads cached orders with primary-item catalog images (same path as GET /api/amazon/orders).
 * Safe JSON only — no tokens or buyer PII.
 *
 * Usage:
 *   cd backend && node scripts/test-amazon-orders-images.js uae
 *   cd backend && node scripts/test-amazon-orders-images.js ksa
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

function usage() {
  console.log('Usage: node scripts/test-amazon-orders-images.js <uae|ksa>')
}

async function main() {
  const mkRaw = String(process.argv[2] || '')
    .trim()
    .toLowerCase()
  if (mkRaw !== 'uae' && mkRaw !== 'ksa') {
    usage()
    process.exitCode = 1
    return
  }

  const { pool } = require('../src/db')
  const { getCachedAmazonOrders } = require('../src/services/amazonOrdersSyncService')

  try {
    const data = await getCachedAmazonOrders({
      marketplaceKey: mkRaw,
      limit: 50,
      offset: 0,
      includeSkuImages: true,
    })
    const orders = Array.isArray(data.orders) ? data.orders : []
    const rowsWithPrimary = orders.filter((o) => o.primaryItem && typeof o.primaryItem === 'object').length
    const rowsWithImage = orders.filter(
      (o) => typeof o.primaryItem?.imageUrl === 'string' && o.primaryItem.imageUrl.trim().toLowerCase().startsWith('http')
    ).length

    const sample = orders.slice(0, 12).map((o) => ({
      orderId: o.AmazonOrderId != null ? String(o.AmazonOrderId) : null,
      sellerSku: o.primaryItem?.sellerSku ?? null,
      asin: o.primaryItem?.asin ?? null,
      hasImageUrl: Boolean(
        typeof o.primaryItem?.imageUrl === 'string' && o.primaryItem.imageUrl.trim().toLowerCase().startsWith('http')
      ),
    }))

    console.log(
      JSON.stringify(
        {
          marketplaceKey: data.marketplaceKey,
          includeSkuImages: data.includeSkuImages,
          returnedOrders: orders.length,
          rowsWithPrimaryItem: rowsWithPrimary,
          rowsWithImageUrl: rowsWithImage,
          sample,
        },
        null,
        2
      )
    )
  } catch (e) {
    console.error('FAILED:', e && e.message ? String(e.message) : 'unknown')
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

main()
