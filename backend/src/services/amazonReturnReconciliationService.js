const crypto = require('crypto')
const path = require('path')
const xlsx = require('xlsx')
const ExcelJS = require('exceljs')
const { query, pool } = require('../db')
const { parseCsv } = require('../utils/csv')
const s3Service = require('./s3Service')

const SECTION = {
  RETURN_RECEIVED: 'RETURN_RECEIVED',
  OLD_STOCK: 'OLD_STOCK',
  IGNORED: 'IGNORED',
}

const LABEL_STATUS = {
  NOT_UPLOADED: 'Not Uploaded',
  UPLOADED: 'Uploaded',
  REPLACED: 'Replaced',
}

const HEADER_ALIASES = {
  sku: ['sku', 'seller sku', 'msku'],
  alternativeSku: ['alternative sku', 'alternate sku', 'alt sku', 'alternative'],
  qtyPerCtn: ['qty/ctn', 'qty per ctn', 'qty per carton', 'quantity per carton', 'qty ctn'],
  shippingTo: ['shipping to', 'ship to', 'destination'],
  disposition: ['disposition'],
  status: ['status'],
  removalOrderId: ['removal order id', 'removal order', 'removal id', 'order id'],
  awbNo: ['awb no.', 'awb no', 'awb', 'awb number'],
  ctnsReceived: ['ctns received', 'cartons received', 'ctn received', 'ctns', 'cartons'],
  qtyReceived: ['qty received', 'quantity received', 'received qty', 'received quantity', 'qty', 'quantity'],
  receivingDate: ['date of receiving', 'receiving date', 'received date', 'date received'],
}

const BATCH_RETURNING_COLUMNS = `
  id, title, marketplace, agent_name, shipping_to, public_token,
  source_file_name, status, total_skus, total_qty_received,
  total_cartons_received, issue_count, old_stock_quantity,
  created_by, created_at, updated_at
`

const RETURN_COLUMNS = `
  b.id, b.title, b.marketplace, b.agent_name, b.shipping_to, b.public_token,
  b.source_file_name, b.status, b.total_skus, b.total_qty_received,
  b.total_cartons_received, b.issue_count, b.old_stock_quantity,
  b.created_by, b.created_at, b.updated_at
`

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ')
}

function normalizeSku(value) {
  return clean(value).toUpperCase()
}

function resolveWorkingSku(alternativeSku, sku) {
  return clean(alternativeSku) || clean(sku)
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const raw = clean(value).replace(/,/g, '')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function dateOrNull(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function normalizeMarketplace(value) {
  const v = clean(value).toUpperCase()
  return v === 'UAE' ? 'UAE' : 'KSA'
}

function createPublicToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function sanitizeName(name) {
  return clean(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function createAmazonReturnLabelKey(batchId, combinedSkuId, fileName) {
  return `amazon-return-labels/${batchId}/combined/${combinedSkuId}/${crypto.randomUUID()}-${sanitizeName(fileName)}`
}

function isAllowedLabelMime(mimeType, fileName = '') {
  const mime = clean(mimeType).toLowerCase()
  const ext = path.extname(fileName).toLowerCase()
  return (
    ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(mime) ||
    ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)
  )
}

function isSpreadsheetFile(fileName = '') {
  const ext = path.extname(fileName).toLowerCase()
  return ext === '.xlsx' || ext === '.xls'
}

function getHeaderValue(row, field) {
  for (const alias of HEADER_ALIASES[field] || []) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias]
  }
  return ''
}

function rowObjectFromHeaders(headers, row) {
  const out = {}
  headers.forEach((h, idx) => {
    out[normalizeHeader(h)] = row[idx]
  })
  return out
}

function parseCsvRows(buffer) {
  const parsed = parseCsv(buffer.toString('utf8'))
  return parsed.rows.map((row) => rowObjectFromHeaders(parsed.headers, row))
}

function parseWorkbookRows(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true })
  const rows = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    let headers = null
    for (const line of matrix) {
      const cells = Array.isArray(line) ? line.map(clean) : []
      if (cells.every((cell) => !cell)) continue
      if (!headers) {
        headers = cells
        continue
      }
      rows.push(rowObjectFromHeaders(headers, cells))
    }
  }
  return rows
}

