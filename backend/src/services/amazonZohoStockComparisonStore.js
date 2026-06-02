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
          difference, is_mismatch, recommended_action,
          amazon_last_fetched_at, zoho_last_fetched_at, comparison_generated_at,
          warnings, raw_safe_json, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::jsonb,$36::jsonb,NOW(),NOW()
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
      inboundQty: r.amazon_inbound_qty == null ? null : Number(r.amazon_inbound_qty),
      reservedQty: r.amazon_reserved_qty == null ? null : Number(r.amazon_reserved_qty),
      unfulfillableQty: r.amazon_unfulfillable_qty == null ? null : Number(r.amazon_unfulfillable_qty),
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
      actualQty: r.zoho_actual_qty == null ? null : Number(r.zoho_actual_qty),
      committedQty: r.zoho_committed_qty == null ? null : Number(r.zoho_committed_qty),
      stockStatus: r.zoho_stock_status || 'Unknown',
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
  const stockFilter = String(filters.stockFilter || 'all').trim()
  appendListingStatusScope(clauses, stockFilter)
  const search = String(filters.search || '').trim()
  if (search) {
    values.push(`%${search.toLowerCase()}%`)
    clauses.push(`(
      LOWER(seller_sku) LIKE $${values.length}
      OR LOWER(normalized_sku) LIKE $${values.length}
      OR LOWER(COALESCE(asin, '')) LIKE $${values.length}
      OR LOWER(COALESCE(title, '')) LIKE $${values.length}
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
      COUNT(*) FILTER (WHERE COALESCE(zoho_available_qty, 0) = 0 AND zoho_stock_status <> 'Not Found')::int AS zoho_out_of_stock,
      COUNT(*) FILTER (WHERE is_mismatch = true)::int AS mismatches,
      COUNT(*) FILTER (WHERE zoho_stock_status = 'Not Found')::int AS zoho_not_found,
      COUNT(*) FILTER (
        WHERE GREATEST(COALESCE(amazon_total_qty, 0), COALESCE(amazon_available_qty, 0)) = 0
          AND COALESCE(zoho_available_qty, 0) = 0
      )::int AS both_out_of_stock,
      COUNT(*) FILTER (WHERE recommended_action = 'Low Zoho stock warning')::int AS low_zoho_stock,
      MAX(amazon_last_fetched_at) AS amazon_last_fetched_at,
      MAX(zoho_last_fetched_at) AS zoho_last_fetched_at,
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
    },
    timestamps: {
      amazonLastFetchedAt: row.amazon_last_fetched_at ? new Date(row.amazon_last_fetched_at).toISOString() : null,
      zohoLastFetchedAt: row.zoho_last_fetched_at ? new Date(row.zoho_last_fetched_at).toISOString() : null,
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
  getComparisonSummary,
  getLatestComparisonGeneratedAt,
  getWarningMessages,
}
