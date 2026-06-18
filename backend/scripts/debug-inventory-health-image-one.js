#!/usr/bin/env node
/**
 * Debug Zoho inventory item image fields + download attempts for one SKU.
 *
 * Usage:
 *   node scripts/debug-inventory-health-image-one.js 2025OB-002
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { fetchAllItemsRaw } = require('../src/integrations/zoho/zohoAdapter')
const {
  fetchItemById,
  fetchZohoItemImageBuffer,
} = require('../src/integrations/zoho/zohoInventoryClient')
const { readZohoConfig, INVENTORY_V1 } = require('../src/integrations/zoho/zohoConfig')
const { zohoInventoryBufferRequest } = require('../src/services/zohoApiClient')
const { pool } = require('../src/db')

function cleanStr(v) {
  return String(v == null ? '' : v).trim()
}

function pickSku(item) {
  return cleanStr(item && (item.sku || item.item_code || item.code))
}

function pickItemId(item) {
  return cleanStr(item && (item.item_id || item.id))
}

function imageRelatedKeys(item) {
  if (!item || typeof item !== 'object') return []
  return Object.keys(item).filter((k) => /image|photo|document|attachment|file/i.test(k))
}

function pickImageFields(item) {
  const out = {}
  for (const k of imageRelatedKeys(item)) {
    const v = item[k]
    if (v == null || v === '') continue
    if (typeof v === 'object') {
      out[k] = Array.isArray(v) ? v.slice(0, 3) : v
    } else {
      out[k] = v
    }
  }
  return out
}

async function tryDownload(label, fn) {
  try {
    const result = await fn()
    if (!result) {
      return { source: label, success: false, status: 404, error: 'empty_or_null_response' }
    }
    if (result.buffer) {
      return {
        source: label,
        success: true,
        status: 200,
        contentType: result.contentType || null,
        contentLength: result.buffer.length,
      }
    }
    return {
      source: label,
      success: false,
      status: result.status || null,
      contentType: result.contentType || null,
      contentLength: result.body ? result.body.length : 0,
      error: result.error || 'unexpected_shape',
    }
  } catch (err) {
    return {
      source: label,
      success: false,
      status: err.httpStatus || null,
      error: err.message || String(err),
      code: err.code || null,
    }
  }
}

async function tryRawImageEndpoint(itemId, label) {
  const c = readZohoConfig()
  if (c.code !== 'ok') throw new Error('Zoho not configured')
  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  const imagePath = `${INVENTORY_V1}/items/${encodeURIComponent(itemId)}/image`
  const { status, body, contentType } = await zohoInventoryBufferRequest(imagePath, p, {
    source: 'debug_inventory_image',
    skipCache: true,
  })
  return {
    status,
    contentType: contentType || null,
    body,
    error: status >= 200 && status < 300 ? null : `HTTP ${status}`,
  }
}

async function main() {
  const skuArg = cleanStr(process.argv[2] || '2025OB-002')
  if (!skuArg) {
    console.error('Usage: node scripts/debug-inventory-health-image-one.js SKU')
    process.exit(1)
  }

  const cfg = readZohoConfig()
  console.log('[debug] zoho config:', cfg.code === 'ok' ? { organizationId: cfg.organizationId } : cfg)

  const rawItems = await fetchAllItemsRaw()
  const active = (rawItems || []).filter((item) => {
    const st = String(item.status || '').trim().toLowerCase()
    return !st || st === 'active'
  })

  console.log('\n=== Step 1: first 5 active items image-related keys ===')
  for (const item of active.slice(0, 5)) {
    console.log(JSON.stringify({
      item_id: pickItemId(item),
      sku: pickSku(item),
      name: cleanStr(item.name || item.item_name),
      imageRelatedKeys: imageRelatedKeys(item),
      imageFields: pickImageFields(item),
    }, null, 2))
  }

  const skuLower = skuArg.toLowerCase()
  const listItem = active.find((item) => {
    const sku = pickSku(item).toLowerCase()
    const name = cleanStr(item.name || item.item_name).toLowerCase()
    return sku === skuLower || name === skuLower
  })
  if (!listItem) {
    console.error(`\nSKU/name not found in active list-items: ${skuArg}`)
    const nameMatches = active
      .filter((item) => cleanStr(item.name || item.item_name).toLowerCase().includes(skuLower))
      .slice(0, 5)
      .map((item) => ({ item_id: pickItemId(item), sku: pickSku(item), name: cleanStr(item.name || item.item_name) }))
    if (nameMatches.length) {
      console.error('Partial name matches:', JSON.stringify(nameMatches, null, 2))
    }
    process.exit(1)
  }

  const itemId = pickItemId(listItem)
  console.log('\n=== Step 2: list-items row for target SKU ===')
  console.log(JSON.stringify({
    sku: skuArg,
    itemId,
    itemName: cleanStr(listItem.name || listItem.item_name),
    listItemImageKeys: imageRelatedKeys(listItem),
    possibleImageFields: pickImageFields(listItem),
  }, null, 2))

  console.log('\n=== Step 3: item detail ===')
  const detail = await fetchItemById(itemId, { source: 'debug_inventory_image', skipCache: true })
  console.log(JSON.stringify({
    endpoint: `${INVENTORY_V1}/items/${itemId}`,
    detailImageKeys: imageRelatedKeys(detail),
    possibleImageFields: pickImageFields(detail),
  }, null, 2))

  const attemptedDownloadUrls = [
    `${INVENTORY_V1}/items/${itemId}/image?organization_id=(redacted)`,
  ]

  console.log('\n=== Step 4: download attempts ===')
  const downloadResults = []
  downloadResults.push(
    await tryDownload('fetchZohoItemImageBuffer', () => fetchZohoItemImageBuffer(itemId)),
  )
  downloadResults.push(
    await tryDownload('raw_items_image_endpoint', async () => {
      const raw = await tryRawImageEndpoint(itemId, 'raw')
      if (raw.status >= 200 && raw.status < 300 && raw.body && raw.body.length) {
        return { buffer: raw.body, contentType: raw.contentType }
      }
      return raw
    }),
  )

  console.log(JSON.stringify({
    sku: skuArg,
    itemId,
    itemName: cleanStr(listItem.name || listItem.item_name),
    listItemImageKeys: imageRelatedKeys(listItem),
    detailImageKeys: imageRelatedKeys(detail),
    possibleImageFields: {
      list: pickImageFields(listItem),
      detail: pickImageFields(detail),
    },
    attemptedDownloadUrls,
    downloadResults,
  }, null, 2))
}

main()
  .catch((e) => {
    console.error(e?.stack || e?.message || e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => {}))
