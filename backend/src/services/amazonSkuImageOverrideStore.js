/**
 * Admin-managed HTTPS image URLs for order/dashboard thumbnails when catalog cache has no image.
 * Safe fields only — no secrets, no Amazon raw payload.
 */

const { query } = require('../db')

const MAX_URL_LEN = 2048
const MAX_SKU_LEN = 512
const MAX_NOTES_LEN = 2000

function normalizeMarketplaceKeyForOverride(mk) {
  if (mk == null || String(mk).trim() === '') return null
  const k = String(mk).trim().toLowerCase()
  if (k === 'ksa') return 'ksa'
  if (k === 'uae') return 'uae'
  return null
}

function normalizeAsin(a) {
  const s = String(a || '').trim().toUpperCase()
  if (s.length < 10 || s.length > 32) return ''
  return s
}

/**
 * @param {string|null|undefined} url
 * @returns {string|null} normalized https URL or null if invalid
 */
function validateManualImageUrl(url) {
  if (url == null || typeof url !== 'string') return null
  const t = url.trim()
  if (t.length === 0 || t.length > MAX_URL_LEN) return null
  const lower = t.toLowerCase()
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:') ||
    lower.startsWith('http://')
  ) {
    return null
  }
  if (!lower.startsWith('https://')) return null
  try {
    // eslint-disable-next-line no-new
    new URL(t)
  } catch {
    return null
  }
  return t
}

async function ensureAmazonSkuImageOverrideTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_sku_image_overrides (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key TEXT NULL,
      seller_sku TEXT NOT NULL,
      asin TEXT NULL,
      image_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT amazon_sku_image_overrides_mk_chk CHECK (
        marketplace_key IS NULL OR marketplace_key IN ('uae', 'ksa')
      )
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_seller_sku
      ON amazon_sku_image_overrides (seller_sku)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_mk_seller
      ON amazon_sku_image_overrides (marketplace_key, seller_sku)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_asin
      ON amazon_sku_image_overrides (asin)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_mk_asin
      ON amazon_sku_image_overrides (marketplace_key, asin)
  `)
}

function rowToSafe(r) {
  return {
    id: String(r.id),
    marketplaceKey: r.marketplace_key != null ? String(r.marketplace_key) : null,
    sellerSku: r.seller_sku != null ? String(r.seller_sku) : '',
    asin: r.asin != null ? String(r.asin).trim().toUpperCase() : null,
    imageUrl: r.image_url != null ? String(r.image_url) : '',
    source: r.source != null ? String(r.source) : 'manual',
    notes: r.notes != null ? String(r.notes).slice(0, MAX_NOTES_LEN) : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }
}

/**
 * @param {{ marketplaceKey?: string|null, sellerSkus?: string[], asins?: string[] }} opts
 */
async function getSkuImageOverrides(opts = {}) {
  const mk = normalizeMarketplaceKeyForOverride(opts.marketplaceKey)
  const skus = Array.isArray(opts.sellerSkus) ? opts.sellerSkus : []
  const asins = Array.isArray(opts.asins) ? opts.asins.map((a) => normalizeAsin(a)).filter(Boolean) : []

  const clauses = []
  const params = []
  let p = 1

  if (mk != null) {
    clauses.push(`(marketplace_key IS NULL OR marketplace_key = $${p})`)
    params.push(mk)
    p += 1
  }

  if (skus.length) {
    clauses.push(`seller_sku = ANY($${p}::text[])`)
    params.push(skus.map((s) => String(s).trim().slice(0, MAX_SKU_LEN)))
    p += 1
  }

  if (asins.length) {
    clauses.push(`(asin IS NOT NULL AND upper(trim(asin)) = ANY($${p}::text[]))`)
    params.push(asins)
    p += 1
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const maxRows = 2000
  params.push(maxRows)
  const res = await query(
    `SELECT id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at
     FROM amazon_sku_image_overrides
     ${where}
     ORDER BY updated_at DESC
     LIMIT $${p}`,
    params
  )
  return res.rows.map(rowToSafe)
}

/**
 * Priority (after catalog): 5 = mk+sellerSku, 4 = global+sellerSku, 3 = mk+ASIN, 2 = global ASIN.
 * @param {object} row
 * @param {'uae'|'ksa'} orderMk
 * @param {string} sellerSku trimmed
 * @param {string} asin normalized or ''
 * @returns {number} 0 = no match, higher = better
 */
function overrideRowPriority(row, orderMk, sellerSku, asin) {
  const rmk = row.marketplace_key != null ? String(row.marketplace_key).toLowerCase() : null
  const rsku = String(row.seller_sku || '').trim()
  const rasin = row.asin != null ? normalizeAsin(row.asin) : ''

  if (rsku !== '') {
    if (!sellerSku || rsku !== sellerSku) return 0
    if (rmk === orderMk) return 5
    if (rmk === null) return 4
    return 0
  }
  if (!rasin || !asin || rasin !== asin) return 0
  if (rmk === orderMk) return 3
  if (rmk === null) return 2
  return 0
}

/**
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {Array<{ sellerSku?: string|null, asin?: string|null }>} pairs
 * @returns {Promise<Map<string, { imageUrl: string, imageSource: 'sku_override'|'asin_override' }>>} key = `${sellerSku}\t${asin}`
 */
async function batchResolveSkuImageOverrides(marketplaceKey, pairs) {
  const orderMk = marketplaceKey === 'ksa' ? 'ksa' : 'uae'
  const map = new Map()

  const normPairs = []
  const seenKeys = new Set()
  for (const p of pairs || []) {
    const sku = p.sellerSku != null ? String(p.sellerSku).trim().slice(0, MAX_SKU_LEN) : ''
    const asin = p.asin != null ? normalizeAsin(p.asin) : ''
    const key = `${sku}\t${asin}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    normPairs.push({ sku, asin, key })
  }
  if (!normPairs.length) return map

  const skuList = [...new Set(normPairs.map((x) => x.sku).filter((s) => s !== ''))]
  const asinList = [...new Set(normPairs.map((x) => x.asin).filter(Boolean))]

  if (!skuList.length && !asinList.length) return map

  const orParts = []
  const params = [orderMk]
  let p = 2
  if (skuList.length) {
    orParts.push(`(btrim(seller_sku) <> '' AND seller_sku = ANY($${p}::text[]))`)
    params.push(skuList)
    p += 1
  }
  if (asinList.length) {
    orParts.push(
      `(btrim(seller_sku) = '' AND asin IS NOT NULL AND upper(trim(asin)) = ANY($${p}::text[]))`
    )
    params.push(asinList)
    p += 1
  }

  const res = await query(
    `SELECT id, marketplace_key, seller_sku, asin, image_url, updated_at
     FROM amazon_sku_image_overrides
     WHERE (marketplace_key IS NULL OR marketplace_key = $1)
       AND (${orParts.join(' OR ')})`,
    params
  )

  const rows = res.rows

  for (const { sku, asin, key } of normPairs) {
    let bestPri = 0
    let bestTs = -1
    let bestRow = null
    for (const r of rows) {
      const pri = overrideRowPriority(r, orderMk, sku, asin)
      if (pri === 0) continue
      const ts = r.updated_at ? new Date(r.updated_at).getTime() : 0
      if (pri > bestPri || (pri === bestPri && ts > bestTs)) {
        bestPri = pri
        bestTs = ts
        bestRow = r
      }
    }
    if (!bestRow || bestPri === 0) continue
    const url = validateManualImageUrl(bestRow.image_url)
    if (!url) continue
    const imageSource = String(bestRow.seller_sku || '').trim() !== '' ? 'sku_override' : 'asin_override'
    map.set(key, { imageUrl: url, imageSource })
  }

  return map
}

