const { query } = require('../db')

async function ensureZohoBulkInvoiceTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS zoho_item_cache (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(160) UNIQUE NOT NULL,
      item_id VARCHAR(160) NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      rate NUMERIC(14,4) NOT NULL DEFAULT 0,
      tax_id VARCHAR(160),
      unit VARCHAR(80),
      status VARCHAR(80),
      last_synced_at TIMESTAMPTZ,
      raw_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_zoho_item_cache_sku_lower ON zoho_item_cache (LOWER(sku))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_zoho_item_cache_name_lower ON zoho_item_cache (LOWER(name))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_zoho_item_cache_item_id ON zoho_item_cache (item_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS zoho_invoice_logs (
      id SERIAL PRIMARY KEY,
      reference_number VARCHAR(200),
      invoice_number VARCHAR(200),
      zoho_invoice_id VARCHAR(200),
      customer_id VARCHAR(200) NOT NULL,
      status VARCHAR(80),
      total NUMERIC(14,4),
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      request_json JSONB NOT NULL DEFAULT '{}',
      response_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_zoho_invoice_logs_reference
      ON zoho_invoice_logs (LOWER(reference_number))
      WHERE reference_number IS NOT NULL AND reference_number <> ''
  `)
}

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function itemToCacheRow(item) {
  const raw = item && typeof item === 'object' ? item : {}
  const sku = cleanSku(raw.sku || raw.item_code || raw.code)
  const itemId = cleanSku(raw.item_id || raw.id)
  const name = cleanSku(raw.name || raw.item_name || raw.description)
  const rate = toNumber(raw.rate ?? raw.sales_rate ?? raw.price ?? raw.purchase_rate, 0)
  const taxId = cleanSku(raw.tax_id || raw.sales_tax_id || raw.output_tax_id)
  const unit = cleanSku(raw.unit || raw.unit_name)
  const status = cleanSku(raw.status || raw.item_status)
  return {
    sku,
    item_id: itemId,
    name,
    rate,
    tax_id: taxId || null,
    unit: unit || null,
    status: status || null,
    raw_json: raw,
  }
}

async function upsertItems(rawItems) {
  const rows = Array.isArray(rawItems) ? rawItems.map(itemToCacheRow).filter((r) => r.sku && r.item_id) : []
  let count = 0
  for (const row of rows) {
    const result = await query(
      `
      INSERT INTO zoho_item_cache
        (sku, item_id, name, rate, tax_id, unit, status, last_synced_at, raw_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8::jsonb)
      ON CONFLICT (sku) DO UPDATE SET
        item_id = EXCLUDED.item_id,
        name = EXCLUDED.name,
        rate = EXCLUDED.rate,
        tax_id = EXCLUDED.tax_id,
        unit = EXCLUDED.unit,
        status = EXCLUDED.status,
        last_synced_at = NOW(),
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
      `,
      [
        row.sku,
        row.item_id,
        row.name,
        row.rate,
        row.tax_id,
        row.unit,
        row.status,
        JSON.stringify(row.raw_json || {}),
      ]
    )
    count += result.rowCount > 0 ? 1 : 0
  }
  return count
}

async function findItemsBySkus(skus) {
  const clean = Array.from(new Set((Array.isArray(skus) ? skus : []).map(cleanSku).filter(Boolean)))
  if (!clean.length) return []
  const { rows } = await query(
    `
    SELECT sku, item_id, name, rate::float AS rate, tax_id, unit, status, last_synced_at
    FROM zoho_item_cache
    WHERE LOWER(sku) = ANY($1::text[])
    `,
    [clean.map((s) => s.toLowerCase())]
  )
  return rows
}

async function findItemsByNames(names) {
  const clean = Array.from(new Set((Array.isArray(names) ? names : []).map(cleanSku).filter(Boolean)))
  if (!clean.length) return []
  const { rows } = await query(
    `
    SELECT sku, item_id, name, rate::float AS rate, tax_id, unit, status, last_synced_at
    FROM zoho_item_cache
    WHERE LOWER(name) = ANY($1::text[])
    ORDER BY name ASC, sku ASC
    `,
    [clean.map((name) => name.toLowerCase())]
  )
  return rows
}

async function findInvoiceByReference(referenceNumber) {
  const ref = cleanSku(referenceNumber)
  if (!ref) return null
  const { rows } = await query(
    `
    SELECT *
    FROM zoho_invoice_logs
    WHERE LOWER(reference_number) = LOWER($1)
      AND zoho_invoice_id IS NOT NULL
      AND zoho_invoice_id <> ''
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [ref]
  )
  return rows[0] || null
}

async function insertInvoiceLog(row) {
  const { rows } = await query(
    `
    INSERT INTO zoho_invoice_logs
      (reference_number, invoice_number, zoho_invoice_id, customer_id, status, total, api_calls_used, request_json, response_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
    RETURNING *
    `,
    [
      row.reference_number || null,
      row.invoice_number || null,
      row.zoho_invoice_id || null,
      row.customer_id,
      row.status || null,
      row.total == null ? null : Number(row.total),
      Number(row.api_calls_used) || 0,
      JSON.stringify(row.request_json || {}),
      JSON.stringify(row.response_json || {}),
    ]
  )
  return rows[0]
}

module.exports = {
  ensureZohoBulkInvoiceTables,
  upsertItems,
  findItemsBySkus,
  findItemsByNames,
  findInvoiceByReference,
  insertInvoiceLog,
}
