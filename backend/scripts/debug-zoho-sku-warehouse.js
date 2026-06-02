#!/usr/bin/env node
/**
 * Debug Zoho Life Smile warehouse qty for one SKU (Amazon↔Zoho comparison).
 * Usage: node scripts/debug-zoho-sku-warehouse.js LIFEP32SHR-24
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { pool } = require('../src/db')
const {
  resolveLifeSmileWarehouse,
  fetchZohoStockForSkus,
} = require('../src/services/zohoLifeSmileWarehouseService')
const { normalizeSku } = require('../src/utils/normalizeSku')

const sku = process.argv[2] || 'LIFEP32SHR-24'

async function main() {
  const norm = normalizeSku(sku)
  console.log('SKU:', sku, '| normalized:', norm)
  const warehouse = await resolveLifeSmileWarehouse()
  console.log('Warehouse:', warehouse)
  const result = await fetchZohoStockForSkus({ skus: [sku] })
  console.log('Match stats:', result.matchStats)
  const hit = result.zohoBySku.get(norm)
  console.log('Zoho entry:', hit || '(no match — check SKU spelling in Zoho vs Amazon)')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