/**
 * @param {{ marketplaceKey: 'uae'|'ksa', sellerSku?: string|null, asin?: string|null }} opts
 * @returns {Promise<{ imageUrl: string|null, imageSource: 'sku_override'|'asin_override'|null }>}
 */
async function findBestSkuImageOverride(opts) {
  const mk = opts.marketplaceKey === 'ksa' ? 'ksa' : 'uae'
  const sku = opts.sellerSku != null ? String(opts.sellerSku).trim().slice(0, MAX_SKU_LEN) : ''
  const asin = opts.asin != null ? normalizeAsin(opts.asin) : ''
  const m = await batchResolveSkuImageOverrides(mk, [{ sellerSku: sku, asin }])
  const hit = m.get(`${sku}\t${asin}`)
  if (hit) return { imageUrl: hit.imageUrl, imageSource: hit.imageSource }
  return { imageUrl: null, imageSource: null }
}

/**
 * @param {{
 *   marketplaceKey?: string|null,
 *   sellerSku: string,
 *   asin?: string|null,
 *   imageUrl: string,
 *   source?: string,
 *   notes?: string|null
 * }} opts
 */
async function upsertSkuImageOverride(opts) {
  const imageUrl = validateManualImageUrl(opts.imageUrl)
  if (!imageUrl) {
    const err = new Error('Invalid imageUrl: must be https, max 2048 chars, not javascript/data/file/http')
    err.code = 'AMAZON_SKU_IMAGE_OVERRIDE_VALIDATION'
    throw err
  }

  let sellerSku = opts.sellerSku != null ? String(opts.sellerSku).trim().slice(0, MAX_SKU_LEN) : ''
  const asinNorm = opts.asin != null ? normalizeAsin(opts.asin) : ''
  const mk = normalizeMarketplaceKeyForOverride(opts.marketplaceKey)

  if (!sellerSku && !asinNorm) {
    const err = new Error('sellerSku or asin is required')
    err.code = 'AMAZON_SKU_IMAGE_OVERRIDE_VALIDATION'
    throw err
  }

  if (!sellerSku) {
    sellerSku = ''
  }

  const source = opts.source != null ? String(opts.source).trim().slice(0, 64) || 'manual' : 'manual'
  const notes =
    opts.notes != null && String(opts.notes).trim() ? String(opts.notes).trim().slice(0, MAX_NOTES_LEN) : null

  const isAsinOnly = sellerSku === ''

  if (isAsinOnly && !asinNorm) {
    const err = new Error('asin is required for marketplace+ASIN or global ASIN overrides')
    err.code = 'AMAZON_SKU_IMAGE_OVERRIDE_VALIDATION'
    throw err
  }

  if (isAsinOnly) {
    const upd = await query(
      `UPDATE amazon_sku_image_overrides
       SET image_url = $1, source = $2, notes = $3, updated_at = NOW(), asin = $4
       WHERE marketplace_key IS NOT DISTINCT FROM $5
         AND btrim(seller_sku) = ''
         AND upper(trim(asin)) = $6
       RETURNING id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at`,
      [imageUrl, source, notes, asinNorm, mk, asinNorm]
    )
    if (upd.rows.length) return rowToSafe(upd.rows[0])
    const ins = await query(
      `INSERT INTO amazon_sku_image_overrides (marketplace_key, seller_sku, asin, image_url, source, notes)
       VALUES ($1, '', $2, $3, $4, $5)
       RETURNING id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at`,
      [mk, asinNorm, imageUrl, source, notes]
    )
    return rowToSafe(ins.rows[0])
  }

  const upd = await query(
    `UPDATE amazon_sku_image_overrides
     SET image_url = $1, asin = $2, source = $3, notes = $4, updated_at = NOW()
     WHERE marketplace_key IS NOT DISTINCT FROM $5
       AND seller_sku = $6
       AND btrim(seller_sku) <> ''
     RETURNING id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at`,
    [imageUrl, asinNorm || null, source, notes, mk, sellerSku]
  )
  if (upd.rows.length) return rowToSafe(upd.rows[0])
  const ins = await query(
    `INSERT INTO amazon_sku_image_overrides (marketplace_key, seller_sku, asin, image_url, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at`,
    [mk, sellerSku, asinNorm || null, imageUrl, source, notes]
  )
  return rowToSafe(ins.rows[0])
}

