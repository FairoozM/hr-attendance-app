/**
 * AmazonCatalogItemCache — DB-backed cache for catalog summaries / images (no secrets, no buyer PII).
 */

const { query } = require('../db')

function normalizeMk(marketplaceKey) {
  return String(marketplaceKey || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
}

function normalizeAsin(a) {
  const s = String(a || '').trim().toUpperCase()
  if (s.length < 10 || s.length > 32) return ''
  return s
}

async function ensureAmazonCatalogItemCacheTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_catalog_item_cache (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      asin VARCHAR(32) NOT NULL,
      seller_sku VARCHAR(512),
      title TEXT,
      image_url TEXT,
      brand VARCHAR(512),
      raw_safe_json JSONB,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (marketplace_key, asin)
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_amazon_catalog_item_cache_mk_synced
      ON amazon_catalog_item_cache (marketplace_key, last_synced_at DESC)
  `)
}

/**
 * @param {string} marketplaceKey
 * @param {string[]} asins
 * @returns {Promise<Map<string, { asin: string, sellerSku: string|null, title: string|null, imageUrl: string|null, brand: string|null, rawSafeJson: object|null, lastSyncedAt: Date }>>}
 */
async function getCatalogItemCacheByAsins(marketplaceKey, asins) {
  const mk = normalizeMk(marketplaceKey)
  const unique = []
  const seen = new Set()
  for (const a of asins || []) {
    const x = normalizeAsin(a)
    if (!x || seen.has(x)) continue
    seen.add(x)
    unique.push(x)
  }
  const out = new Map()
  if (!unique.length) return out

  const res = await query(
    `SELECT asin, seller_sku, title, image_url, brand, raw_safe_json, last_synced_at
     FROM amazon_catalog_item_cache
     WHERE marketplace_key = $1 AND asin = ANY($2::varchar[])`,
    [mk, unique]
  )
  for (const r of res.rows) {
    const asin = normalizeAsin(r.asin)
    if (!asin) continue
    out.set(asin, {
      asin,
      sellerSku: r.seller_sku != null ? String(r.seller_sku) : null,
      title: r.title != null ? String(r.title) : null,
      imageUrl: r.image_url != null ? String(r.image_url) : null,
      brand: r.brand != null ? String(r.brand) : null,
      rawSafeJson: r.raw_safe_json && typeof r.raw_safe_json === 'object' ? r.raw_safe_json : null,
      lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at) : new Date(0),
    })
  }
  return out
}

/**
 * @param {string} marketplaceKey
 * @param {Array<{ asin: string, sellerSku?: string|null, title?: string|null, imageUrl?: string|null, brand?: string|null, rawSafeJson?: object|null }>} rows
 * @param {{ forceReplaceImageUrl?: boolean }} [opts] — when true, `image_url` is always set from the row (including null) after a forced live catalog fetch.
 */
async function upsertCatalogItemCacheRows(marketplaceKey, rows, opts = {}) {
  const mk = normalizeMk(marketplaceKey)
  if (!rows || !rows.length) return
  const forceReplaceImageUrl = Boolean(opts && opts.forceReplaceImageUrl)
  const imageUrlSetClause = forceReplaceImageUrl
    ? 'image_url = EXCLUDED.image_url'
    : 'image_url = COALESCE(EXCLUDED.image_url, amazon_catalog_item_cache.image_url)'
  const now = new Date()
  for (const row of rows) {
    const asin = normalizeAsin(row.asin)
    if (!asin) continue
    const sellerSku = row.sellerSku != null && String(row.sellerSku).trim() ? String(row.sellerSku).trim().slice(0, 512) : null
    const title = row.title != null && String(row.title).trim() ? String(row.title).trim().slice(0, 2000) : null
    const imageUrl = row.imageUrl != null && String(row.imageUrl).trim() ? String(row.imageUrl).trim().slice(0, 2048) : null
    const brand = row.brand != null && String(row.brand).trim() ? String(row.brand).trim().slice(0, 512) : null
    const rawSafeJson = row.rawSafeJson && typeof row.rawSafeJson === 'object' ? row.rawSafeJson : null
    await query(
      `INSERT INTO amazon_catalog_item_cache (
         marketplace_key, asin, seller_sku, title, image_url, brand, raw_safe_json, last_synced_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
       ON CONFLICT (marketplace_key, asin) DO UPDATE SET
         seller_sku = COALESCE(EXCLUDED.seller_sku, amazon_catalog_item_cache.seller_sku),
         title = COALESCE(EXCLUDED.title, amazon_catalog_item_cache.title),
         ${imageUrlSetClause},
         brand = COALESCE(EXCLUDED.brand, amazon_catalog_item_cache.brand),
         raw_safe_json = COALESCE(EXCLUDED.raw_safe_json, amazon_catalog_item_cache.raw_safe_json),
         last_synced_at = EXCLUDED.last_synced_at,
         updated_at = NOW()`,
      [mk, asin, sellerSku, title, imageUrl, brand, rawSafeJson ? JSON.stringify(rawSafeJson) : null, now]
    )
  }
}

/**
 * Mark ASIN as synced without overwriting image/title when the catalog batch omitted this ASIN
 * (keeps prior thumbnail if any).
 * @param {string} marketplaceKey
 * @param {string} asin
 * @param {string|null} [sellerSku]
 */
async function touchCatalogItemCacheLastSynced(marketplaceKey, asin, sellerSku = null) {
  const mk = normalizeMk(marketplaceKey)
  const a = normalizeAsin(asin)
  if (!a) return
  const sku = sellerSku != null && String(sellerSku).trim() ? String(sellerSku).trim().slice(0, 512) : null
  const now = new Date()
  await query(
    `INSERT INTO amazon_catalog_item_cache (
       marketplace_key, asin, seller_sku, title, image_url, brand, raw_safe_json, last_synced_at, updated_at
     ) VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, $4, NOW())
     ON CONFLICT (marketplace_key, asin) DO UPDATE SET
       seller_sku = COALESCE(EXCLUDED.seller_sku, amazon_catalog_item_cache.seller_sku),
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = NOW()`,
    [mk, a, sku, now]
  )
}

module.exports = {
  ensureAmazonCatalogItemCacheTables,
  getCatalogItemCacheByAsins,
  upsertCatalogItemCacheRows,
  touchCatalogItemCacheLastSynced,
  normalizeCatalogCacheMarketplaceKey: normalizeMk,
  normalizeCatalogCacheAsin: normalizeAsin,
}