function rowLooksOldStockMarker(row) {
  const values = Object.values(row).map((v) => normalizeHeader(v))
  return values.some((v) => v.includes('old stock with us') || v.includes('old stock with agent'))
}

function rowHasHeaderShape(row) {
  const values = Object.values(row).map(normalizeHeader)
  return values.includes('sku') && values.some((v) => HEADER_ALIASES.qtyReceived.includes(v))
}

function parseSourceFile(buffer, fileName) {
  const rawRows = isSpreadsheetFile(fileName) ? parseWorkbookRows(buffer) : parseCsvRows(buffer)
  const returnedStock = []
  const oldStock = []
  const ignoredRows = []
  let oldStockMode = false

  for (const row of rawRows) {
    if (rowLooksOldStockMarker(row)) {
      oldStockMode = true
      continue
    }
    if (oldStockMode && rowHasHeaderShape(row)) continue

    const originalSku = clean(getHeaderValue(row, 'sku'))
    const alternativeSku = clean(getHeaderValue(row, 'alternativeSku'))
    const qtyReceived = numberOrNull(getHeaderValue(row, 'qtyReceived'))
    const workingSku = resolveWorkingSku(alternativeSku, originalSku)

    if (oldStockMode) {
      if (!workingSku || qtyReceived == null) continue
      oldStock.push({
        workingSku,
        originalSku: originalSku || workingSku,
        alternativeSku,
        qtyReceived,
        adminNotes: '',
        sectionType: SECTION.OLD_STOCK,
      })
      continue
    }

    if (!originalSku && !alternativeSku) continue

    if (qtyReceived == null) {
      ignoredRows.push({
        originalSku,
        alternativeSku,
        workingSku: workingSku || originalSku || alternativeSku,
        removalOrderId: clean(getHeaderValue(row, 'removalOrderId')),
        sectionType: SECTION.IGNORED,
      })
      continue
    }

    returnedStock.push({
      workingSku,
      originalSku: originalSku || workingSku,
      alternativeSku,
      removalOrderId: clean(getHeaderValue(row, 'removalOrderId')),
      qtyReceived,
      receivingDate: dateOrNull(getHeaderValue(row, 'receivingDate')),
      sectionType: SECTION.RETURN_RECEIVED,
    })
  }

  return { returnedStock, oldStock, ignoredRows }
}

function combineAvailableStock(returnedStock, oldStock) {
  const map = new Map()

  for (const row of returnedStock) {
    const key = normalizeSku(row.workingSku)
    if (!key) continue
    const entry = map.get(key) || {
      workingSku: row.workingSku,
      returnedQty: 0,
      oldStockQty: 0,
      sourceBreakdown: { returned: [], oldStock: [] },
    }
    entry.returnedQty += Number(row.qtyReceived || 0)
    entry.sourceBreakdown.returned.push(row)
    map.set(key, entry)
  }

  for (const row of oldStock) {
    const key = normalizeSku(row.workingSku)
    if (!key) continue
    const entry = map.get(key) || {
      workingSku: row.workingSku,
      returnedQty: 0,
      oldStockQty: 0,
      sourceBreakdown: { returned: [], oldStock: [] },
    }
    entry.oldStockQty += Number(row.qtyReceived || 0)
    entry.sourceBreakdown.oldStock.push(row)
    map.set(key, entry)
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      totalAvailableQty: entry.returnedQty + entry.oldStockQty,
    }))
    .sort((a, b) => a.workingSku.localeCompare(b.workingSku))
}

