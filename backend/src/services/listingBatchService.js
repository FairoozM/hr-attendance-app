const path = require('path')
const { query, pool } = require('../db')
const { parseAmazonFlatFile, MAX_SKUS_PER_BATCH } = require('./amazonFlatFileParserService')
const { applyRulesToValues, getDefaultProfile } = require('./listingDefaultsService')
const { validateRow, nextStatusFromValidation } = require('./listingValidationService')

function userId(reqUser) {
  const n = Number(reqUser?.userId)
  return Number.isFinite(n) && n > 0 ? n : null
}

function rowToClient(row) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    row_index: row.row_index,
    sheet_row_number: row.sheet_row_number,
    sku: row.sku,
    item_name: row.item_name,
    marketplace: row.marketplace,
    status: row.status,
    current_values: row.current_values || {},
    raw_values: row.raw_values || {},
    generated_values: row.generated_values || {},
    source_map: row.source_map || {},
    validation: row.validation || { errors: [], warnings: [] },
    quality: row.quality || {},
    retry_count: row.retry_count,
    last_error: row.last_error,
    ai_model: row.ai_model,
    estimated_cost_usd: Number(row.estimated_cost_usd || 0),
    generated_at: row.generated_at,
    approved_at: row.approved_at,
    exported_at: row.exported_at,
    updated_at: row.updated_at,
  }
}

