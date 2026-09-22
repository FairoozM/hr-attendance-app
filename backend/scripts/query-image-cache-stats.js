#!/usr/bin/env node
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const { query } = require(path.join(__dirname, '../src/db'))

async function main() {
  const breakdown = await query(`
    SELECT COALESCE(missing_reason, '(null)') AS reason, COUNT(*)::int AS n
    FROM inventory_item_images
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 20
  `)
  const totals = await query(`
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE image_url LIKE '/uploads/inventory-item-images/%')::int AS cached_files,
      COUNT(*) FILTER (WHERE missing_reason IN ('no_image_on_zoho_endpoint', 'zoho_image_not_found'))::int AS zoho_no_image,
      COUNT(*) FILTER (WHERE missing_reason ILIKE 'image_fetch_error:%')::int AS fetch_errors
    FROM inventory_item_images
  `)
  const samples = await query(`
    SELECT sku, item_id, missing_reason
    FROM inventory_item_images
    WHERE image_url IS NULL OR image_url NOT LIKE '/uploads/inventory-item-images/%'
    ORDER BY last_checked_at DESC NULLS LAST
    LIMIT 8
  `)
  console.log(JSON.stringify({ totals: totals.rows[0], breakdown: breakdown.rows, samples: samples.rows }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
