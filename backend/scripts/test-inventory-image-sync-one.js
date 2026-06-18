#!/usr/bin/env node
/**
 * Run inventory health image sync for one item and verify file + DB.
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { pool } = require('../src/db')
const inventoryHealthImageService = require('../src/services/inventoryHealthImageService')
const inventoryItemImageStorage = require('../src/services/inventoryItemImageStorage')

async function main() {
  const itemId = process.argv[2] || '4265011000024512503'
  const sku = process.argv[3] || '529402100402'

  console.log('[sync-one] itemId=', itemId, 'sku=', sku)
  const result = await inventoryHealthImageService.syncOneInventoryImage({ itemId, sku, force: true })
  console.log('[sync-one] result:', JSON.stringify(result, null, 2))

  const db = await pool.query(
    `SELECT item_id, sku, image_url, image_source, content_type, file_size, missing_reason
     FROM inventory_item_images WHERE item_id = $1`,
    [itemId],
  )
  console.log('[sync-one] db row:', db.rows[0] || null)

  const url = db.rows[0]?.image_url
  if (url) {
    console.log('[sync-one] isPermanent:', inventoryItemImageStorage.isPermanentCachedImageUrl(url))
    console.log('[sync-one] fileExists:', inventoryItemImageStorage.fileExistsForPublicUrl(url))
    console.log('[sync-one] UPLOAD_ROOT:', inventoryItemImageStorage.UPLOAD_ROOT)
  }
}

main()
  .catch((e) => {
    console.error(e?.stack || e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => {}))
