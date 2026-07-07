const { query } = require('../db')

async function ensureBulkQuantityAdjustmentTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS bulk_quantity_adjustment_batches (
      id SERIAL PRIMARY KEY,
      batch_reference VARCHAR(64) NOT NULL UNIQUE,
      uploaded_file_name TEXT NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      posted_rows INTEGER NOT NULL DEFAULT 0,
      failed_rows INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      zoho_adjustment_ids JSONB NOT NULL DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS bulk_quantity_adjustment_rows (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES bulk_quantity_adjustment_batches(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      item_name TEXT DEFAULT '',
      zoho_item_id VARCHAR(160) DEFAULT '',
      warehouse_id VARCHAR(160) DEFAULT '',
      warehouse_name TEXT DEFAULT '',
      current_stock NUMERIC(14, 4),
      adjustment_qty NUMERIC(14, 4) NOT NULL DEFAULT 0,
      expected_stock_after NUMERIC(14, 4),
      reason TEXT DEFAULT '',
      description TEXT DEFAULT '',
      reference_number TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      posting_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      valuation_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
      error_message TEXT DEFAULT '',
      zoho_inventory_adjustment_id VARCHAR(160) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(batch_id, row_number)
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_bqa_batches_created
      ON bulk_quantity_adjustment_batches(created_at DESC)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_bqa_rows_batch
      ON bulk_quantity_adjustment_rows(batch_id)
  `)
}

function mapBatchRow(row) {
  if (!row) return null
  return {
    id: row.id,
    batch_reference: row.batch_reference,
    uploaded_file_name: row.uploaded_file_name || '',
    status: row.status || 'uploaded',
    total_rows: Number(row.total_rows) || 0,
    valid_rows: Number(row.valid_rows) || 0,
    error_rows: Number(row.error_rows) || 0,
    posted_rows: Number(row.posted_rows) || 0,
    failed_rows: Number(row.failed_rows) || 0,
    created_by: row.created_by,
    zoho_adjustment_ids: Array.isArray(row.zoho_adjustment_ids)
      ? row.zoho_adjustment_ids
      : (row.zoho_adjustment_ids && typeof row.zoho_adjustment_ids === 'object'
        ? row.zoho_adjustment_ids
        : []),
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapDetailRow(row) {
  if (!row) return null
  return {
    id: row.id,
    batch_id: row.batch_id,
    row_number: Number(row.row_number) || 0,
    sku: row.sku || '',
    item_name: row.item_name || '',
    zoho_item_id: row.zoho_item_id ? String(row.zoho_item_id) : '',
    warehouse_id: row.warehouse_id ? String(row.warehouse_id) : '',
    warehouse_name: row.warehouse_name || '',
    current_stock: row.current_stock == null ? null : Number(row.current_stock),
    adjustment_qty: Number(row.adjustment_qty) || 0,
    expected_stock_after: row.expected_stock_after == null ? null : Number(row.expected_stock_after),
    reason: row.reason || '',
    description: row.description || '',
    reference_number: row.reference_number || '',
    remarks: row.remarks || '',
    validation_status: row.validation_status || 'pending',
    posting_status: row.posting_status || 'pending',
    valuation_status: row.valuation_status || 'unknown',
    error_message: row.error_message || '',
    zoho_inventory_adjustment_id: row.zoho_inventory_adjustment_id
      ? String(row.zoho_inventory_adjustment_id)
      : '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function makeBatchReference() {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `BQA-${ts}-${rand}`
}

async function createBatch({ uploadedFileName, createdBy, rows }) {
  const batchReference = makeBatchReference()
  const batchResult = await query(
    `
    INSERT INTO bulk_quantity_adjustment_batches
      (batch_reference, uploaded_file_name, status, total_rows, created_by)
    VALUES ($1, $2, 'uploaded', $3, $4)
    RETURNING *
    `,
    [batchReference, uploadedFileName || '', Array.isArray(rows) ? rows.length : 0, createdBy || null],
  )
  const batch = mapBatchRow(batchResult.rows[0])
  const insertedRows = []
  for (const row of rows || []) {
    const r = await query(
      `
      INSERT INTO bulk_quantity_adjustment_rows
        (batch_id, row_number, sku, item_name, adjustment_qty, warehouse_id, warehouse_name,
         reason, description, reference_number, remarks, validation_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
      RETURNING *
      `,
      [
        batch.id,
        row.row_number,
        row.sku || '',
        row.item_name || '',
        row.adjustment_qty,
        row.warehouse_id || '',
        row.warehouse_name || '',
        row.reason || '',
        row.description || '',
        row.reference_number || '',
        row.remarks || '',
      ],
    )
    insertedRows.push(mapDetailRow(r.rows[0]))
  }
  return { batch, rows: insertedRows }
}

async function getBatchById(batchId) {
  const result = await query(
    `SELECT * FROM bulk_quantity_adjustment_batches WHERE id = $1`,
    [batchId],
  )
  return mapBatchRow(result.rows[0])
}

async function getBatchByReference(batchReference) {
  const result = await query(
    `SELECT * FROM bulk_quantity_adjustment_batches WHERE batch_reference = $1`,
    [batchReference],
  )
  return mapBatchRow(result.rows[0])
}

async function getBatchRows(batchId) {
  const result = await query(
    `
    SELECT * FROM bulk_quantity_adjustment_rows
    WHERE batch_id = $1
    ORDER BY row_number ASC
    `,
    [batchId],
  )
  return result.rows.map(mapDetailRow)
}

async function updateBatchCounts(batchId, patch) {
  const fields = []
  const values = []
  let idx = 1
  for (const [key, value] of Object.entries(patch || {})) {
    if (!['status', 'total_rows', 'valid_rows', 'error_rows', 'posted_rows', 'failed_rows', 'notes', 'zoho_adjustment_ids'].includes(key)) {
      continue
    }
    fields.push(`${key} = $${idx}`)
    values.push(key === 'zoho_adjustment_ids' ? JSON.stringify(value) : value)
    idx += 1
  }
  if (!fields.length) return getBatchById(batchId)
  fields.push('updated_at = NOW()')
  values.push(batchId)
  const result = await query(
    `
    UPDATE bulk_quantity_adjustment_batches
    SET ${fields.join(', ')}
    WHERE id = $${idx}
    RETURNING *
    `,
    values,
  )
  return mapBatchRow(result.rows[0])
}

async function updateRow(batchId, rowId, patch) {
  const allowed = [
    'sku', 'item_name', 'zoho_item_id', 'warehouse_id', 'warehouse_name',
    'current_stock', 'adjustment_qty', 'expected_stock_after',
    'reason', 'description', 'reference_number', 'remarks',
    'validation_status', 'posting_status', 'valuation_status',
    'error_message', 'zoho_inventory_adjustment_id',
  ]
  const fields = []
  const values = []
  let idx = 1
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.includes(key)) continue
    fields.push(`${key} = $${idx}`)
    values.push(value)
    idx += 1
  }
  if (!fields.length) return null
  fields.push('updated_at = NOW()')
  values.push(rowId, batchId)
  const result = await query(
    `
    UPDATE bulk_quantity_adjustment_rows
    SET ${fields.join(', ')}
    WHERE id = $${idx} AND batch_id = $${idx + 1}
    RETURNING *
    `,
    values,
  )
  return mapDetailRow(result.rows[0])
}

async function updateRowsBulk(batchId, rowPatches) {
  const updated = []
  for (const { id, patch } of rowPatches || []) {
    const row = await updateRow(batchId, id, patch)
    if (row) updated.push(row)
  }
  return updated
}

module.exports = {
  ensureBulkQuantityAdjustmentTables,
  createBatch,
  getBatchById,
  getBatchByReference,
  getBatchRows,
  updateBatchCounts,
  updateRow,
  updateRowsBulk,
  mapBatchRow,
  mapDetailRow,
}
