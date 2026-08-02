const { query, pool } = require('../db')

async function ensureAmazonZohoStockComparisonTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_zoho_stock_comparison (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      marketplace VARCHAR(16) NOT NULL,
      marketplace_id VARCHAR(32),
      seller_sku VARCHAR(512) NOT NULL,
      normalized_sku VARCHAR(512) NOT NULL,
      asin VARCHAR(32),
      title TEXT,
      image TEXT,
      listing_status VARCHAR(64),
      fulfillment_channel VARCHAR(64),
      price_amount NUMERIC(16, 4),
      price_currency_code VARCHAR(8),
      amazon_available_qty NUMERIC(16, 4),
      amazon_inbound_qty NUMERIC(16, 4),
      amazon_reserved_qty NUMERIC(16, 4),
      amazon_unfulfillable_qty NUMERIC(16, 4),
      amazon_total_qty NUMERIC(16, 4),
      amazon_stock_status VARCHAR(32) NOT NULL DEFAULT 'Unknown',
      zoho_item_id VARCHAR(100),
      zoho_sku VARCHAR(512),
      zoho_normalized_sku VARCHAR(512),
      zoho_item_name TEXT,
      zoho_item_type VARCHAR(32),
      zoho_warehouse_name TEXT,
      zoho_available_qty NUMERIC(16, 4),
      zoho_actual_qty NUMERIC(16, 4),
      zoho_committed_qty NUMERIC(16, 4),
      zoho_stock_status VARCHAR(32) NOT NULL DEFAULT 'Unknown',
      noon_partner_sku VARCHAR(512),
      noon_sku VARCHAR(512),
      noon_title TEXT,
      noon_country_code VARCHAR(8),
      noon_is_active BOOLEAN,
      noon_listing_status VARCHAR(64),
      noon_stock_qty NUMERIC(16, 4),
      noon_stock_synced_at TIMESTAMPTZ,
      noon_catalog_synced_at TIMESTAMPTZ,
      difference NUMERIC(16, 4),
      is_mismatch BOOLEAN NOT NULL DEFAULT false,
      recommended_action TEXT,
      amazon_last_fetched_at TIMESTAMPTZ,
      zoho_last_fetched_at TIMESTAMPTZ,
      comparison_generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_safe_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (marketplace_key, normalized_sku)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_zoho_stock_mk ON amazon_zoho_stock_comparison (marketplace_key, normalized_sku)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_zoho_stock_status ON amazon_zoho_stock_comparison (amazon_stock_status, zoho_stock_status)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_zoho_stock_generated ON amazon_zoho_stock_comparison (comparison_generated_at DESC)`
  )
  await query(`
    ALTER TABLE amazon_zoho_stock_comparison
      ADD COLUMN IF NOT EXISTS noon_partner_sku VARCHAR(512),
      ADD COLUMN IF NOT EXISTS noon_sku VARCHAR(512),
      ADD COLUMN IF NOT EXISTS noon_title TEXT,
      ADD COLUMN IF NOT EXISTS noon_country_code VARCHAR(8),
      ADD COLUMN IF NOT EXISTS noon_is_active BOOLEAN,
      ADD COLUMN IF NOT EXISTS noon_listing_status VARCHAR(64),
      ADD COLUMN IF NOT EXISTS noon_stock_qty NUMERIC(16, 4),
      ADD COLUMN IF NOT EXISTS noon_stock_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS noon_catalog_synced_at TIMESTAMPTZ
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_zoho_stock_noon ON amazon_zoho_stock_comparison (marketplace_key, noon_is_active, noon_partner_sku)`
  )
}

function numOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function replaceMarketplaceRows(marketplaceKey, rows) {
  const mk = String(marketplaceKey || '').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM amazon_zoho_stock_comparison WHERE marketplace_key = $1`, [mk])
    for (const row of Array.isArray(rows) ? rows : []) {
      await client.query(
        `INSERT INTO amazon_zoho_stock_comparison (
          marketplace_key, marketplace, marketplace_id, seller_sku, normalized_sku, asin, title, image,
          listing_status, fulfillment_channel, price_amount, price_currency_code,
          amazon_available_qty, amazon_inbound_qty, amazon_reserved_qty, amazon_unfulfillable_qty,
          amazon_total_qty, amazon_stock_status,
          zoho_item_id, zoho_sku, zoho_normalized_sku, zoho_item_name, zoho_item_type, zoho_warehouse_name,
          zoho_available_qty, zoho_actual_qty, zoho_committed_qty, zoho_stock_status,
          noon_partner_sku, noon_sku, noon_title, noon_country_code, noon_is_active, noon_listing_status,
          noon_stock_qty, noon_stock_synced_at, noon_catalog_synced_at,
          difference, is_mismatch, recommended_action,
          amazon_last_fetched_at, zoho_last_fetched_at, comparison_generated_at,
          warnings, raw_safe_json, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
          $41,$42,$43,$44::jsonb,$45::jsonb,NOW(),NOW()
        )`,
        [
          row.marketplaceKey,
          row.marketplace,
          row.marketplaceId || null,
          row.sellerSku,
          row.normalizedSku,
          row.asin || null,
          row.title || null,
          row.image || null,
          row.listingStatus || null,
          row.fulfillmentChannel || null,
          numOrNull(row.price?.amount),
          row.price?.currencyCode || null,
          numOrNull(row.amazon?.availableQty),
          numOrNull(row.amazon?.inboundQty),
          numOrNull(row.amazon?.reservedQty),
          numOrNull(row.amazon?.unfulfillableQty),
          numOrNull(row.amazon?.totalQty),
          row.amazon?.stockStatus || 'Unknown',
          row.zoho?.itemId || null,
          row.zoho?.sku || null,
          row.zoho?.normalizedSku || null,
          row.zoho?.itemName || null,
          row.zoho?.itemType || null,
          row.zoho?.warehouseName || null,
          numOrNull(row.zoho?.availableQty),
          numOrNull(row.zoho?.actualQty),
          numOrNull(row.zoho?.committedQty),
          row.zoho?.stockStatus || 'Unknown',
          row.noon?.partnerSku || null,
          row.noon?.sku || null,
          row.noon?.title || null,
          row.noon?.countryCode || null,
          typeof row.noon?.isActive === 'boolean' ? row.noon.isActive : null,
          row.noon?.listingStatus || null,
          numOrNull(row.noon?.stockQty),
          row.noon?.stockSyncedAt || null,
          row.noon?.catalogSyncedAt || null,
          numOrNull(row.comparison?.difference),
          Boolean(row.comparison?.isMismatch),
          row.comparison?.recommendedAction || null,
          row.timestamps?.amazonLastFetchedAt || null,
          row.timestamps?.zohoLastFetchedAt || null,
          row.timestamps?.comparisonGeneratedAt || new Date().toISOString(),
          JSON.stringify(row.warnings || []),
          JSON.stringify(row.rawSafeJson || {}),
        ]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return { rowsInserted: Array.isArray(rows) ? rows.length : 0 }
}

function mapDbRow(r) {
  const amazonLastFetchedAt = r.amazon_last_fetched_at ? new Date(r.amazon_last_fetched_at).toISOString() : null
  const zohoLastFetchedAt = r.zoho_last_fetched_at ? new Date(r.zoho_last_fetched_at).toISOString() : null
  const noonStockSyncedAt = r.noon_stock_synced_at ? new Date(r.noon_stock_synced_at).toISOString() : null
  const noonCatalogSyncedAt = r.noon_catalog_synced_at ? new Date(r.noon_catalog_synced_at).toISOString() : null
  const comparisonGeneratedAt = r.comparison_generated_at ? new Date(r.comparison_generated_at).toISOString() : null
  return {
    marketplace: r.marketplace,
    marketplaceId: r.marketplace_id || '',
    sellerSku: r.seller_sku,
    normalizedSku: r.normalized_sku,
    asin: r.asin || '',
    title: r.title || '',
    image: r.image || '',
    listingStatus: r.listing_status || '',
    fulfillmentChannel: r.fulfillment_channel || '',
    price: {
      amount: r.price_amount == null ? null : Number(r.price_amount),
      currencyCode: r.price_currency_code || '',
    },
    amazon: {
      availableQty: r.amazon_available_qty == null ? null : Number(r.amazon_available_qty),
      totalQty: r.amazon_total_qty == null ? null : Number(r.amazon_total_qty),
      stockStatus: r.amazon_stock_status || 'Unknown',
    },
    zoho: {
      itemId: r.zoho_item_id || '',
      sku: r.zoho_sku || '',
      normalizedSku: r.zoho_normalized_sku || r.normalized_sku,
      itemName: r.zoho_item_name || '',
      itemType: r.zoho_item_type || '',
      warehouseName: r.zoho_warehouse_name || '',
      availableQty: r.zoho_available_qty == null ? null : Number(r.zoho_available_qty),
      stockStatus: r.zoho_stock_status || 'Unknown',
    },
    noon: {
      partnerSku: r.noon_partner_sku || '',
      sku: r.noon_sku || '',
      title: r.noon_title || '',
      countryCode: r.noon_country_code || '',
      isActive: typeof r.noon_is_active === 'boolean' ? r.noon_is_active : null,
      listingStatus: r.noon_listing_status || (r.noon_partner_sku ? 'ACTIVE' : 'Not Found'),
      stockQty: r.noon_stock_qty == null ? null : Number(r.noon_stock_qty),
      stockSyncedAt: noonStockSyncedAt,
      catalogSyncedAt: noonCatalogSyncedAt,
    },
    comparison: {
      difference: r.difference == null ? null : Number(r.difference),
      isMismatch: Boolean(r.is_mismatch),
      recommendedAction: r.recommended_action || '',
    },
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    timestamps: {
      amazonLastFetchedAt,
      zohoLastFetchedAt,
      comparisonGeneratedAt,
    },
  }
}

function appendListingStatusScope(clauses, stockFilter) {
  const sf = String(stockFilter || 'all').trim()
  if (sf === 'sellerCentralInactiveOos') {
    clauses.push(`listing_status = 'INACTIVE_OOS'`)
    return
  }
  if (sf === 'amazonNotFound') {
    clauses.push(`listing_status = 'ZOHO_ONLY'`)
    return
  }
  if (sf === 'noonLiveAmazonMissing' || sf === 'noonOutOfStock') return
  clauses.push(`listing_status = 'ACTIVE'`)
  clauses.push(`UPPER(COALESCE(fulfillment_channel, '')) LIKE '%AMAZON%'`)
}

function buildWhere(filters = {}) {
  const clauses = []
  const values = []
  const marketplace = String(filters.marketplace || 'all').trim().toLowerCase()
  if (marketplace === 'uae' || marketplace === 'ksa') {
    values.push(marketplace)
    clauses.push(`marketplace_key = $${values.length}`)
  }
  const listingScope = String(filters.listingScope || '').trim().toLowerCase()
  const stockFilter = String(filters.stockFilter || 'all').trim()
  if (listingScope === 'coverage') {
    // SKU Channel Coverage indexes Amazon listings only — exclude Zoho-only anti-join rows.
    clauses.push(`COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY')`)
  } else {
    appendListingStatusScope(clauses, stockFilter)
  }
  const search = String(filters.search || '').trim()
  if (search) {
    values.push(`%${search.toLowerCase()}%`)
    clauses.push(`(
      LOWER(seller_sku) LIKE $${values.length}
      OR LOWER(normalized_sku) LIKE $${values.length}
      OR LOWER(COALESCE(asin, '')) LIKE $${values.length}
      OR LOWER(COALESCE(title, '')) LIKE $${values.length}
      OR LOWER(COALESCE(noon_partner_sku, '')) LIKE $${values.length}
      OR LOWER(COALESCE(noon_sku, '')) LIKE $${values.length}
      OR LOWER(COALESCE(noon_title, '')) LIKE $${values.length}
    )`)
  }
  if (stockFilter === 'amazonOutOfStock') {
    clauses.push(
      `GREATEST(COALESCE(amazon_total_qty, 0), COALESCE(amazon_available_qty, 0)) = 0`
    )
  }
  if (stockFilter === 'zohoOutOfStock') clauses.push(`COALESCE(zoho_available_qty, 0) = 0 AND zoho_stock_status <> 'Not Found'`)
  if (stockFilter === 'mismatch') clauses.push(`is_mismatch = true`)
  if (stockFilter === 'bothOutOfStock') {
    clauses.push(
      `GREATEST(COALESCE(amazon_total_qty, 0), COALESCE(amazon_available_qty, 0)) = 0 AND COALESCE(zoho_available_qty, 0) = 0`
    )
  }
  if (stockFilter === 'zohoNotFound') clauses.push(`zoho_stock_status = 'Not Found'`)
  if (stockFilter === 'amazonNoonLive') clauses.push(`noon_is_active IS TRUE`)
  if (stockFilter === 'amazonLiveNoonMissing') {
    clauses.push(`(noon_partner_sku IS NULL OR noon_is_active IS NOT TRUE)`)
  }
  if (stockFilter === 'noonLiveAmazonMissing') {
    clauses.push(`noon_is_active IS TRUE AND amazon_stock_status = 'Not Found'`)
  }
  if (stockFilter === 'noonOutOfStock') {
    clauses.push(`noon_is_active IS TRUE AND COALESCE(noon_stock_qty, 0) = 0`)
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  }
}

async function selectComparisonRows(filters = {}) {
  const page = Math.max(1, parseInt(String(filters.page || 1), 10) || 1)
  const limit = Math.min(500, Math.max(1, parseInt(String(filters.limit || 50), 10) || 50))
  const offset = (page - 1) * limit
  const { whereSql, values } = buildWhere(filters)
  const count = await query(`SELECT COUNT(*)::int AS c FROM amazon_zoho_stock_comparison ${whereSql}`, values)
  const rows = await query(
    `SELECT * FROM amazon_zoho_stock_comparison
     ${whereSql}
     ORDER BY marketplace_key ASC, normalized_sku ASC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  )
  const total = count.rows[0]?.c || 0
  return {
    rows: rows.rows.map(mapDbRow),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  }
}

async function selectAllComparisonRows(filters = {}) {
  const { whereSql, values } = buildWhere(filters)
  const rows = await query(
    `SELECT * FROM amazon_zoho_stock_comparison
     ${whereSql}
     ORDER BY marketplace_key ASC, normalized_sku ASC`,
    values
  )
  return rows.rows.map(mapDbRow)
}

async function selectMarketplaceRowsUnscoped(marketplaceKey) {
  const result = await query(
    `SELECT * FROM amazon_zoho_stock_comparison
     WHERE marketplace_key = $1
     ORDER BY normalized_sku ASC`,
    [String(marketplaceKey).toLowerCase() === 'ksa' ? 'ksa' : 'uae']
  )
  return result.rows.map(mapDbRow)
}

async function updateMarketplaceNoonRows(marketplaceKey, rows) {
  const mk = String(marketplaceKey).toLowerCase() === 'ksa' ? 'ksa' : 'uae'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const row of rows || []) {
      await client.query(
        `UPDATE amazon_zoho_stock_comparison
         SET noon_partner_sku = $3,
             noon_sku = $4,
             noon_title = $5,
             noon_country_code = $6,
             noon_is_active = $7,
             noon_listing_status = $8,
             noon_stock_qty = $9,
             noon_stock_synced_at = $10,
             noon_catalog_synced_at = $11,
             updated_at = NOW()
         WHERE marketplace_key = $1 AND normalized_sku = $2`,
        [
          mk,
          row.normalizedSku,
          row.noon?.partnerSku || null,
          row.noon?.sku || null,
          row.noon?.title || null,
          row.noon?.countryCode || null,
          typeof row.noon?.isActive === 'boolean' ? row.noon.isActive : null,
          row.noon?.listingStatus || null,
          numOrNull(row.noon?.stockQty),
          row.noon?.stockSyncedAt || null,
          row.noon?.catalogSyncedAt || null,
        ]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
  return { rowsUpdated: rows?.length || 0 }
}

async function getComparisonSummary(filters = {}) {
  const marketplace = String(filters.marketplace || 'all').trim().toLowerCase()
  const clauses = []
  const values = []
  if (marketplace === 'uae' || marketplace === 'ksa') {
    values.push(marketplace)
    clauses.push(`marketplace_key = $${values.length}`)
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const r = await query(
    `SELECT
      COUNT(*) FILTER (
        WHERE listing_status = 'ACTIVE'
          AND UPPER(COALESCE(fulfillment_channel, '')) LIKE '%AMAZON%'
      )::int AS total_active_listings,
      COUNT(*) FILTER (
        WHERE listing_status = 'ACTIVE'
          AND GREATEST(COALESCE(amazon_total_qty, 0), COALESCE(amazon_available_qty, 0)) = 0
      )::int AS amazon_out_of_stock,
      COUNT(*) FILTER (WHERE listing_status = 'INACTIVE_OOS')::int AS seller_central_inactive_oos,
      COUNT(*) FILTER (
        WHERE COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY')
          AND COALESCE(zoho_available_qty, 0) = 0
          AND zoho_stock_status <> 'Not Found'
      )::int AS zoho_out_of_stock,
      COUNT(*) FILTER (
        WHERE COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY') AND is_mismatch = true
      )::int AS mismatches,
      COUNT(*) FILTER (
        WHERE COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY') AND zoho_stock_status = 'Not Found'
      )::int AS zoho_not_found,
      COUNT(*) FILTER (
        WHERE COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY')
          AND GREATEST(COALESCE(amazon_total_qty, 0), COALESCE(amazon_available_qty, 0)) = 0
          AND COALESCE(zoho_available_qty, 0) = 0
      )::int AS both_out_of_stock,
      COUNT(*) FILTER (
        WHERE COALESCE(listing_status, '') NOT IN ('ZOHO_ONLY', 'NOON_ONLY')
          AND recommended_action = 'Low Zoho stock warning'
      )::int AS low_zoho_stock,
      COUNT(*) FILTER (WHERE listing_status = 'ZOHO_ONLY')::int AS amazon_not_found,
      COUNT(*) FILTER (
        WHERE listing_status = 'ACTIVE' AND noon_is_active IS TRUE
      )::int AS amazon_noon_live,
      COUNT(*) FILTER (
        WHERE noon_is_active IS TRUE AND amazon_stock_status = 'Not Found'
      )::int AS noon_live_amazon_missing,
      COUNT(*) FILTER (
        WHERE listing_status = 'ACTIVE' AND (noon_partner_sku IS NULL OR noon_is_active IS NOT TRUE)
      )::int AS amazon_live_noon_missing,
      COUNT(*) FILTER (
        WHERE noon_is_active IS TRUE AND COALESCE(noon_stock_qty, 0) = 0
      )::int AS noon_out_of_stock,
      MAX(amazon_last_fetched_at) AS amazon_last_fetched_at,
      MAX(zoho_last_fetched_at) AS zoho_last_fetched_at,
      MAX(noon_catalog_synced_at) AS noon_catalog_synced_at,
      MAX(noon_stock_synced_at) AS noon_stock_synced_at,
      MAX(comparison_generated_at) AS comparison_generated_at
     FROM amazon_zoho_stock_comparison ${whereSql}`,
    values
  )
  const row = r.rows[0] || {}
  return {
    summary: {
      totalActiveListings: Number(row.total_active_listings || 0),
      amazonOutOfStock: Number(row.amazon_out_of_stock || 0),
      sellerCentralInactiveOos: Number(row.seller_central_inactive_oos || 0),
      zohoOutOfStock: Number(row.zoho_out_of_stock || 0),
      mismatches: Number(row.mismatches || 0),
      zohoNotFound: Number(row.zoho_not_found || 0),
      bothOutOfStock: Number(row.both_out_of_stock || 0),
      lowZohoStock: Number(row.low_zoho_stock || 0),
      amazonNotFound: Number(row.amazon_not_found || 0),
      amazonNoonLive: Number(row.amazon_noon_live || 0),
      noonLiveAmazonMissing: Number(row.noon_live_amazon_missing || 0),
      amazonLiveNoonMissing: Number(row.amazon_live_noon_missing || 0),
      noonOutOfStock: Number(row.noon_out_of_stock || 0),
    },
    timestamps: {
      amazonLastFetchedAt: row.amazon_last_fetched_at ? new Date(row.amazon_last_fetched_at).toISOString() : null,
      zohoLastFetchedAt: row.zoho_last_fetched_at ? new Date(row.zoho_last_fetched_at).toISOString() : null,
      noonCatalogSyncedAt: row.noon_catalog_synced_at ? new Date(row.noon_catalog_synced_at).toISOString() : null,
      noonStockSyncedAt: row.noon_stock_synced_at ? new Date(row.noon_stock_synced_at).toISOString() : null,
      comparisonGeneratedAt: row.comparison_generated_at ? new Date(row.comparison_generated_at).toISOString() : null,
    },
  }
}

async function getLatestComparisonGeneratedAt(marketplace = 'all') {
  const mk = String(marketplace || 'all').trim().toLowerCase()
  const params = []
  let where = ''
  if (mk === 'uae' || mk === 'ksa') {
    params.push(mk)
    where = 'WHERE marketplace_key = $1'
  }
  const r = await query(`SELECT MAX(comparison_generated_at) AS t FROM amazon_zoho_stock_comparison ${where}`, params)
  return r.rows[0]?.t || null
}

async function getWarningMessages(filters = {}) {
  const marketplace = String(filters.marketplace || 'all').trim().toLowerCase()
  const params = []
  let where = `WHERE jsonb_array_length(warnings) > 0`
  if (marketplace === 'uae' || marketplace === 'ksa') {
    params.push(marketplace)
    where += ` AND marketplace_key = $1`
  }
  const r = await query(
    `SELECT DISTINCT warning_value #>> '{}' AS warning
     FROM amazon_zoho_stock_comparison, jsonb_array_elements(warnings) AS warning_value
     ${where}
     ORDER BY warning ASC
     LIMIT 20`,
    params
  )
  return r.rows.map((row) => String(row.warning || '').trim()).filter(Boolean)
}

module.exports = {
  ensureAmazonZohoStockComparisonTables,
  replaceMarketplaceRows,
  selectComparisonRows,
  selectAllComparisonRows,
  selectMarketplaceRowsUnscoped,
  updateMarketplaceNoonRows,
  getComparisonSummary,
  getLatestComparisonGeneratedAt,
  getWarningMessages,
  _internals: {
    buildWhere,
    appendListingStatusScope,
    mapDbRow,
  },
}
