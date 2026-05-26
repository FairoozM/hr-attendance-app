const { query } = require('../../db')

const SNAPSHOT_FIELDS = `
  id,
  partner_sku,
  noon_sku,
  psku,
  title,
  image_url,
  barcode,
  pbarcode,
  storage_type,
  country_code,
  price,
  msrp,
  is_active,
  pricing_status_code,
  stock_quantity,
  stock_warehouse,
  raw_catalog_json,
  raw_pricing_json,
  raw_stock_json,
  stock_synced_at,
  last_synced_at,
  created_at,
  updated_at
`

function normalizeCountryCode(countryCode) {
  const normalized = String(countryCode || 'ae').trim().toLowerCase()
  return ['ae', 'sa', 'eg'].includes(normalized) ? normalized : 'ae'
}

function nullableString(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function nullableNumber(value) {
  if (value == null || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

async function ensureNoonProductSnapshotsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS noon_product_snapshots (
      id SERIAL PRIMARY KEY,
      partner_sku TEXT NOT NULL,
      noon_sku TEXT,
      psku TEXT,
      title TEXT,
      image_url TEXT,
      barcode TEXT,
      pbarcode TEXT,
      storage_type TEXT,
      country_code TEXT NOT NULL DEFAULT 'ae',
      price NUMERIC(14,2),
      msrp NUMERIC(14,2),
      is_active BOOLEAN,
      pricing_status_code TEXT,
      stock_quantity NUMERIC(14,2),
      stock_warehouse TEXT,
      raw_catalog_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_pricing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_stock_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      stock_synced_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(partner_sku, country_code)
    )
  `)
  await query(`
    ALTER TABLE noon_product_snapshots
      ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(14,2)
  `)
  await query(`
    ALTER TABLE noon_product_snapshots
      ADD COLUMN IF NOT EXISTS stock_warehouse TEXT
  `)
  await query(`
    ALTER TABLE noon_product_snapshots
      ADD COLUMN IF NOT EXISTS raw_stock_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `)
  await query(`
    ALTER TABLE noon_product_snapshots
      ADD COLUMN IF NOT EXISTS stock_synced_at TIMESTAMPTZ
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_noon_product_snapshots_country
      ON noon_product_snapshots(country_code)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_noon_product_snapshots_active
      ON noon_product_snapshots(is_active)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_noon_product_snapshots_synced
      ON noon_product_snapshots(last_synced_at DESC)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_noon_product_snapshots_search
      ON noon_product_snapshots(LOWER(partner_sku), LOWER(COALESCE(noon_sku, '')), LOWER(COALESCE(title, '')))
  `)
}

async function updateNoonProductSnapshotStock(payload) {
  const result = await query(
    `UPDATE noon_product_snapshots
     SET stock_quantity = $3,
         stock_warehouse = $4,
         raw_stock_json = $5::jsonb,
         stock_synced_at = NOW(),
         updated_at = NOW()
     WHERE partner_sku = $1
       AND country_code = $2
     RETURNING ${SNAPSHOT_FIELDS}`,
    [
      payload.partnerSku,
      normalizeCountryCode(payload.countryCode),
      nullableNumber(payload.stockQuantity),
      nullableString(payload.stockWarehouse),
      JSON.stringify(payload.rawStockJson || {}),
    ]
  )
  return result.rows[0] || null
}

async function upsertNoonProductSnapshot(payload) {
  const result = await query(
    `INSERT INTO noon_product_snapshots (
      partner_sku,
      noon_sku,
      psku,
      title,
      image_url,
      barcode,
      pbarcode,
      storage_type,
      country_code,
      price,
      msrp,
      is_active,
      pricing_status_code,
      raw_catalog_json,
      raw_pricing_json,
      last_synced_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,NOW(),NOW()
    )
    ON CONFLICT (partner_sku, country_code)
    DO UPDATE SET
      noon_sku = EXCLUDED.noon_sku,
      psku = EXCLUDED.psku,
      title = EXCLUDED.title,
      image_url = EXCLUDED.image_url,
      barcode = EXCLUDED.barcode,
      pbarcode = EXCLUDED.pbarcode,
      storage_type = EXCLUDED.storage_type,
      price = EXCLUDED.price,
      msrp = EXCLUDED.msrp,
      is_active = EXCLUDED.is_active,
      pricing_status_code = EXCLUDED.pricing_status_code,
      raw_catalog_json = EXCLUDED.raw_catalog_json,
      raw_pricing_json = EXCLUDED.raw_pricing_json,
      last_synced_at = NOW(),
      updated_at = NOW()
    RETURNING ${SNAPSHOT_FIELDS}`,
    [
      payload.partnerSku,
      nullableString(payload.noonSku),
      nullableString(payload.psku),
      nullableString(payload.title),
      nullableString(payload.imageUrl),
      nullableString(payload.barcode),
      nullableString(payload.pbarcode),
      nullableString(payload.storageType),
      normalizeCountryCode(payload.countryCode),
      nullableNumber(payload.price),
      nullableNumber(payload.msrp),
      typeof payload.isActive === 'boolean' ? payload.isActive : null,
      nullableString(payload.pricingStatusCode),
      JSON.stringify(payload.rawCatalogJson || {}),
      JSON.stringify(payload.rawPricingJson || {}),
    ]
  )
  return result.rows[0]
}

async function listNoonProductSnapshots(options = {}) {
  const countryCode = String(options.countryCode || '').trim().toLowerCase()
  const search = String(options.search || '').trim().toLowerCase()
  const isActive =
    options.isActive === true || options.isActive === false
      ? options.isActive
      : String(options.isActive || '').trim() === ''
        ? null
        : /^(1|true|yes)$/i.test(String(options.isActive).trim())
  const limit = Math.min(Math.max(Number.parseInt(String(options.limit || '50'), 10) || 50, 1), 200)
  const page = Math.max(Number.parseInt(String(options.page || '1'), 10) || 1, 1)
  const offset = (page - 1) * limit
  const where = []
  const params = []

  if (countryCode) {
    params.push(countryCode)
    where.push(`country_code = $${params.length}`)
  }
  if (isActive !== null) {
    params.push(isActive)
    where.push(`is_active = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    where.push(`(
      LOWER(partner_sku) LIKE $${params.length}
      OR LOWER(COALESCE(noon_sku, '')) LIKE $${params.length}
      OR LOWER(COALESCE(psku, '')) LIKE $${params.length}
      OR LOWER(COALESCE(title, '')) LIKE $${params.length}
      OR LOWER(COALESCE(barcode, '')) LIKE $${params.length}
      OR LOWER(COALESCE(pbarcode, '')) LIKE $${params.length}
    )`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const countResult = await query(`SELECT COUNT(*)::int AS count FROM noon_product_snapshots ${whereSql}`, params)
  const rowsResult = await query(
    `SELECT ${SNAPSHOT_FIELDS}
     FROM noon_product_snapshots
     ${whereSql}
     ORDER BY last_synced_at DESC, partner_sku ASC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )

  return {
    rows: rowsResult.rows,
    total: countResult.rows[0] ? countResult.rows[0].count : 0,
    page,
    limit,
  }
}

async function getNoonProductSnapshotsForAudit(countryCode = 'ae') {
  const result = await query(
    `SELECT ${SNAPSHOT_FIELDS}
     FROM noon_product_snapshots
     WHERE country_code = $1
     ORDER BY partner_sku ASC`,
    [normalizeCountryCode(countryCode)]
  )
  return result.rows
}

module.exports = {
  ensureNoonProductSnapshotsTable,
  getNoonProductSnapshotsForAudit,
  listNoonProductSnapshots,
  normalizeCountryCode,
  updateNoonProductSnapshotStock,
  upsertNoonProductSnapshot,
}
