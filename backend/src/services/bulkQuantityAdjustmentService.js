const ExcelJS = require('exceljs')
const { parseCsv, indexHeaders, cellOf } = require('../utils/csv')
const { parseTabularExcel, isExcelFile } = require('./vigilStockParseService')
const { findItemsBySkus, getItemCacheStats } = require('./zohoBulkInvoiceStore')
const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { fetchItemById } = require('../integrations/zoho/zohoInventoryClient')
const {
  createQuantityInventoryAdjustment,
  fetchInventoryAdjustmentDetail,
  chunkLineItems,
  MAX_LINES_PER_ADJUSTMENT,
} = require('../integrations/zoho/zohoInventoryAdjustments')
const { isSyncPaused } = require('./zohoApiClient')
const {
  createBatch,
  getBatchById,
  getBatchRows,
  updateBatchCounts,
  updateRowsBulk,
} = require('./bulkQuantityAdjustmentStore')

const MAX_UPLOAD_ROWS = 500
const REQUIRED_COLUMNS = ['sku', 'adjustment_qty', 'reason']
const WAREHOUSE_COLUMNS = ['warehouse_id', 'warehouse_name']

const COLUMN_ALIASES = {
  sku: ['sku', 'item sku', 'item_sku', 'product sku', 'product_sku'],
  adjustment_qty: ['adjustment_qty', 'adjustment qty', 'qty', 'quantity', 'adjustment quantity', 'adjustment_quantity'],
  warehouse_id: ['warehouse_id', 'warehouse id', 'wh_id', 'wh id'],
  warehouse_name: ['warehouse_name', 'warehouse name', 'warehouse', 'wh_name', 'wh name'],
  reason: ['reason', 'adjustment reason', 'adjustment_reason'],
  description: ['description', 'desc', 'notes'],
  reference_number: ['reference_number', 'reference number', 'reference', 'ref', 'ref_no', 'ref no'],
  item_name: ['item_name', 'item name', 'name', 'product name', 'product_name'],
  remarks: ['remarks', 'remark', 'comment', 'comments'],
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function toNumber(value) {
  if (value == null || value === '') return NaN
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

function findHeader(headerIdx, aliases) {
  for (const alias of aliases) {
    if (headerIdx.has(alias)) return alias
  }
  return ''
}

function normalizeHeaders(headers) {
  const normalized = headers.map((h) => clean(h).toLowerCase())
  return indexHeaders(normalized)
}

function parseUploadBuffer(buffer, fileName = '') {
  if (!buffer || !buffer.length) {
    const err = new Error('Upload file is empty')
    err.code = 'UPLOAD_EMPTY'
    throw err
  }
  const parsed = isExcelFile(fileName)
    ? parseTabularExcel(buffer)
    : parseCsv(buffer.toString('utf8'))
  if (!parsed.headers.length) {
    const err = new Error('Upload file has no header row')
    err.code = 'UPLOAD_NO_HEADERS'
    throw err
  }
  const headerIdx = normalizeHeaders(parsed.headers)
  const col = {}
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    col[key] = findHeader(headerIdx, aliases)
  }
  for (const req of REQUIRED_COLUMNS) {
    if (!col[req]) {
      const err = new Error(`Missing required column: ${req}`)
      err.code = 'UPLOAD_MISSING_COLUMN'
      err.column = req
      throw err
    }
  }
  if (!col.warehouse_id && !col.warehouse_name) {
    const err = new Error('Missing warehouse column: provide warehouse_id or warehouse_name')
    err.code = 'UPLOAD_MISSING_COLUMN'
    err.column = 'warehouse'
    throw err
  }

  const rows = []
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const raw = parsed.rows[i]
    if (!Array.isArray(raw) || !raw.some((cell) => clean(cell) !== '')) continue
    rows.push({
      row_number: i + 2,
      sku: clean(cellOf(raw, headerIdx, col.sku)),
      adjustment_qty: toNumber(cellOf(raw, headerIdx, col.adjustment_qty)),
      warehouse_id: col.warehouse_id ? clean(cellOf(raw, headerIdx, col.warehouse_id)) : '',
      warehouse_name: col.warehouse_name ? clean(cellOf(raw, headerIdx, col.warehouse_name)) : '',
      reason: clean(cellOf(raw, headerIdx, col.reason)),
      description: col.description ? clean(cellOf(raw, headerIdx, col.description)) : '',
      reference_number: col.reference_number ? clean(cellOf(raw, headerIdx, col.reference_number)) : '',
      item_name: col.item_name ? clean(cellOf(raw, headerIdx, col.item_name)) : '',
      remarks: col.remarks ? clean(cellOf(raw, headerIdx, col.remarks)) : '',
    })
    if (rows.length >= MAX_UPLOAD_ROWS) break
  }

  if (!rows.length) {
    const err = new Error('Upload file contains no data rows')
    err.code = 'UPLOAD_NO_ROWS'
    throw err
  }

  return {
    rows,
    columns_detected: col,
    truncated: parsed.rows.length > MAX_UPLOAD_ROWS,
  }
}

