#!/usr/bin/env node
/**
 * Calls getAmazonOrdersDashboard with includeSkuImages (last 7 days, createdBefore = now − 3 min).
 * Safe JSON only — no tokens, secrets, or full Amazon payloads.
 *
 * Usage:
 *   cd backend && node scripts/test-amazon-dashboard-images.js uae
 *   cd backend && node scripts/test-amazon-dashboard-images.js ksa
 *   npm run test:amazon-dashboard-images --prefix backend -- uae
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

function usage() {
  console.log('Usage: node scripts/test-amazon-dashboard-images.js <uae|ksa>')
}

function hostOnly(imageUrl) {
  if (imageUrl == null || typeof imageUrl !== 'string') return null
  try {
    return new URL(imageUrl.trim()).hostname
  } catch {
    return null
  }
}

function titlePreview(t, max = 72) {
  if (t == null || typeof t !== 'string') return null
  const s = t.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

async function main() {
  const argv = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean)
  const mkRaw = (argv[0] || '').toLowerCase()
  if (mkRaw !== 'uae' && mkRaw !== 'ksa') {
    usage()
    process.exitCode = 1
    return
  }

  const { pool } = require('../src/db')
  const { getAmazonOrdersDashboard } = require('../src/services/amazonOrdersDashboardService')

  const createdBefore = new Date(Date.now() - 3 * 60 * 1000)
  const createdAfter = new Date(createdBefore.getTime() - 7 * 24 * 60 * 60 * 1000)

  try {
    const data = await getAmazonOrdersDashboard({
      marketplaceKey: mkRaw,
      createdAfter,
      createdBefore,
      includeSkuImages: true,
    })

    const rows = Array.isArray(data.topSkus) ? data.topSkus : []
    const rowsWithAsin = rows.filter((r) => r.asin != null && String(r.asin).trim() !== '').length
    const rowsWithImageUrl = rows.filter(
      (r) => typeof r.imageUrl === 'string' && r.imageUrl.trim().toLowerCase().startsWith('http')
    ).length

    const first10 = rows.slice(0, 10).map((r) => ({
      sellerSku: r.sellerSku,
      orderMarketplaceKey: r.orderMarketplaceKey || null,
      asin: r.asin || null,
      hasImageUrl: Boolean(typeof r.imageUrl === 'string' && r.imageUrl.trim()),
      imageUrlHost: hostOnly(r.imageUrl),
      titlePreview: titlePreview(r.title),
      rowImageStatus: r.imageFetchStatus || null,
    }))

    const out = {
      marketplaceKey: data.marketplaceKey,
      createdAfter: data.createdAfter,
      createdBefore: data.createdBefore,
      topSkuCount: rows.length,
      rowsWithAsin,
      rowsWithImageUrl,
      imageFetchStatus: data.imageFetchStatus,
      imageFetchMessage: data.imageFetchMessage || null,
      includeSkuImages: data.includeSkuImages,
      first10,
    }
    console.log(JSON.stringify(out, null, 2))
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error'
    console.error('FAILED:', msg)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

main()
