/**
 * Persistent cache for Zoho inventory item thumbnail URLs (inventory health dashboard).
 */

const { query } = require('../db')
const {
  isPermanentCachedImageUrl,
} = require('./inventoryItemImageStorage')

function cleanStr(v, max = 512) {
  if (v == null) return ''
  return String(v).trim().slice(0, max)
}

function normalizeSkuKey(sku) {
  return cleanStr(sku, 512).toLowerCase()
}

async function ensureInventoryItemImageTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS inventory_item_images (
      id BIGSERIAL PRIMARY KEY,
      item_id VARCHAR(64),
      sku VARCHAR(512),
      item_name TEXT,
      image_url TEXT,
      image_source VARCHAR(64),
      image_cached_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      missing_reason TEXT,
      content_type VARCHAR(128),
      file_size BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE inventory_item_images ADD COLUMN IF NOT EXISTS content_type VARCHAR(128)`)
  await query(`ALTER TABLE inventory_item_images ADD COLUMN IF NOT EXISTS file_size BIGINT`)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_item_images_item_id
      ON inventory_item_images (item_id)
      WHERE item_id IS NOT NULL AND item_id <> ''
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_item_images_sku_fallback
      ON inventory_item_images (LOWER(sku))
      WHERE (item_id IS NULL OR item_id = '') AND sku IS NOT NULL AND sku <> ''
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_inventory_item_images_last_checked
      ON inventory_item_images (last_checked_at DESC)
  `)
}

/**
 * @returns {Promise<Map<string, object>>} keyed by item_id
 */