async function refreshBatchSummary(batchId) {
  const r = await query(
    `SELECT status, COUNT(*)::int AS count FROM listing_batch_rows WHERE batch_id = $1 GROUP BY status`,
    [batchId]
  )
  const counts = {}
  for (const row of r.rows) counts[row.status] = row.count
  await query(`UPDATE listing_batches SET summary_counts = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
    batchId,
    JSON.stringify(counts),
  ])
  return counts
}

async function createBatchFromUpload({ file, reqUser, batchName }) {
  if (!file?.buffer) {
    const err = new Error('Upload a flat file')
    err.code = 'FILE_REQUIRED'
    throw err
  }
  const parsed = await parseAmazonFlatFile({ buffer: file.buffer, filename: file.originalname })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ext = path.extname(file.originalname || '').toLowerCase()
    const batch = await client.query(
      `INSERT INTO listing_batches (
        batch_name, uploaded_by, original_filename, original_mime_type, original_file_ext,
        workbook_data, template_sheet_name, header_row_number, sku_count, imported_count,
        overflow_count, detected_columns, active_columns, valid_values, summary_counts
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb
      ) RETURNING id`,
      [
        String(batchName || file.originalname || 'Amazon flat file batch').trim(),
        userId(reqUser),
        file.originalname || 'amazon-flat-file.xlsx',
        file.mimetype || '',
        ext,
        file.buffer,
        parsed.sheetName,
        parsed.headerRowNumber,
        parsed.totalSkuCount,
        parsed.rows.length,
        parsed.overflowCount,
        JSON.stringify(parsed.columns),
        JSON.stringify(parsed.activeColumns),
        JSON.stringify(parsed.validValues || {}),
        JSON.stringify({ Imported: parsed.rows.length }),
      ]
    )
    const batchId = batch.rows[0].id
    for (const row of parsed.rows) {
      await client.query(
        `INSERT INTO listing_batch_rows (
          batch_id, row_index, sheet_row_number, sku, item_name, marketplace, raw_values, current_values, source_map
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [
          batchId,
          row.rowIndex,
          row.sheetRowNumber,
          row.sku,
          row.itemName,
          row.values.marketplace || row.values.fulfillment_channel_code_ae || '',
          JSON.stringify(row.values),
          JSON.stringify(row.values),
          JSON.stringify(row.sourceMap),
        ]
      )
    }
    await client.query(
      `INSERT INTO listing_batch_events (batch_id, event_type, actor_user_id, details)
       VALUES ($1, 'upload', $2, $3::jsonb)`,
      [batchId, userId(reqUser), JSON.stringify({ filename: file.originalname, warning: parsed.warning })]
    )
    await client.query('COMMIT')
    return { ...(await getBatch(batchId, { includeRows: true })), warning: parsed.warning, maxSkus: MAX_SKUS_PER_BATCH }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listBatches({ limit = 50 } = {}) {
  const n = Math.max(1, Math.min(100, Number(limit) || 50))
  const r = await query(
    `SELECT id, batch_name, original_filename, template_sheet_name, sku_count, imported_count, overflow_count,
            status, summary_counts, created_at, updated_at, exported_at
     FROM listing_batches
     ORDER BY updated_at DESC
     LIMIT $1`,
    [n]
  )
  return r.rows
}

async function getBatch(batchId, { includeRows = false, limit = 50, offset = 0, search = '', status = '' } = {}) {
  const b = await query(
    `SELECT id, batch_name, original_filename, original_file_ext, template_sheet_name, header_row_number,
            sku_count, imported_count, overflow_count, detected_columns, active_columns, valid_values,
            status, summary_counts, created_at, updated_at, exported_at
     FROM listing_batches WHERE id = $1`,
    [batchId]
  )
  if (!b.rows[0]) return null
  const batch = b.rows[0]
  if (!includeRows) return batch

  const clauses = ['batch_id = $1']
  const params = [batchId]
  if (status) {
    params.push(status)
    clauses.push(`status = $${params.length}`)
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`)
    clauses.push(`(LOWER(sku) LIKE $${params.length} OR LOWER(item_name) LIKE $${params.length})`)
  }
  const l = Math.max(1, Math.min(200, Number(limit) || 50))
  const o = Math.max(0, Number(offset) || 0)
  const rows = await query(
    `SELECT * FROM listing_batch_rows
     WHERE ${clauses.join(' AND ')}
     ORDER BY row_index ASC
     LIMIT ${l} OFFSET ${o}`,
    params
  )
  const count = await query(`SELECT COUNT(*)::int AS count FROM listing_batch_rows WHERE ${clauses.join(' AND ')}`, params)
  return { ...batch, rows: rows.rows.map(rowToClient), total_rows: count.rows[0]?.count || 0 }
}

async function getBatchColumns(batchId) {
  const r = await query(`SELECT detected_columns FROM listing_batches WHERE id = $1`, [batchId])
  return r.rows[0]?.detected_columns || []
}

function duplicateSkuSet(rows) {
  const counts = new Map()
  for (const row of rows) {
    const sku = String(row.sku || '').trim()
    if (!sku) continue
    counts.set(sku, (counts.get(sku) || 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([sku]) => sku))
}

async function validateBatch(batchId) {
  const columns = await getBatchColumns(batchId)
  const rows = await query(`SELECT * FROM listing_batch_rows WHERE batch_id = $1 ORDER BY row_index ASC`, [batchId])
  const dupes = duplicateSkuSet(rows.rows)
  for (const row of rows.rows) {
    const validation = validateRow(row, columns, dupes)
    const status = nextStatusFromValidation(row.status, validation)
    await query(
      `UPDATE listing_batch_rows
       SET validation = $3::jsonb, status = $4, updated_at = NOW()
       WHERE id = $1 AND batch_id = $2`,
      [row.id, batchId, JSON.stringify(validation), status]
    )
  }
  const summary = await refreshBatchSummary(batchId)
  return { summary, rowsValidated: rows.rows.length }
}

async function applyDefaultsToBatch(batchId, { profileId, rules, confirmOverwrite = false, preview = false, reqUser } = {}) {
  let effectiveRules = rules
  if ((!effectiveRules || effectiveRules.length === 0) && profileId) {
    const profile = await getDefaultProfile(profileId)
    effectiveRules = profile?.fields || []
  }
  if (!Array.isArray(effectiveRules)) effectiveRules = []
  const rows = await query(`SELECT * FROM listing_batch_rows WHERE batch_id = $1 ORDER BY row_index ASC`, [batchId])
  const effects = []
  for (const row of rows.rows) {
    const result = applyRulesToValues(row.current_values || {}, row.source_map || {}, effectiveRules, { confirmOverwrite })
    if (result.applied.length > 0) {
      effects.push({ rowId: row.id, sku: row.sku, applied: result.applied, skipped: result.skipped })
      if (!preview) {
        await query(
          `UPDATE listing_batch_rows
           SET current_values = $3::jsonb, source_map = $4::jsonb, status = CASE WHEN status = 'Imported' THEN 'Ready' ELSE status END, updated_at = NOW()
           WHERE id = $1 AND batch_id = $2`,
          [row.id, batchId, JSON.stringify(result.values), JSON.stringify(result.sourceMap)]
        )
      }
    }
  }
  if (!preview) {
    await query(
      `INSERT INTO listing_batch_events (batch_id, event_type, actor_user_id, details)
       VALUES ($1, 'apply_defaults', $2, $3::jsonb)`,
      [batchId, userId(reqUser), JSON.stringify({ profileId, affectedRows: effects.length })]
    )
    await refreshBatchSummary(batchId)
  }
  return { preview, affectedRows: effects.length, effects }
}

async function updateRow(batchId, rowId, { values = {}, status, reqUser } = {}) {
  const row = await query(`SELECT * FROM listing_batch_rows WHERE id = $1 AND batch_id = $2`, [rowId, batchId])
  if (!row.rows[0]) return null
  const current = { ...(row.rows[0].current_values || {}) }
  const source = { ...(row.rows[0].source_map || {}) }
  for (const [key, value] of Object.entries(values || {})) {
    current[key] = value == null ? '' : String(value)
    source[key] = 'Manual Edit'
  }
  const itemName = current.item_name || row.rows[0].item_name || ''
  const nextStatus = status || row.rows[0].status
  const r = await query(
    `UPDATE listing_batch_rows
     SET current_values = $4::jsonb, source_map = $5::jsonb, item_name = $6, status = $7, updated_at = NOW(),
         approved_at = CASE WHEN $7 = 'Approved' THEN COALESCE(approved_at, NOW()) ELSE approved_at END
     WHERE id = $1 AND batch_id = $2
     RETURNING *`,
    [rowId, batchId, userId(reqUser), JSON.stringify(current), JSON.stringify(source), itemName, nextStatus]
  )
  await query(
    `INSERT INTO listing_batch_events (batch_id, row_id, event_type, actor_user_id, details)
     VALUES ($1, $2, 'manual_edit', $3, $4::jsonb)`,
    [batchId, rowId, userId(reqUser), JSON.stringify({ fields: Object.keys(values || {}), status })]
  )
  await refreshBatchSummary(batchId)
  return rowToClient(r.rows[0])
}

async function bulkAction(batchId, { action, rowIds = [] } = {}) {
  const ids = Array.isArray(rowIds) ? rowIds.map(Number).filter(Boolean) : []
  const params = [batchId]
  let where = 'batch_id = $1'
  if (ids.length > 0) {
    params.push(ids)
    where += ` AND id = ANY($2::int[])`
  }
  if (action === 'approve_selected' || action === 'approve') {
    await query(`UPDATE listing_batch_rows SET status = 'Approved', approved_at = NOW(), updated_at = NOW() WHERE ${where}`, params)
  } else if (action === 'approve_high_score') {
    await query(
      `UPDATE listing_batch_rows SET status = 'Approved', approved_at = NOW(), updated_at = NOW()
       WHERE ${where} AND COALESCE((quality->>'score')::int, 0) >= 85`,
      params
    )
  } else if (action === 'mark_needs_review') {
    await query(`UPDATE listing_batch_rows SET status = 'Needs Review', updated_at = NOW() WHERE ${where}`, params)
  } else if (action === 'retry_failed') {
    await query(`UPDATE listing_batch_rows SET status = 'Ready', last_error = NULL, updated_at = NOW() WHERE ${where} AND status = 'Failed'`, params)
  } else if (action === 'delete_selected' || action === 'delete') {
    await query(`DELETE FROM listing_batch_rows WHERE ${where}`, params)
  } else if (action === 'save_selected' || action === 'save') {
    await query(`UPDATE listing_batch_rows SET status = 'Saved', updated_at = NOW() WHERE ${where}`, params)
  } else {
    const err = new Error('Unsupported bulk action')
    err.code = 'UNSUPPORTED_BULK_ACTION'
    throw err
  }
  const summary = await refreshBatchSummary(batchId)
  return { summary }
}

module.exports = {
  createBatchFromUpload,
  listBatches,
  getBatch,
  validateBatch,
  applyDefaultsToBatch,
  updateRow,
  bulkAction,
  getBatchColumns,
  refreshBatchSummary,
  rowToClient,
}