function computeSummary({ returnedStock, oldStock, ignoredRows, combinedStock }) {
  const returnedSkuSet = new Set(returnedStock.map((r) => normalizeSku(r.workingSku)).filter(Boolean))
  const totalReturnedQty = returnedStock.reduce((sum, row) => sum + Number(row.qtyReceived || 0), 0)
  const totalOldStockQty = oldStock.reduce((sum, row) => sum + Number(row.qtyReceived || 0), 0)
  const totalAvailableQty = combinedStock.reduce((sum, row) => sum + Number(row.totalAvailableQty || 0), 0)

  return {
    totalReturnedSkus: returnedSkuSet.size,
    totalReturnedQty,
    totalOldStockSkus: oldStock.length,
    totalOldStockQty,
    totalAvailableSkus: combinedStock.length,
    totalAvailableQty,
    ignoredRowCount: ignoredRows.length,
    // Legacy fields kept for list cards
    totalSkus: combinedStock.length,
    totalQtyReceived: totalReturnedQty,
    totalCartonsReceived: 0,
    issueCount: 0,
    oldStockQuantity: totalOldStockQty,
    availableStockTotal: totalAvailableQty,
  }
}

function mapBatch(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    marketplace: row.marketplace,
    agentName: row.agent_name,
    shippingTo: row.shipping_to,
    publicToken: row.public_token,
    sourceFileName: row.source_file_name,
    status: row.status,
    totalSkus: Number(row.total_skus || 0),
    totalQtyReceived: Number(row.total_qty_received || 0),
    totalCartonsReceived: Number(row.total_cartons_received || 0),
    issueCount: Number(row.issue_count || 0),
    oldStockQuantity: Number(row.old_stock_quantity || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapItem(row) {
  if (!row) return null
  return {
    id: row.id,
    batchId: row.batch_id,
    workingSku: row.working_sku,
    sku: row.sku,
    originalSku: row.original_sku || row.sku,
    alternativeSku: row.alternative_sku,
    removalOrderId: row.removal_order_id,
    qtyReceived: row.qty_received == null ? null : Number(row.qty_received),
    receivingDate: row.receiving_date,
    sectionType: row.section_type,
    adminNotes: row.admin_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCombinedSku(row) {
  if (!row) return null
  const labelId = row.label_id || null
  const labelStatus = labelId
    ? row.label_replaced_at
      ? LABEL_STATUS.REPLACED
      : LABEL_STATUS.UPLOADED
    : LABEL_STATUS.NOT_UPLOADED
  return {
    id: row.id,
    batchId: row.batch_id,
    workingSku: row.working_sku,
    returnedQty: Number(row.returned_qty || 0),
    oldStockQty: Number(row.old_stock_qty || 0),
    totalAvailableQty: Number(row.total_available_qty || 0),
    labelDownloaded: Boolean(row.label_downloaded),
    labelPrinted: Boolean(row.label_printed),
    relabeled: Boolean(row.relabeled),
    packed: Boolean(row.packed),
    readyForShipment: Boolean(row.ready_for_shipment),
    notes: row.notes || '',
    agentNotes: row.agent_notes || '',
    label: labelId
      ? {
          id: labelId,
          fileName: row.label_file_name,
          fileMimeType: row.label_file_mime_type,
          uploadedAt: row.label_uploaded_at,
          replacedAt: row.label_replaced_at,
          status: labelStatus,
        }
      : null,
    labelStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapLabel(row) {
  if (!row) return null
  return {
    id: row.id,
    batchId: row.batch_id,
    combinedSkuId: row.combined_sku_id,
    sku: row.sku,
    fileName: row.file_name,
    storagePath: row.storage_path,
    fileMimeType: row.file_mime_type,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    replacedAt: row.replaced_at,
  }
}

function mapAgentCombinedSku(row) {
  const mapped = mapCombinedSku(row)
  if (!mapped) return null
  return {
    id: mapped.id,
    workingSku: mapped.workingSku,
    totalAvailableQty: mapped.totalAvailableQty,
    labelDownloaded: mapped.labelDownloaded,
    labelPrinted: mapped.labelPrinted,
    relabeled: mapped.relabeled,
    packed: mapped.packed,
    readyForShipment: mapped.readyForShipment,
    agentNotes: mapped.agentNotes,
    label: mapped.label
      ? {
          id: mapped.label.id,
          fileName: mapped.label.fileName,
          status: mapped.label.status,
        }
      : null,
    labelStatus: mapped.labelStatus,
  }
}

async function ensureAmazonReturnReconciliationTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_return_batches (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      marketplace VARCHAR(10) NOT NULL DEFAULT 'KSA' CHECK (marketplace IN ('KSA', 'UAE')),
      agent_name TEXT DEFAULT '',
      shipping_to TEXT DEFAULT '',
      public_token TEXT UNIQUE NOT NULL,
      source_file_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Open',
      total_skus INTEGER NOT NULL DEFAULT 0,
      total_qty_received NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_cartons_received NUMERIC(14,2) NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      old_stock_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_batches_created_at ON amazon_return_batches(created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_batches_public_token ON amazon_return_batches(public_token)`)

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_return_items (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES amazon_return_batches(id) ON DELETE CASCADE,
      working_sku TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      original_sku TEXT DEFAULT '',
      alternative_sku TEXT DEFAULT '',
      removal_order_id TEXT DEFAULT '',
      qty_received NUMERIC(14,2),
      receiving_date DATE,
      section_type TEXT NOT NULL DEFAULT 'RETURN_RECEIVED'
        CHECK (section_type IN ('RETURN_RECEIVED', 'OLD_STOCK', 'IGNORED')),
      admin_notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_return_items ADD COLUMN IF NOT EXISTS working_sku TEXT NOT NULL DEFAULT ''`)
  await query(`ALTER TABLE amazon_return_items ADD COLUMN IF NOT EXISTS original_sku TEXT DEFAULT ''`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_items_batch_id ON amazon_return_items(batch_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_items_working_sku ON amazon_return_items(LOWER(working_sku))`)
  try {
    await query(`ALTER TABLE amazon_return_items DROP CONSTRAINT IF EXISTS amazon_return_items_section_type_check`)
    await query(`
      ALTER TABLE amazon_return_items
      ADD CONSTRAINT amazon_return_items_section_type_check
      CHECK (section_type IN ('RETURN_RECEIVED', 'OLD_STOCK', 'IGNORED'))
    `)
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) {
      console.warn('[db] amazon_return_items section_type constraint migration skipped:', e.message || e)
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_return_combined_skus (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES amazon_return_batches(id) ON DELETE CASCADE,
      working_sku TEXT NOT NULL,
      returned_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
      old_stock_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_available_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
      label_downloaded BOOLEAN NOT NULL DEFAULT false,
      label_printed BOOLEAN NOT NULL DEFAULT false,
      relabeled BOOLEAN NOT NULL DEFAULT false,
      packed BOOLEAN NOT NULL DEFAULT false,
      ready_for_shipment BOOLEAN NOT NULL DEFAULT false,
      notes TEXT DEFAULT '',
      agent_notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(batch_id, working_sku)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_combined_skus_batch_id ON amazon_return_combined_skus(batch_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_return_labels (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES amazon_return_batches(id) ON DELETE CASCADE,
      combined_sku_id INTEGER NOT NULL REFERENCES amazon_return_combined_skus(id) ON DELETE CASCADE,
      sku TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_mime_type TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      replaced_at TIMESTAMPTZ,
      UNIQUE(combined_sku_id)
    )
  `)
  await query(`ALTER TABLE amazon_return_labels ADD COLUMN IF NOT EXISTS combined_sku_id INTEGER REFERENCES amazon_return_combined_skus(id) ON DELETE CASCADE`)
  try {
    await query(`ALTER TABLE amazon_return_labels ALTER COLUMN item_id DROP NOT NULL`)
  } catch (_) {
    /* item_id column may not exist on fresh installs */
  }
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_return_labels_batch_id ON amazon_return_labels(batch_id)`)
}

async function insertParsedRows(client, batchId, parsed) {
  const allRows = [
    ...parsed.returnedStock,
    ...parsed.oldStock,
    ...parsed.ignoredRows.map((row) => ({ ...row, qtyReceived: null })),
  ]
  for (const row of allRows) {
    await client.query(
      `INSERT INTO amazon_return_items (
        batch_id, working_sku, sku, original_sku, alternative_sku,
        removal_order_id, qty_received, receiving_date, section_type, admin_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        batchId,
        row.workingSku || row.originalSku || row.alternativeSku || '',
        row.originalSku || row.workingSku || '',
        row.originalSku || row.workingSku || '',
        row.alternativeSku || '',
        row.removalOrderId || '',
        row.qtyReceived,
        row.receivingDate || null,
        row.sectionType,
        row.adminNotes || '',
      ]
    )
  }
}

async function insertCombinedSkus(client, batchId, combinedStock) {
  for (const row of combinedStock) {
    await client.query(
      `INSERT INTO amazon_return_combined_skus (
        batch_id, working_sku, returned_qty, old_stock_qty, total_available_qty
      ) VALUES ($1,$2,$3,$4,$5)`,
      [batchId, row.workingSku, row.returnedQty, row.oldStockQty, row.totalAvailableQty]
    )
  }
}

async function rebuildCombinedSkus(batchId) {
  const items = await query(
    `SELECT working_sku, qty_received, section_type
     FROM amazon_return_items WHERE batch_id = $1`,
    [batchId]
  )
  const returnedStock = items.rows
    .filter((r) => r.section_type === SECTION.RETURN_RECEIVED)
    .map((r) => ({ workingSku: r.working_sku, qtyReceived: r.qty_received }))
  const oldStock = items.rows
    .filter((r) => r.section_type === SECTION.OLD_STOCK)
    .map((r) => ({ workingSku: r.working_sku, qtyReceived: r.qty_received }))
  const combinedStock = combineAvailableStock(returnedStock, oldStock)

  await query(`DELETE FROM amazon_return_combined_skus WHERE batch_id = $1`, [batchId])
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await insertCombinedSkus(client, batchId, combinedStock)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return combinedStock
}

async function updateBatchSummary(batchId, summaryOverride = null) {
  const detail = summaryOverride || (await buildSummaryFromDb(batchId))
  await query(
    `UPDATE amazon_return_batches
     SET total_skus = $2, total_qty_received = $3, total_cartons_received = $4,
         issue_count = $5, old_stock_quantity = $6, updated_at = NOW()
     WHERE id = $1`,
    [
      batchId,
      detail.totalAvailableSkus,
      detail.totalReturnedQty,
      0,
      detail.ignoredRowCount,
      detail.totalOldStockQty,
    ]
  )
  return detail
}

async function buildSummaryFromDb(batchId) {
  const items = await query(`SELECT * FROM amazon_return_items WHERE batch_id = $1`, [batchId])
  const combined = await query(`SELECT * FROM amazon_return_combined_skus WHERE batch_id = $1`, [batchId])
  const returnedStock = items.rows.filter((r) => r.section_type === SECTION.RETURN_RECEIVED)
  const oldStock = items.rows.filter((r) => r.section_type === SECTION.OLD_STOCK)
  const ignoredRows = items.rows.filter((r) => r.section_type === SECTION.IGNORED)
  const combinedStock = combined.rows.map((row) => ({
    workingSku: row.working_sku,
    returnedQty: Number(row.returned_qty || 0),
    oldStockQty: Number(row.old_stock_qty || 0),
    totalAvailableQty: Number(row.total_available_qty || 0),
  }))
  return computeSummary({
    returnedStock: returnedStock.map((r) => ({ workingSku: r.working_sku, qtyReceived: r.qty_received })),
    oldStock: oldStock.map((r) => ({ workingSku: r.working_sku, qtyReceived: r.qty_received })),
    ignoredRows,
    combinedStock,
  })
}

async function createBatchFromUpload({ file, title, marketplace, agentName, shippingTo, createdBy }) {
  if (!file || !file.buffer) {
    const err = new Error('File is required')
    err.status = 400
    err.code = 'FILE_REQUIRED'
    throw err
  }
  const parsed = parseSourceFile(file.buffer, file.originalname)
  const hasStock = parsed.returnedStock.length > 0 || parsed.oldStock.length > 0
  if (!hasStock) {
    const err = new Error('No rows with received quantity found in the uploaded file')
    err.status = 400
    err.code = 'NO_ROWS_FOUND'
    throw err
  }
  const combinedStock = combineAvailableStock(parsed.returnedStock, parsed.oldStock)
  const summary = computeSummary({ ...parsed, combinedStock })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const batchResult = await client.query(
      `INSERT INTO amazon_return_batches (
        title, marketplace, agent_name, shipping_to, public_token, source_file_name,
        status, total_skus, total_qty_received, total_cartons_received, issue_count,
        old_stock_quantity, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,'Open',$7,$8,$9,$10,$11,$12)
      RETURNING ${BATCH_RETURNING_COLUMNS}`,
      [
        clean(title) || `Stock Relabeling ${new Date().toISOString().slice(0, 10)}`,
        normalizeMarketplace(marketplace),
        clean(agentName),
        clean(shippingTo),
        createPublicToken(),
        file.originalname || '',
        summary.totalAvailableSkus,
        summary.totalReturnedQty,
        0,
        summary.ignoredRowCount,
        summary.totalOldStockQty,
        createdBy || null,
      ]
    )
    const batchId = batchResult.rows[0].id
    await insertParsedRows(client, batchId, parsed)
    await insertCombinedSkus(client, batchId, combinedStock)
    await client.query('COMMIT')
    return getBatchDetail(batchId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listBatches() {
  const result = await query(`SELECT ${RETURN_COLUMNS} FROM amazon_return_batches b ORDER BY b.created_at DESC LIMIT 100`)
  return result.rows.map(mapBatch)
}

async function getItemsForBatch(batchId) {
  const result = await query(
    `SELECT * FROM amazon_return_items WHERE batch_id = $1 ORDER BY section_type, id`,
    [batchId]
  )
  return result.rows.map(mapItem)
}

async function getCombinedSkusForBatch(batchId) {
  const result = await query(
    `SELECT c.*,
            l.id AS label_id, l.file_name AS label_file_name, l.file_mime_type AS label_file_mime_type,
            l.uploaded_at AS label_uploaded_at, l.replaced_at AS label_replaced_at
     FROM amazon_return_combined_skus c
     LEFT JOIN amazon_return_labels l ON l.combined_sku_id = c.id
     WHERE c.batch_id = $1
     ORDER BY c.working_sku`,
    [batchId]
  )
  return result.rows.map(mapCombinedSku)
}

async function getBatchDetail(batchId) {
  const batchResult = await query(`SELECT ${RETURN_COLUMNS} FROM amazon_return_batches b WHERE b.id = $1`, [batchId])
  const batch = mapBatch(batchResult.rows[0])
  if (!batch) return null
  const items = await getItemsForBatch(batch.id)
  const combinedStock = await getCombinedSkusForBatch(batch.id)
  const returnedStock = items.filter((item) => item.sectionType === SECTION.RETURN_RECEIVED)
  const oldStockItems = items.filter((item) => item.sectionType === SECTION.OLD_STOCK)
  const ignoredRows = items.filter((item) => item.sectionType === SECTION.IGNORED)
  const summary = computeSummary({
    returnedStock,
    oldStock: oldStockItems,
    ignoredRows,
    combinedStock,
  })
  return {
    batch,
    summary,
    returnedStock,
    oldStockItems,
    ignoredRows,
    combinedStock,
    publicUrlPath: `/agent/amazon-return-report/${batch.publicToken}`,
  }
}

async function getAgentReportByToken(publicToken) {
  const batchResult = await query(`SELECT ${RETURN_COLUMNS} FROM amazon_return_batches b WHERE b.public_token = $1`, [publicToken])
  const batch = mapBatch(batchResult.rows[0])
  if (!batch) return null

  const combinedResult = await query(
    `SELECT c.*,
            l.id AS label_id, l.file_name AS label_file_name, l.file_mime_type AS label_file_mime_type,
            l.uploaded_at AS label_uploaded_at, l.replaced_at AS label_replaced_at
     FROM amazon_return_combined_skus c
     LEFT JOIN amazon_return_labels l ON l.combined_sku_id = c.id
     WHERE c.batch_id = $1
     ORDER BY c.working_sku`,
    [batch.id]
  )
  const combinedStock = combinedResult.rows.map(mapAgentCombinedSku)
  const summary = {
    totalAvailableSkus: combinedStock.length,
    totalAvailableQty: combinedStock.reduce((sum, row) => sum + Number(row.totalAvailableQty || 0), 0),
  }
  return {
    batch: {
      title: batch.title,
      marketplace: batch.marketplace,
      agentName: batch.agentName,
    },
    summary,
    combinedStock,
  }
}

async function updateCombinedSku(combinedSkuId, patch) {
  const existing = await query(`SELECT * FROM amazon_return_combined_skus WHERE id = $1`, [combinedSkuId])
  if (!existing.rows[0]) return null
  const row = existing.rows[0]
  await query(
    `UPDATE amazon_return_combined_skus
     SET label_downloaded = COALESCE($2, label_downloaded),
         label_printed = COALESCE($3, label_printed),
         relabeled = COALESCE($4, relabeled),
         packed = COALESCE($5, packed),
         ready_for_shipment = COALESCE($6, ready_for_shipment),
         notes = COALESCE($7, notes),
         agent_notes = COALESCE($8, agent_notes),
         updated_at = NOW()
     WHERE id = $1`,
    [
      combinedSkuId,
      patch.labelDownloaded == null ? null : Boolean(patch.labelDownloaded),
      patch.labelPrinted == null ? null : Boolean(patch.labelPrinted),
      patch.relabeled == null ? null : Boolean(patch.relabeled),
      patch.packed == null ? null : Boolean(patch.packed),
      patch.readyForShipment == null ? null : Boolean(patch.readyForShipment),
      patch.notes == null ? null : clean(patch.notes),
      patch.agentNotes == null ? null : clean(patch.agentNotes),
    ]
  )
  return getBatchDetail(row.batch_id)
}

async function updateAgentCombinedSku(publicToken, combinedSkuId, patch) {
  const report = await getAgentReportByToken(publicToken)
  if (!report) return null
  const sku = report.combinedStock.find((row) => String(row.id) === String(combinedSkuId))
  if (!sku) return null
  const existing = await query(`SELECT batch_id FROM amazon_return_combined_skus WHERE id = $1`, [combinedSkuId])
  if (!existing.rows[0]) return null
  await query(
    `UPDATE amazon_return_combined_skus
     SET label_downloaded = COALESCE($2, label_downloaded),
         label_printed = COALESCE($3, label_printed),
         relabeled = COALESCE($4, relabeled),
         packed = COALESCE($5, packed),
         ready_for_shipment = COALESCE($6, ready_for_shipment),
         agent_notes = COALESCE($7, agent_notes),
         updated_at = NOW()
     WHERE id = $1`,
    [
      combinedSkuId,
      patch.labelDownloaded == null ? null : Boolean(patch.labelDownloaded),
      patch.labelPrinted == null ? null : Boolean(patch.labelPrinted),
      patch.relabeled == null ? null : Boolean(patch.relabeled),
      patch.packed == null ? null : Boolean(patch.packed),
      patch.readyForShipment == null ? null : Boolean(patch.readyForShipment),
      patch.agentNotes == null ? null : clean(patch.agentNotes),
    ]
  )
  const batchResult = await query(`SELECT public_token FROM amazon_return_batches WHERE id = $1`, [existing.rows[0].batch_id])
  return getAgentReportByToken(batchResult.rows[0].public_token)
}

async function uploadLabel({ combinedSkuId, file, uploadedBy }) {
  if (!file || !file.buffer) {
    const err = new Error('Label file is required')
    err.status = 400
    err.code = 'LABEL_FILE_REQUIRED'
    throw err
  }
  if (!isAllowedLabelMime(file.mimetype, file.originalname)) {
    const err = new Error('Only PDF, PNG, JPG, or JPEG label files are allowed')
    err.status = 400
    err.code = 'LABEL_FILE_TYPE_INVALID'
    throw err
  }
  const combinedResult = await query(`SELECT * FROM amazon_return_combined_skus WHERE id = $1`, [combinedSkuId])
  const combined = combinedResult.rows[0]
  if (!combined) return null

  const existingResult = await query(`SELECT * FROM amazon_return_labels WHERE combined_sku_id = $1`, [combinedSkuId])
  const existing = existingResult.rows[0]
  const key = createAmazonReturnLabelKey(combined.batch_id, combined.id, file.originalname)
  await s3Service.putObjectBuffer({ key, body: file.buffer, contentType: file.mimetype || 'application/pdf' })

  if (existing) {
    await query(
      `UPDATE amazon_return_labels
       SET file_name = $2, storage_path = $3, file_mime_type = $4, uploaded_by = $5,
           uploaded_at = NOW(), replaced_at = NOW(), sku = $6
       WHERE id = $1`,
      [existing.id, file.originalname, key, file.mimetype || 'application/octet-stream', uploadedBy || null, combined.working_sku]
    )
    await s3Service.deleteObjectIfExists(existing.storage_path).catch(() => {})
  } else {
    await query(
      `INSERT INTO amazon_return_labels (batch_id, combined_sku_id, sku, file_name, storage_path, file_mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [combined.batch_id, combined.id, combined.working_sku, file.originalname, key, file.mimetype || 'application/octet-stream', uploadedBy || null]
    )
  }
  return getBatchDetail(combined.batch_id)
}

async function deleteLabel(labelId) {
  const result = await query(`DELETE FROM amazon_return_labels WHERE id = $1 RETURNING *`, [labelId])
  const label = result.rows[0]
  if (!label) return null
  await s3Service.deleteObjectIfExists(label.storage_path).catch(() => {})
  return getBatchDetail(label.batch_id)
}

async function regeneratePublicToken(batchId) {
  const result = await query(
    `UPDATE amazon_return_batches SET public_token = $2, updated_at = NOW() WHERE id = $1 RETURNING ${BATCH_RETURNING_COLUMNS}`,
    [batchId, createPublicToken()]
  )
  return result.rows[0] ? getBatchDetail(batchId) : null
}

async function getLabelForPublicDownload(publicToken, labelId) {
  const result = await query(
    `SELECT l.*
     FROM amazon_return_labels l
     JOIN amazon_return_batches b ON b.id = l.batch_id
     WHERE b.public_token = $1 AND l.id = $2`,
    [publicToken, labelId]
  )
  return mapLabel(result.rows[0])
}

function combinedRowsToExportObjects(rows) {
  return rows.map((row) => ({
    SKU: row.workingSku,
    'Returned Qty': row.returnedQty,
    'Old Stock Qty': row.oldStockQty,
    'Total Available Qty': row.totalAvailableQty,
    'Label Downloaded': row.labelDownloaded ? 'Yes' : 'No',
    'Label Printed': row.labelPrinted ? 'Yes' : 'No',
    Relabeled: row.relabeled ? 'Yes' : 'No',
    Packed: row.packed ? 'Yes' : 'No',
    'Ready for Shipment': row.readyForShipment ? 'Yes' : 'No',
    Notes: row.notes,
    'Agent Notes': row.agentNotes,
    'Label Status': row.labelStatus,
  }))
}

async function exportBatch(batchIdOrToken, { publicToken = false } = {}) {
  const detail = publicToken
    ? await getAgentReportByToken(batchIdOrToken)
    : await getBatchDetail(batchIdOrToken)
  if (!detail) return null
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Available Stock')
  const rows = publicToken ? detail.combinedStock : detail.combinedStock
  const objects = combinedRowsToExportObjects(rows)
  if (objects.length === 0) {
    sheet.addRow(['No rows'])
  } else {
    sheet.columns = Object.keys(objects[0]).map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 4, 14), 34) }))
    for (const row of objects) sheet.addRow(row)
    sheet.getRow(1).font = { bold: true }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const safeTitle = sanitizeName((detail.batch.title || 'stock-relabeling'))
  return { buffer: Buffer.from(buffer), filename: `${safeTitle}.xlsx` }
}

module.exports = {
  SECTION,
  LABEL_STATUS,
  ensureAmazonReturnReconciliationTables,
  createAmazonReturnLabelKey,
  isAllowedLabelMime,
  resolveWorkingSku,
  parseSourceFile,
  combineAvailableStock,
  computeSummary,
  createBatchFromUpload,
  listBatches,
  getBatchDetail,
  getAgentReportByToken,
  updateCombinedSku,
  updateAgentCombinedSku,
  uploadLabel,
  deleteLabel,
  regeneratePublicToken,
  getLabelForPublicDownload,
  exportBatch,
  _internals: {
    normalizeSku,
    rowLooksOldStockMarker,
  },
}