async function getCachedImagesByItemIds(itemIds) {
  const ids = []
  const seen = new Set()
  for (const raw of itemIds || []) {
    const id = cleanStr(raw, 64)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  const out = new Map()
  if (!ids.length) return out

  const res = await query(
    `SELECT item_id, sku, item_name, image_url, image_source, image_cached_at, last_checked_at, missing_reason, content_type, file_size
     FROM inventory_item_images
     WHERE item_id = ANY($1::varchar[])`,
    [ids],
  )

  for (const row of res.rows) {
    const itemId = cleanStr(row.item_id, 64)
    if (!itemId) continue
    out.set(itemId, mapRow(row))
  }
  return out
}

function mapRow(row) {
  const rawUrl = row.image_url != null ? String(row.image_url) : null
  const imageUrl = rawUrl && isPermanentCachedImageUrl(rawUrl) ? rawUrl : null
  return {
    itemId: cleanStr(row.item_id, 64) || null,
    sku: cleanStr(row.sku, 512) || null,
    itemName: row.item_name != null ? String(row.item_name) : null,
    imageUrl,
    imageSource: row.image_source != null ? String(row.image_source) : null,
    imageCachedAt: row.image_cached_at ? new Date(row.image_cached_at).toISOString() : null,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    missingReason: row.missing_reason != null ? String(row.missing_reason) : null,
    contentType: row.content_type != null ? String(row.content_type) : null,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
  }
}

/**
 * @returns {Promise<Map<string, object>>} all cached rows keyed by item_id
 */
async function getAllCachedByItemId() {
  const res = await query(
    `SELECT item_id, sku, item_name, image_url, image_source, image_cached_at, last_checked_at, missing_reason, content_type, file_size
     FROM inventory_item_images
     WHERE item_id IS NOT NULL AND item_id <> ''`,
  )
  const out = new Map()
  for (const row of res.rows) {
    const itemId = cleanStr(row.item_id, 64)
    if (!itemId) continue
    out.set(itemId, mapRow(row))
  }
  return out
}

async function upsertInventoryItemImage(row, { forceReplaceImage = false } = {}) {
  const itemId = cleanStr(row.itemId, 64)
  const sku = cleanStr(row.sku, 512)
  const itemName = row.itemName != null ? String(row.itemName).slice(0, 2000) : null
  const imageUrl = row.imageUrl != null && String(row.imageUrl).trim() ? String(row.imageUrl).trim().slice(0, 2048) : null
  const imageSource = cleanStr(row.imageSource, 64) || null
  const missingReason = row.missingReason != null ? String(row.missingReason).slice(0, 512) : null
  const contentType = row.contentType != null ? String(row.contentType).slice(0, 128) : null
  const fileSize = row.fileSize != null && Number.isFinite(Number(row.fileSize)) ? Number(row.fileSize) : null
  const now = new Date()
  const imageCachedAt = imageUrl ? now : null

  if (itemId) {
    const imageUrlClause = forceReplaceImage
      ? 'image_url = EXCLUDED.image_url'
      : 'image_url = COALESCE(EXCLUDED.image_url, inventory_item_images.image_url)'

    await query(
      `INSERT INTO inventory_item_images (
         item_id, sku, item_name, image_url, image_source, image_cached_at, last_checked_at, missing_reason, content_type, file_size, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, NOW())
       ON CONFLICT (item_id) WHERE (item_id IS NOT NULL AND item_id <> '') DO UPDATE SET
         sku = COALESCE(EXCLUDED.sku, inventory_item_images.sku),
         item_name = COALESCE(EXCLUDED.item_name, inventory_item_images.item_name),
         ${imageUrlClause},
         image_source = COALESCE(EXCLUDED.image_source, inventory_item_images.image_source),
         image_cached_at = CASE
           WHEN EXCLUDED.image_url IS NOT NULL THEN EXCLUDED.image_cached_at
           WHEN EXCLUDED.image_url IS NULL AND EXCLUDED.missing_reason IS NOT NULL THEN inventory_item_images.image_cached_at
           ELSE inventory_item_images.image_cached_at
         END,
         last_checked_at = NOW(),
         missing_reason = EXCLUDED.missing_reason,
         content_type = COALESCE(EXCLUDED.content_type, inventory_item_images.content_type),
         file_size = COALESCE(EXCLUDED.file_size, inventory_item_images.file_size),
         updated_at = NOW()`,
      [itemId, sku || null, itemName, imageUrl, imageSource, imageCachedAt, missingReason, contentType, fileSize],
    )
    return
  }

  if (!sku) return
  const skuKey = normalizeSkuKey(sku)
  await query(
    `INSERT INTO inventory_item_images (
       item_id, sku, item_name, image_url, image_source, image_cached_at, last_checked_at, missing_reason, content_type, file_size, updated_at
     ) VALUES (NULL, $1, $2, $3, $4, $5, NOW(), $6, $7, $8, NOW())
     ON CONFLICT (LOWER(sku)) WHERE (item_id IS NULL OR item_id = '') AND sku IS NOT NULL AND sku <> '' DO UPDATE SET
       item_name = COALESCE(EXCLUDED.item_name, inventory_item_images.item_name),
       image_url = COALESCE(EXCLUDED.image_url, inventory_item_images.image_url),
       image_source = COALESCE(EXCLUDED.image_source, inventory_item_images.image_source),
       image_cached_at = COALESCE(EXCLUDED.image_cached_at, inventory_item_images.image_cached_at),
       last_checked_at = NOW(),
       missing_reason = EXCLUDED.missing_reason,
       content_type = COALESCE(EXCLUDED.content_type, inventory_item_images.content_type),
       file_size = COALESCE(EXCLUDED.file_size, inventory_item_images.file_size),
       updated_at = NOW()`,
    [skuKey, itemName, imageUrl, imageSource, imageCachedAt, missingReason, contentType, fileSize],
  )
}

async function getImageCacheStatus({ sampleMissingLimit = 10 } = {}) {
  const stats = await query(`
    SELECT
      COUNT(*) FILTER (
        WHERE image_url IS NOT NULL
          AND image_url <> ''
          AND image_url LIKE '/uploads/inventory-item-images/%'
      ) AS cached_images,
      COUNT(*) FILTER (
        WHERE (image_url IS NULL OR image_url = '' OR image_url NOT LIKE '/uploads/inventory-item-images/%')
          AND missing_reason IN (
            'no_image_on_zoho_endpoint',
            'zoho_image_not_found',
            'no_image_metadata',
            'no_list_image_metadata'
          )
      ) AS no_image_in_zoho,
      COUNT(*) FILTER (
        WHERE (image_url IS NULL OR image_url = '' OR image_url NOT LIKE '/uploads/inventory-item-images/%')
          AND (missing_reason IS NULL OR missing_reason NOT IN (
            'no_image_on_zoho_endpoint',
            'zoho_image_not_found',
            'no_image_metadata',
            'no_list_image_metadata'
          ))
      ) AS missing_images,
      MAX(last_checked_at) AS last_sync_at
    FROM inventory_item_images
  `)
  const row = stats.rows[0] || {}
  const cachedImages = Number(row.cached_images) || 0
  const noImageInZoho = Number(row.no_image_in_zoho) || 0
  const missingImages = Number(row.missing_images) || 0
  const totalCachedRows = cachedImages + noImageInZoho + missingImages

  const sampleRes = await query(
    `SELECT item_id, sku, item_name, missing_reason
     FROM inventory_item_images
     WHERE image_url IS NULL OR image_url = '' OR image_url NOT LIKE '/uploads/inventory-item-images/%'
     ORDER BY last_checked_at DESC NULLS LAST
     LIMIT $1`,
    [Math.max(1, Math.min(Number(sampleMissingLimit) || 10, 50))],
  )

  return {
    totalActiveItems: null,
    cachedImages,
    noImageInZoho,
    missingImages,
    cacheCoveragePercent: totalCachedRows > 0 ? Math.round((cachedImages / totalCachedRows) * 1000) / 10 : 0,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
    sampleMissing: sampleRes.rows.map((r) => ({
      sku: cleanStr(r.sku, 512) || null,
      itemName: r.item_name != null ? String(r.item_name) : null,
      itemId: cleanStr(r.item_id, 64) || null,
      reason: r.missing_reason != null ? String(r.missing_reason) : null,
    })),
  }
}

async function getImageCacheDebugInfo() {
  const stats = await getImageCacheStatus({ sampleMissingLimit: 3 })
  const sampleRes = await query(
    `SELECT item_id, sku, image_url, file_size, content_type
     FROM inventory_item_images
     WHERE image_url LIKE '/uploads/inventory-item-images/%'
     ORDER BY updated_at DESC
     LIMIT 5`,
  )
  const { fileExistsForPublicUrl } = require('./inventoryItemImageStorage')
  return {
    cachedRows: stats.cachedImages,
    missingRows: stats.missingImages,
    sampleCachedUrls: sampleRes.rows.map((r) => ({
      itemId: cleanStr(r.item_id, 64) || null,
      sku: cleanStr(r.sku, 512) || null,
      imageUrl: r.image_url != null ? String(r.image_url) : null,
      fileExists: r.image_url ? fileExistsForPublicUrl(String(r.image_url)) : false,
      contentType: r.content_type != null ? String(r.content_type) : null,
      fileSize: r.file_size != null ? Number(r.file_size) : null,
    })),
  }
}

async function attachImageFieldsToRows(rows) {
  const { fileExistsForPublicUrl, apiImageUrlForItem } = require('./inventoryItemImageStorage')
  const itemIds = (rows || []).map((r) => r.itemId).filter(Boolean)
  const cacheMap = await getCachedImagesByItemIds(itemIds)
  return (rows || []).map((row) => {
    const cached = row.itemId ? cacheMap.get(String(row.itemId).trim()) : null
    const hasFile =
      cached?.imageUrl &&
      isPermanentCachedImageUrl(cached.imageUrl) &&
      fileExistsForPublicUrl(cached.imageUrl)
    if (hasFile) {
      return {
        ...row,
        imageUrl: apiImageUrlForItem(row.itemId),
        imageSource: cached.imageSource,
        imageCachedAt: cached.imageCachedAt,
        imageMissing: false,
      }
    }
    return {
      ...row,
      imageUrl: null,
      imageSource: cached?.imageSource || null,
      imageCachedAt: cached?.imageCachedAt || null,
      imageMissing: true,
    }
  })
}

module.exports = {
  ensureInventoryItemImageTables,
  getCachedImagesByItemIds,
  getAllCachedByItemId,
  upsertInventoryItemImage,
  getImageCacheStatus,
  getImageCacheDebugInfo,
  attachImageFieldsToRows,
  _internals: {
    cleanStr,
    normalizeSkuKey,
    mapRow,
  },
}
