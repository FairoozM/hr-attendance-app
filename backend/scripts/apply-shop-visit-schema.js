#!/usr/bin/env node
/**
 * One-off: apply shop visit + notifications schema without full boot.
 * Run from repo root: `node backend/scripts/apply-shop-visit-schema.js`
 * Requires DATABASE_URL (or default local) in env / .env next to backend.
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { pool, ensureShopVisitSchemaOnly } = require('../src/db')

async function main() {
  await ensureShopVisitSchemaOnly()
  console.log('[apply-shop-visit-schema] Done.')
  await pool.end()
}

main().catch((err) => {
  console.error('[apply-shop-visit-schema] Failed:', err.message || err)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