/**
 * Admin list with optional filters.
 * @param {{ marketplaceKey?: string|null, sellerSku?: string|null, asin?: string|null, limit?: number }} filters
 */
async function listSkuImageOverridesForAdmin(filters = {}) {
  const limit = Math.min(500, Math.max(1, parseInt(String(filters.limit || 200), 10) || 200))
  const clauses = []
  const params = []
  let p = 1

  const mk = normalizeMarketplaceKeyForOverride(filters.marketplaceKey)
  if (filters.marketplaceKey != null && String(filters.marketplaceKey).trim() !== '' && mk == null) {
    return []
  }
  if (mk != null) {
    clauses.push(`(marketplace_key IS NULL OR marketplace_key = $${p})`)
    params.push(mk)
    p += 1
  }

  if (filters.sellerSku != null && String(filters.sellerSku).trim() !== '') {
    clauses.push(`seller_sku = $${p}`)
    params.push(String(filters.sellerSku).trim().slice(0, MAX_SKU_LEN))
    p += 1
  }

  if (filters.asin != null && String(filters.asin).trim() !== '') {
    const a = normalizeAsin(filters.asin)
    if (a) {
      clauses.push(`upper(trim(asin)) = $${p}`)
      params.push(a)
      p += 1
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  params.push(limit)
  const res = await query(
    `SELECT id, marketplace_key, seller_sku, asin, image_url, source, notes, created_at, updated_at
     FROM amazon_sku_image_overrides
     ${where}
     ORDER BY updated_at DESC
     LIMIT $${p}`,
    params
  )
  return res.rows.map(rowToSafe)
}

module.exports = {
  ensureAmazonSkuImageOverrideTables,
  validateManualImageUrl,
  normalizeMarketplaceKeyForOverride,
  normalizeAsin,
  getSkuImageOverrides,
  batchResolveSkuImageOverrides,
  findBestSkuImageOverride,
  upsertSkuImageOverride,
  listSkuImageOverridesForAdmin,
}