function idsMatch(a, b) {
  if (a == null || b == null) return false
  return String(a).trim() === String(b).trim()
}

function findItemLocation(item, warehouseId) {
  if (!item || typeof item !== 'object') return null
  const list = Array.isArray(item.warehouses) && item.warehouses.length > 0
    ? item.warehouses
    : Array.isArray(item.locations) && item.locations.length > 0
      ? item.locations
      : null
  if (!list) return null
  return list.find((loc) => (
    loc
    && (
      idsMatch(loc.location_id, warehouseId)
      || idsMatch(loc.warehouse_id, warehouseId)
    )
  )) || null
}

function parseWarehouseStock(item, warehouseId) {
  if (!item || typeof item !== 'object') return null
  const loc = findItemLocation(item, warehouseId)
  if (loc) {
    for (const k of [
      'warehouse_stock_on_hand',
      'location_stock_on_hand',
      'warehouse_available_stock',
      'location_available_stock',
    ]) {
      const n = toNumber(loc[k])
      if (Number.isFinite(n)) return n
    }
  }
  for (const k of ['stock_on_hand', 'available_stock']) {
    const n = toNumber(item[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

function buildWarehouseMaps(warehouses) {
  const byId = new Map()
  const byName = new Map()
  for (const wh of warehouses || []) {
    if (!wh) continue
    const id = clean(wh.warehouse_id || wh.location_id)
    const name = clean(wh.warehouse_name || wh.location_name)
    if (id) byId.set(id.toLowerCase(), wh)
    if (name) byName.set(name.toLowerCase(), wh)
  }
  return { byId, byName }
}

function resolveWarehouse(row, maps) {
  const id = clean(row.warehouse_id)
  if (id && maps.byId.has(id.toLowerCase())) {
    const wh = maps.byId.get(id.toLowerCase())
    return {
      warehouse_id: clean(wh.warehouse_id || wh.location_id || id),
      warehouse_name: clean(wh.warehouse_name || wh.location_name || row.warehouse_name),
    }
  }
  const name = clean(row.warehouse_name)
  if (name && maps.byName.has(name.toLowerCase())) {
    const wh = maps.byName.get(name.toLowerCase())
    return {
      warehouse_id: clean(wh.warehouse_id || wh.location_id),
      warehouse_name: clean(wh.warehouse_name || wh.location_name || name),
    }
  }
  if (id) {
    return { warehouse_id: id, warehouse_name: name, unresolved: true }
  }
  if (name) {
    return { warehouse_id: '', warehouse_name: name, unresolved: true }
  }
  return { warehouse_id: '', warehouse_name: '', unresolved: true }
}

function summarizeRows(rows) {
  const total = rows.length
  const valid = rows.filter((r) => r.validation_status === 'valid').length
  const unmatched = rows.filter((r) => r.validation_status === 'unmatched').length
  const duplicate = rows.filter((r) => r.validation_status === 'duplicate').length
  const invalidQty = rows.filter((r) => r.validation_status === 'invalid_qty').length
  const missingWarehouse = rows.filter((r) => r.validation_status === 'missing_warehouse').length
  const missingField = rows.filter((r) => r.validation_status === 'missing_field').length
  const blocking = rows.filter((r) => r.validation_status !== 'valid').length
  const readyToPost = valid
  const posted = rows.filter((r) => r.posting_status === 'posted').length
  const failed = rows.filter((r) => r.posting_status === 'failed').length
  const pendingValuation = rows.filter((r) => r.valuation_status === 'pending').length

  return {
    total_rows: total,
    valid_rows: valid,
    unmatched_skus: unmatched,
    duplicate_skus: duplicate,
    invalid_quantities: invalidQty,
    missing_warehouse: missingWarehouse,
    missing_field: missingField,
    error_rows: blocking,
    ready_to_post: readyToPost,
    posted_successfully: posted,
    failed,
    pending_valuation: pendingValuation,
  }
}

async function validateBatchRows(batchId) {
  const batch = await getBatchById(batchId)
  if (!batch) {
    const err = new Error('Batch not found')
    err.code = 'BATCH_NOT_FOUND'
    throw err
  }

  const rows = await getBatchRows(batchId)
  const warehouses = await fetchWarehouses()
  const whMaps = buildWarehouseMaps(warehouses)

  const skus = [...new Set(rows.map((r) => clean(r.sku)).filter(Boolean))]
  const foundItems = await findItemsBySkus(skus)
  const itemBySku = new Map()
  for (const item of foundItems) {
    const key = clean(item.sku).toLowerCase()
    if (key && !itemBySku.has(key)) itemBySku.set(key, item)
  }

  const skuCounts = new Map()
  for (const row of rows) {
    const key = clean(row.sku).toLowerCase()
    if (!key) continue
    skuCounts.set(key, (skuCounts.get(key) || 0) + 1)
  }

  const stockCache = new Map()
  async function getStock(itemId, warehouseId) {
    const cacheKey = `${itemId}:${warehouseId}`
    if (stockCache.has(cacheKey)) return stockCache.get(cacheKey)
    try {
      const detail = await fetchItemById(itemId, { skipCache: true })
      const stock = parseWarehouseStock(detail, warehouseId)
      stockCache.set(cacheKey, stock)
      return stock
    } catch {
      stockCache.set(cacheKey, null)
      return null
    }
  }

  const rowPatches = []
  for (const row of rows) {
    const errors = []
    let validationStatus = 'valid'
    const sku = clean(row.sku)
    const qty = toNumber(row.adjustment_qty)
    const reason = clean(row.reason)

    if (!sku) {
      errors.push('SKU is required')
      validationStatus = 'missing_field'
    }
    if (!Number.isFinite(qty) || qty === 0) {
      errors.push('adjustment_qty must be non-zero')
      validationStatus = validationStatus === 'valid' ? 'invalid_qty' : validationStatus
    }
    if (!reason) {
      errors.push('reason is required')
      validationStatus = validationStatus === 'valid' ? 'missing_field' : validationStatus
    }

    const wh = resolveWarehouse(row, whMaps)
    if (wh.unresolved) {
      errors.push('Warehouse not found in Zoho')
      validationStatus = validationStatus === 'valid' ? 'missing_warehouse' : validationStatus
    }

    const skuKey = sku.toLowerCase()
    if (skuKey && (skuCounts.get(skuKey) || 0) > 1) {
      errors.push('Duplicate SKU in upload file')
      if (validationStatus === 'valid') validationStatus = 'duplicate'
    }

    let zohoItem = skuKey ? itemBySku.get(skuKey) : null
    if (sku && !zohoItem) {
      errors.push('SKU not found in Zoho (exact match)')
      validationStatus = 'unmatched'
    }

    let currentStock = null
    let expectedAfter = null
    let itemName = row.item_name || ''
    let zohoItemId = ''

    if (zohoItem) {
      zohoItemId = String(zohoItem.item_id)
      itemName = itemName || zohoItem.name || ''
      if (wh.warehouse_id && validationStatus === 'valid') {
        currentStock = await getStock(zohoItemId, wh.warehouse_id)
        if (Number.isFinite(currentStock) && Number.isFinite(qty)) {
          expectedAfter = Math.round((currentStock + qty) * 10000) / 10000
        }
      }
    }

    rowPatches.push({
      id: row.id,
      patch: {
        sku,
        item_name: itemName,
        zoho_item_id: zohoItemId,
        warehouse_id: wh.warehouse_id || '',
        warehouse_name: wh.warehouse_name || '',
        current_stock: currentStock,
        adjustment_qty: Number.isFinite(qty) ? qty : row.adjustment_qty,
        expected_stock_after: expectedAfter,
        validation_status: validationStatus,
        error_message: errors.join('; '),
        posting_status: validationStatus === 'valid' ? 'ready' : 'skipped',
      },
    })
  }

  const updatedRows = await updateRowsBulk(batchId, rowPatches)
  const summary = summarizeRows(updatedRows)
  const updatedBatch = await updateBatchCounts(batchId, {
    status: 'validated',
    total_rows: summary.total_rows,
    valid_rows: summary.valid_rows,
    error_rows: summary.error_rows,
  })

  const cache = await getItemCacheStats()
  return { batch: updatedBatch, rows: updatedRows, summary, cache }
}

async function uploadAndCreateBatch({ buffer, fileName, createdBy }) {
  const parsed = parseUploadBuffer(buffer, fileName)
  const { batch, rows } = await createBatch({
    uploadedFileName: fileName || 'upload.csv',
    createdBy,
    rows: parsed.rows,
  })
  return {
    batch,
    rows,
    parse_meta: {
      columns_detected: parsed.columns_detected,
      truncated: parsed.truncated,
    },
  }
}

function groupKeyForRow(row, date) {
  return [
    date,
    clean(row.warehouse_id),
    clean(row.reason),
    clean(row.reference_number),
  ].join('|')
}

async function postBatch(batchId, { date, confirmedBy }) {
  if (await isSyncPaused()) {
    const err = new Error('Zoho API sync is paused (daily limit). Try again later.')
    err.code = 'ZOHO_SYNC_PAUSED'
    throw err
  }

  const batch = await getBatchById(batchId)
  if (!batch) {
    const err = new Error('Batch not found')
    err.code = 'BATCH_NOT_FOUND'
    throw err
  }
  if (batch.status === 'posted') {
    const err = new Error('Batch was already posted')
    err.code = 'BATCH_ALREADY_POSTED'
    throw err
  }

  let rows = await getBatchRows(batchId)
  const validRows = rows.filter((r) => r.validation_status === 'valid')
  if (!validRows.length) {
    const err = new Error('No valid rows to post. Fix validation errors first.')
    err.code = 'NO_VALID_ROWS'
    throw err
  }
  if (rows.some((r) => r.validation_status !== 'valid')) {
    const err = new Error('Batch has blocking validation errors. Export errors and fix before posting.')
    err.code = 'BLOCKING_VALIDATION_ERRORS'
    throw err
  }

  await updateBatchCounts(batchId, { status: 'posting' })

  const postDate = clean(date) || new Date().toISOString().slice(0, 10)
  const groups = new Map()
  for (const row of validRows) {
    const key = groupKeyForRow(row, postDate)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const zohoAdjustmentIds = []
  const rowPatches = []
  let postedCount = 0
  let failedCount = 0

  for (const [, groupRows] of groups) {
    const first = groupRows[0]
    const lineItems = groupRows.map((r) => ({
      item_id: r.zoho_item_id,
      quantity_adjusted: r.adjustment_qty,
      warehouse_id: r.warehouse_id,
      description: r.description || r.remarks || '',
    }))

    const chunks = chunkLineItems(lineItems)
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex]
      const chunkRows = groupRows.slice(
        chunkIndex * MAX_LINES_PER_ADJUSTMENT,
        chunkIndex * MAX_LINES_PER_ADJUSTMENT + chunk.length,
      )
      const chunkRowIds = chunkRows.map((r) => r.id)

      try {
        const result = await createQuantityInventoryAdjustment({
          date: postDate,
          reason: first.reason,
          description: first.description || `Bulk quantity adjustment batch ${batch.batch_reference}`,
          reference_number: first.reference_number
            ? (chunks.length > 1
              ? `${first.reference_number}-${chunkIndex + 1}`
              : first.reference_number)
            : batch.batch_reference,
          warehouse_id: first.warehouse_id,
          line_items: chunk,
        })

        if (result.inventory_adjustment_id) {
          zohoAdjustmentIds.push(result.inventory_adjustment_id)
        }

        for (const rowId of chunkRowIds) {
          rowPatches.push({
            id: rowId,
            patch: {
              posting_status: 'posted',
              zoho_inventory_adjustment_id: result.inventory_adjustment_id || '',
              valuation_status: result.valuation_pending ? 'pending' : 'complete',
              error_message: '',
            },
          })
          postedCount += 1
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        for (const rowId of chunkRowIds) {
          rowPatches.push({
            id: rowId,
            patch: {
              posting_status: 'failed',
              error_message: msg,
            },
          })
          failedCount += 1
        }
      }
    }
  }

  const updatedRows = await updateRowsBulk(batchId, rowPatches)
  const finalStatus = failedCount > 0 && postedCount === 0 ? 'failed' : 'posted'
  const updatedBatch = await updateBatchCounts(batchId, {
    status: finalStatus,
    posted_rows: postedCount,
    failed_rows: failedCount,
    zoho_adjustment_ids: zohoAdjustmentIds,
    notes: confirmedBy ? `Posted by user ${confirmedBy}` : '',
  })

  return {
    batch: updatedBatch,
    rows: updatedRows,
    summary: summarizeRows(updatedRows),
    zoho_adjustment_ids: zohoAdjustmentIds,
  }
}

async function refreshBatchValuation(batchId) {
  const batch = await getBatchById(batchId)
  if (!batch) {
    const err = new Error('Batch not found')
    err.code = 'BATCH_NOT_FOUND'
    throw err
  }

  const rows = await getBatchRows(batchId)
  const adjIds = [...new Set(
    rows
      .map((r) => clean(r.zoho_inventory_adjustment_id))
      .filter(Boolean),
  )]

  const adjStatus = new Map()
  for (const adjId of adjIds) {
    try {
      const detail = await fetchInventoryAdjustmentDetail(adjId)
      adjStatus.set(adjId, detail.is_inventory_valuation_pending ? 'pending' : 'complete')
    } catch {
      adjStatus.set(adjId, 'unknown')
    }
  }

  const rowPatches = []
  for (const row of rows) {
    if (row.posting_status !== 'posted') continue
    const adjId = clean(row.zoho_inventory_adjustment_id)
    const valuation = adjId && adjStatus.has(adjId)
      ? adjStatus.get(adjId)
      : row.valuation_status
    rowPatches.push({
      id: row.id,
      patch: { valuation_status: valuation || 'unknown' },
    })
  }

  const updatedRows = await updateRowsBulk(batchId, rowPatches)
  return {
    batch,
    rows: updatedRows,
    summary: summarizeRows(updatedRows),
  }
}

async function getBatchDetail(batchId) {
  const batch = await getBatchById(batchId)
  if (!batch) {
    const err = new Error('Batch not found')
    err.code = 'BATCH_NOT_FOUND'
    throw err
  }
  const rows = await getBatchRows(batchId)
  return {
    batch,
    rows,
    summary: summarizeRows(rows),
  }
}

function templateCsvContent() {
  const headers = [
    'sku',
    'adjustment_qty',
    'warehouse_name',
    'reason',
    'description',
    'reference_number',
    'item_name',
    'remarks',
  ]
  const example = [
    'EXAMPLE-SKU-001',
    '-2',
    'Main Warehouse',
    'Damaged goods',
    'Bulk adjustment example',
    'REF-BQA-001',
    '',
    '',
  ]
  return `${headers.join(',')}\r\n${example.join(',')}\r\n`
}

async function buildErrorExportWorkbook(rows) {
  const errorRows = (rows || []).filter((r) => r.validation_status !== 'valid' || r.posting_status === 'failed')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Errors')
  sheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'SKU', key: 'sku', width: 22 },
    { header: 'Item Name', key: 'item_name', width: 28 },
    { header: 'Warehouse', key: 'warehouse_name', width: 20 },
    { header: 'Adjustment Qty', key: 'adjustment_qty', width: 16 },
    { header: 'Reason', key: 'reason', width: 18 },
    { header: 'Validation Status', key: 'validation_status', width: 18 },
    { header: 'Posting Status', key: 'posting_status', width: 14 },
    { header: 'Error Message', key: 'error_message', width: 40 },
  ]
  for (const row of errorRows) {
    sheet.addRow({
      row_number: row.row_number,
      sku: row.sku,
      item_name: row.item_name,
      warehouse_name: row.warehouse_name,
      adjustment_qty: row.adjustment_qty,
      reason: row.reason,
      validation_status: row.validation_status,
      posting_status: row.posting_status,
      error_message: row.error_message,
    })
  }
  sheet.getRow(1).font = { bold: true }
  return workbook
}

async function buildResultExportWorkbook(batch, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Results')
  sheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'SKU', key: 'sku', width: 22 },
    { header: 'Zoho Item Name', key: 'item_name', width: 28 },
    { header: 'Zoho Item ID', key: 'zoho_item_id', width: 20 },
    { header: 'Current Stock', key: 'current_stock', width: 14 },
    { header: 'Adjustment Qty', key: 'adjustment_qty', width: 16 },
    { header: 'Expected After', key: 'expected_stock_after', width: 14 },
    { header: 'Warehouse', key: 'warehouse_name', width: 20 },
    { header: 'Reason', key: 'reason', width: 18 },
    { header: 'Reference', key: 'reference_number', width: 16 },
    { header: 'Validation', key: 'validation_status', width: 14 },
    { header: 'Posting', key: 'posting_status', width: 12 },
    { header: 'Valuation', key: 'valuation_status', width: 14 },
    { header: 'Zoho Adjustment ID', key: 'zoho_inventory_adjustment_id', width: 22 },
    { header: 'Error', key: 'error_message', width: 36 },
  ]
  for (const row of rows || []) {
    sheet.addRow({
      row_number: row.row_number,
      sku: row.sku,
      item_name: row.item_name,
      zoho_item_id: row.zoho_item_id,
      current_stock: row.current_stock,
      adjustment_qty: row.adjustment_qty,
      expected_stock_after: row.expected_stock_after,
      warehouse_name: row.warehouse_name,
      reason: row.reason,
      reference_number: row.reference_number,
      validation_status: row.validation_status,
      posting_status: row.posting_status,
      valuation_status: row.valuation_status,
      zoho_inventory_adjustment_id: row.zoho_inventory_adjustment_id,
      error_message: row.error_message,
    })
  }
  sheet.getRow(1).font = { bold: true }

  const meta = workbook.addWorksheet('Batch')
  meta.addRow(['Batch Reference', batch.batch_reference])
  meta.addRow(['File Name', batch.uploaded_file_name])
  meta.addRow(['Status', batch.status])
  meta.addRow(['Zoho Adjustment IDs', (batch.zoho_adjustment_ids || []).join(', ')])

  return workbook
}

module.exports = {
  parseUploadBuffer,
  uploadAndCreateBatch,
  validateBatchRows,
  postBatch,
  refreshBatchValuation,
  getBatchDetail,
  templateCsvContent,
  buildErrorExportWorkbook,
  buildResultExportWorkbook,
  summarizeRows,
  MAX_UPLOAD_ROWS,
}
