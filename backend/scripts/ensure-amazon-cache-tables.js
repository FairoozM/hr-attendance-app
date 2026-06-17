#!/usr/bin/env node
/**
 * Ensures Amazon orders cache (019) and catalog item image cache (020) tables exist (same DDL as server boot).
 * Loads backend/.env for DATABASE_URL. Does not print secrets or connection URLs.
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

async function main() {
  const { ensureAmazonOrdersCacheTables } = require('../src/services/amazonOrdersCacheStore')
  const { ensureAmazonCatalogItemCacheTables } = require('../src/services/amazonCatalogItemCacheStore')
  const { ensureAmazonSkuImageOverrideTables } = require('../src/services/amazonSkuImageOverrideStore')
  const { pool } = require('../src/db')
  try {
    await ensureAmazonOrdersCacheTables()
    await ensureAmazonCatalogItemCacheTables()
    await ensureAmazonSkuImageOverrideTables()
    console.log('SUCCESS: Amazon cache tables ensured (orders + catalog item cache + SKU image overrides)')
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error'
    console.error('FAILED:', msg)
    if (!process.env.DATABASE_URL) {
      console.error(
        'Hint: DATABASE_URL is not set. Add it to backend/.env (see backend/.env.example). When unset, pg uses the built-in default in src/db/index.js (local dev only).',
      )
    }
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

main()
