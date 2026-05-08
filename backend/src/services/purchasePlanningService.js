const { query, pool } = require('../db')
const { parseCsv, indexHeaders, cellOf } = require('../utils/csv')
const XLSX = require('xlsx')
const {
  normalizeSku,
  matchZohoSkuToVigil,
} = require('../utils/purchasePlanningSkuMatcher')
const { fetchItemsRawForWarehouse } = require('../integrations/zoho/zohoAdapter')
const { getSales } = require('../integrations/zoho/weeklyReportZohoTransactions')
const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')
const { fetchCompositeItemDetail, zohoApiRequest } = require('../integrations/zoho/zohoInventoryClient')
const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { getResolvedReportVendor } = require('./weeklyReportReportVendor')

const DEFAULT_PURCHASE_PLANNING_WAREHOUSE_NAME = 'LIFE SMILE'
const DEFAULT_PURCHASE_PLANNING_REPORT_GROUP = 'default'
const MAX_COMPOSITE_USAGE_LOOKUPS = 80

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function isoDateDaysAgo(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeWarehouseName(value) {
  return clean(value).replace(/\s+/g, ' ').toUpperCase()
}

async function resolvePurchasePlanningWarehouse() {
  const configuredId = clean(process.env.PURCHASE_PLANNING_WAREHOUSE_ID || process.env.LIFE_SMILE_WAREHOUSE_ID)
  const configuredName = normalizeWarehouseName(
    process.env.PURCHASE_PLANNING_WAREHOUSE_NAME || DEFAULT_PURCHASE_PLANNING_WAREHOUSE_NAME
  )
  if (configuredId) {
    return {
      warehouseId: configuredId,
      warehouseName: configuredName || DEFAULT_PURCHASE_PLANNING_WAREHOUSE_NAME,
    }
  }

  const warehouses = await fetchWarehouses()
  const match = warehouses.find((warehouse) => {
    const name = normalizeWarehouseName(warehouse.warehouse_name || warehouse.location_name || warehouse.name)
    return name === configuredName
  })
  if (!match) {
    const err = new Error(`Zoho warehouse "${configuredName || DEFAULT_PURCHASE_PLANNING_WAREHOUSE_NAME}" was not found`)
    err.code = 'PURCHASE_PLANNING_WAREHOUSE_NOT_FOUND'
    throw err
  }
  return {
    warehouseId: clean(match.warehouse_id || match.location_id || match.id),
    warehouseName: clean(match.warehouse_name || match.location_name || match.name),
  }
}

function resolveZohoStock(item) {
  for (const key of [
    'warehouse_available_for_sale_stock',
    'location_available_for_sale_stock',
    'available_for_sale_stock',
    'warehouse_available_stock',
    'location_available_stock',
    'available_stock',
    'warehouse_actual_available_stock',
    'location_actual_available_stock',
    'actual_available_stock',
    'stock_on_hand',
    'warehouse_stock_on_hand',
    'location_stock_on_hand',
    'quantity_available',
  ]) {
    const n = toNumber(item && item[key], NaN)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function mapLowStockRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    itemName: row.item_name,
    zohoItemId: row.zoho_item_id,
    currentZohoStock: Number(row.current_zoho_stock || 0),
    vigilCode: row.vigil_code || '',
    vigilStock: Number(row.vigil_stock || 0),
    vigilMatchType: row.vigil_match_type || 'not_found',
    totalSalesLast3Months: Number(row.total_sales_last_3_months || 0),
    totalBundleUsageLast3Months: Number(row.total_bundle_usage_last_3_months || 0),
    lowStockDetectedAt: row.low_stock_detected_at,
    status: row.status,
    updatedAt: row.updated_at,
  }
}

function mapUploadRow(row, includeParsedRows = false) {
  return {
    id: row.id,
    fileName: row.file_name,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    rowsCount: Number(row.rows_count || 0),
    parsedRows: includeParsedRows ? row.parsed_rows || [] : undefined,
  }
}

function mapPlanRow(row, items = undefined) {
  return {
    id: row.id,
    planNumber: row.plan_number,
    createdBy: row.created_by,
    createdAt: row.created_at,
    status: row.status,
    zohoPurchaseOrderId: row.zoho_purchase_order_id,
    zohoError: row.zoho_error,
    sourceUploadId: row.source_upload_id,
    items,
  }
}

function mapPlanItemRow(row) {
  return {
    id: row.id,
    purchasePlanId: row.purchase_plan_id,
    sku: row.sku,
    itemName: row.item_name,
    zohoItemId: row.zoho_item_id,
    currentZohoStock: Number(row.current_zoho_stock || 0),
    vigilCode: row.vigil_code || '',
    wholesaleAvailableQty: Number(row.wholesale_available_qty || 0),
    matchType: row.match_type,
    totalSalesLast3Months: Number(row.total_sales_last_3_months || 0),
    totalBundleUsageLast3Months: Number(row.total_bundle_usage_last_3_months || 0),
    totalUsageLast3Months: Number(row.total_usage_last_3_months || 0),
    averageMonthlyUsage: Number(row.average_monthly_usage || 0),
    suggestedQty: Number(row.suggested_qty || 0),
    finalQty: Number(row.final_qty || 0),
    included: Boolean(row.included),
    notes: row.notes || '',
  }
}

function calculatePlanQuantities({ totalSales = 0, totalBundle = 0, vigilAvailable = 0 }) {
  const requiredQty = Math.max(0, Math.ceil(toNumber(totalSales) + toNumber(totalBundle)))
  const available = Math.max(0, Math.floor(toNumber(vigilAvailable)))
  return {
    suggestedQty: requiredQty,
    finalQty: Math.min(requiredQty, available),
    remainingVigilQty: available - Math.min(requiredQty, available),
    wasAdjustedForVigil: requiredQty > available,
  }
}

async function ensurePurchasePlanningTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS purchase_low_stock_items (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(160) UNIQUE NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      zoho_item_id VARCHAR(100),
      current_zoho_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_sales_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_bundle_usage_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0,
      low_stock_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'planned', 'ordered', 'ignored')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    ALTER TABLE purchase_low_stock_items
    ADD COLUMN IF NOT EXISTS total_sales_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0
  `)
  await query(`
    ALTER TABLE purchase_low_stock_items
    ADD COLUMN IF NOT EXISTS total_bundle_usage_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_low_stock_status ON purchase_low_stock_items(status)`)

  await query(`
    CREATE TABLE IF NOT EXISTS vigil_stock_uploads (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rows_count INTEGER NOT NULL DEFAULT 0,
      parsed_rows JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_vigil_stock_uploads_uploaded_at ON vigil_stock_uploads(uploaded_at DESC)`)

  await query(`
    CREATE TABLE IF NOT EXISTS purchase_plans (
      id SERIAL PRIMARY KEY,
      plan_number VARCHAR(64) UNIQUE NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'reviewed', 'sent_to_zoho', 'failed')),
      source_upload_id INTEGER REFERENCES vigil_stock_uploads(id) ON DELETE SET NULL,
      zoho_purchase_order_id VARCHAR(100),
      zoho_error TEXT
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plans_created_at ON purchase_plans(created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plans_status ON purchase_plans(status)`)

  await query(`
    CREATE TABLE IF NOT EXISTS purchase_plan_items (
      id SERIAL PRIMARY KEY,
      purchase_plan_id INTEGER NOT NULL REFERENCES purchase_plans(id) ON DELETE CASCADE,
      sku VARCHAR(160) NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      zoho_item_id VARCHAR(100),
      current_zoho_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
      vigil_code VARCHAR(160),
      wholesale_available_qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
      match_type VARCHAR(20) NOT NULL DEFAULT 'not_found'
        CHECK (match_type IN ('exact', 'parent', 'not_found')),
      total_sales_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_bundle_usage_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_usage_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0,
      average_monthly_usage NUMERIC(12, 2) NOT NULL DEFAULT 0,
      suggested_qty INTEGER NOT NULL DEFAULT 0,
      final_qty INTEGER NOT NULL DEFAULT 0,
      included BOOLEAN NOT NULL DEFAULT true,
      notes TEXT NOT NULL DEFAULT ''
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_plan_id ON purchase_plan_items(purchase_plan_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_sku ON purchase_plan_items(sku)`)
}

function buildZohoItemIndex(items) {
  const bySku = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const primaryCode = clean(item.sku || item.item_code || item.code)
    const entry = {
      sku: primaryCode,
      itemName: clean(item.name || item.item_name),
      zohoItemId: clean(item.item_id || item.id),
      currentZohoStock: resolveZohoStock(item),
    }
    const identifiers = [
      primaryCode,
      item.item_code,
      item.code,
      item.name,
      item.item_name,
      item.part_number,
    ]
    for (const rawIdentifier of identifiers) {
      const key = normalizeSku(rawIdentifier)
      if (!key || bySku.has(key)) continue
      bySku.set(key, entry)
    }
  }
  return bySku
}

async function enrichUploadedLowStockSkus(skus) {
  const warehouse = await resolvePurchasePlanningWarehouse()
  const items = await fetchItemsRawForWarehouse(warehouse.warehouseId)
  const bySku = buildZohoItemIndex(items)
  return skus.map((rawSku) => {
    const uploadedSku = clean(rawSku)
    const match = bySku.get(normalizeSku(uploadedSku))
    if (!match) {
      return {
        sku: uploadedSku,
        itemName: '',
        zohoItemId: '',
        currentZohoStock: 0,
        matchedInZoho: false,
      }
    }
    return {
      ...match,
      sku: uploadedSku,
      matchedInZoho: true,
    }
  })
}

async function saveUploadedLowStockSkus(skus) {
  const uniqueSkus = []
  const seen = new Set()
  for (const raw of Array.isArray(skus) ? skus : []) {
    const sku = clean(raw)
    const key = normalizeSku(sku)
    if (!sku || seen.has(key)) continue
    seen.add(key)
    uniqueSkus.push(sku)
  }
  if (uniqueSkus.length === 0) {
    return { uploaded: 0, matched: 0, unmatched: 0 }
  }

  const enriched = await enrichUploadedLowStockSkus(uniqueSkus)
  const { salesAggregate, bundleUsageAggregate } = await fetchLast3MonthsSalesAggregate()
  for (const item of enriched) {
    item.totalSalesLast3Months = item.matchedInZoho
      ? salesQtyForItem(salesAggregate, { sku: item.sku, zoho_item_id: item.zohoItemId })
      : 0
    item.totalBundleUsageLast3Months = item.matchedInZoho
      ? bundleUsageQtyForItem(bundleUsageAggregate, { sku: item.sku, zoho_item_id: item.zohoItemId })
      : 0
  }
  const uploadedKeys = enriched.map((item) => normalizeSku(item.sku))

  await query(`
    UPDATE purchase_low_stock_items
    SET status = 'ignored', updated_at = NOW()
    WHERE status IN ('pending', 'planned')
  `)

  let upserted = 0
  for (const item of enriched) {
    const result = await query(
      `
        INSERT INTO purchase_low_stock_items
          (sku, item_name, zoho_item_id, current_zoho_stock, total_sales_last_3_months, total_bundle_usage_last_3_months, low_stock_detected_at, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'pending', NOW())
        ON CONFLICT (sku) DO UPDATE SET
          item_name = EXCLUDED.item_name,
          zoho_item_id = EXCLUDED.zoho_item_id,
          current_zoho_stock = EXCLUDED.current_zoho_stock,
          total_sales_last_3_months = EXCLUDED.total_sales_last_3_months,
          total_bundle_usage_last_3_months = EXCLUDED.total_bundle_usage_last_3_months,
          low_stock_detected_at = NOW(),
          status = 'pending',
          updated_at = NOW()
        RETURNING id
      `,
      [
        item.sku,
        item.itemName,
        item.zohoItemId,
        item.currentZohoStock,
        item.totalSalesLast3Months || 0,
        item.totalBundleUsageLast3Months || 0,
      ]
    )
    upserted += result.rowCount
  }
  return {
    uploaded: upserted,
    matched: enriched.filter((item) => item.matchedInZoho).length,
    unmatched: enriched.filter((item) => !item.matchedInZoho).length,
    uploadedKeys,
  }
}

async function refreshLowStockZohoEnrichment() {
  const current = await query(`
    SELECT id, sku
    FROM purchase_low_stock_items
    WHERE status = 'pending'
    ORDER BY sku ASC
  `)
  if (current.rows.length === 0) {
    const err = new Error('Upload low-stock SKUs before refreshing Zoho enrichment')
    err.code = 'NO_LOW_STOCK_ITEMS'
    throw err
  }

  const enriched = await enrichUploadedLowStockSkus(current.rows.map((row) => row.sku))
  const { salesAggregate, bundleUsageAggregate } = await fetchLast3MonthsSalesAggregate()
  let matched = 0
  let unmatched = 0
  for (let i = 0; i < current.rows.length; i += 1) {
    const row = current.rows[i]
    const item = enriched[i]
    if (item && item.matchedInZoho) matched += 1
    else unmatched += 1
    const totalSalesLast3Months = item && item.matchedInZoho
      ? salesQtyForItem(salesAggregate, { sku: item.sku, zoho_item_id: item.zohoItemId })
      : 0
    const totalBundleUsageLast3Months = item && item.matchedInZoho
      ? bundleUsageQtyForItem(bundleUsageAggregate, { sku: item.sku, zoho_item_id: item.zohoItemId })
      : 0
    await query(
      `
        UPDATE purchase_low_stock_items
        SET
          item_name = $2,
          zoho_item_id = $3,
          current_zoho_stock = $4,
          total_sales_last_3_months = $5,
          total_bundle_usage_last_3_months = $6,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        row.id,
        item && item.matchedInZoho ? item.itemName : '',
        item && item.matchedInZoho ? item.zohoItemId : '',
        item && item.matchedInZoho ? item.currentZohoStock : 0,
        totalSalesLast3Months,
        totalBundleUsageLast3Months,
      ]
    )
  }

  return {
    refreshed: current.rows.length,
    matched,
    unmatched,
  }
}

async function listLowStock() {
  const result = await query(`
    SELECT *
    FROM purchase_low_stock_items
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'planned' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      current_zoho_stock ASC,
      sku ASC
  `)
  const rows = result.rows.map(mapLowStockRow)
  const upload = await getLatestVigilUpload()
  return applyVigilMatchesToLowStockRows(rows, Array.isArray(upload && upload.parsed_rows) ? upload.parsed_rows : [])
}

function applyVigilMatchesToLowStockRows(rows, vigilRows) {
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const match = matchZohoSkuToVigil(item.sku, vigilRows)
    return {
      ...item,
      vigilCode: match.matchedVigilCode || '',
      vigilStock: match.matched ? match.wholesaleAvailableQty : 0,
      vigilMatchType: match.matchType,
    }
  })
}

function findHeader(headerIdx, candidates) {
  for (const name of candidates) {
    if (headerIdx.has(name)) return name
  }
  return ''
}

function parseTabularExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = workbook.SheetNames && workbook.SheetNames[0]
  if (!sheetName) {
    const err = new Error('Excel workbook does not contain any sheets')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const worksheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  if (!rows.length) {
    const err = new Error('Excel sheet is empty')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const headers = rows[0].map((cell) => clean(cell))
  if (!headers.length || headers.every((header) => !header)) {
    const err = new Error('Excel header row is empty')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const bodyRows = rows.slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => clean(cell) !== ''))
    .map((row) => {
      const out = row.map((cell) => clean(cell))
      while (out.length < headers.length) out.push('')
      out.length = headers.length
      return out
    })
  return { headers, rows: bodyRows }
}

function parseTabularUpload(buffer, fileName = '') {
  if (isExcelFile(fileName)) return parseTabularExcel(buffer)
  const parsed = parseCsv(buffer.toString('utf8'))
  return { headers: parsed.headers, rows: parsed.rows }
}

function parseVigilRows(headers, rawRows) {
  const headerIdx = indexHeaders(headers)
  const itemCodeHeader = findHeader(headerIdx, [
    'item code',
    'item_code',
    'itemcode',
    'code',
    'sku',
    'item',
  ])
  const stockHeader = findHeader(headerIdx, [
    'available stock',
    'available_stock',
    'available qty',
    'available_qty',
    'stock',
    'qty',
    'quantity',
  ])

  const rows = rawRows.map((raw, index) => {
    const itemCode = itemCodeHeader ? cellOf(raw, headerIdx, itemCodeHeader) : ''
    const rawStock = stockHeader ? cellOf(raw, headerIdx, stockHeader) : ''
    const availableStock = toNumber(rawStock, NaN)
    const errors = []
    if (!itemCode) errors.push('Missing item code')
    if (!Number.isFinite(availableStock)) errors.push('Invalid available stock')
    return {
      rowNumber: index + 2,
      itemCode: clean(itemCode),
      normalizedItemCode: normalizeSku(itemCode),
      availableStock: Number.isFinite(availableStock) ? availableStock : 0,
      errors,
      valid: errors.length === 0,
    }
  })

  return {
    headers,
    rows,
    summary: {
      rows: rows.length,
      validRows: rows.filter((row) => row.valid).length,
      invalidRows: rows.filter((row) => !row.valid).length,
      itemCodeHeader,
      stockHeader,
    },
  }
}

function parseVigilCsv(text) {
  const parsed = parseCsv(text)
  return parseVigilRows(parsed.headers, parsed.rows)
}

function parseVigilExcel(buffer) {
  const parsed = parseTabularExcel(buffer)
  return parseVigilRows(parsed.headers, parsed.rows)
}

function isExcelFile(fileName) {
  return /\.(xlsx|xls)$/i.test(clean(fileName))
}

async function previewVigilUpload(buffer, fileName = '') {
  if (isExcelFile(fileName)) return parseVigilExcel(buffer)
  return parseVigilCsv(buffer.toString('utf8'))
}

function parseLowStockRows(headers, rawRows) {
  const headerIdx = indexHeaders(headers)
  const skuHeader = findHeader(headerIdx, [
    'sku',
    'item code',
    'item_code',
    'itemcode',
    'code',
  ])
  const sourceRows = skuHeader
    ? rawRows.map((row, index) => ({ row, rowNumber: index + 2 }))
    : [[headers[0] || '', ...headers.slice(1)], ...rawRows].map((row, index) => ({ row, rowNumber: index + 1 }))

  const rows = sourceRows.map(({ row, rowNumber }) => {
    const sku = skuHeader ? cellOf(row, headerIdx, skuHeader) : clean(row[0])
    const errors = []
    if (!sku) errors.push('Missing SKU')
    return {
      rowNumber,
      sku: clean(sku),
      normalizedSku: normalizeSku(sku),
      errors,
      valid: errors.length === 0,
    }
  })

  return {
    headers,
    rows,
    summary: {
      rows: rows.length,
      validRows: rows.filter((row) => row.valid).length,
      invalidRows: rows.filter((row) => !row.valid).length,
      skuHeader: skuHeader || 'first column',
    },
  }
}

function previewLowStockUpload(buffer, fileName = '') {
  const parsed = parseTabularUpload(buffer, fileName)
  return parseLowStockRows(parsed.headers, parsed.rows)
}

async function saveLowStockUpload({ rows }) {
  const validRows = rows.filter((row) => row.valid)
  const summary = await saveUploadedLowStockSkus(validRows.map((row) => row.sku))
  return summary
}

async function saveVigilUpload({ fileName, uploadedBy, rows }) {
  const validRows = rows.filter((row) => row.valid)
  const result = await query(
    `
      INSERT INTO vigil_stock_uploads (file_name, uploaded_by, rows_count, parsed_rows)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *
    `,
    [fileName, uploadedBy || null, validRows.length, JSON.stringify(validRows)]
  )
  return mapUploadRow(result.rows[0], true)
}

async function listVigilUploads() {
  const result = await query(`
    SELECT id, file_name, uploaded_by, uploaded_at, rows_count
    FROM vigil_stock_uploads
    ORDER BY uploaded_at DESC
    LIMIT 50
  `)
  return result.rows.map((row) => mapUploadRow(row, false))
}

async function getLatestVigilUpload() {
  const result = await query(`
    SELECT *
    FROM vigil_stock_uploads
    ORDER BY uploaded_at DESC
    LIMIT 1
  `)
  return result.rows[0] || null
}

function aggregateSalesLines(lines) {
  const byItemId = new Map()
  const bySku = new Map()
  for (const line of Array.isArray(lines) ? lines : []) {
    const qty = toNumber(line.quantity, 0)
    const itemId = clean(line.item_id)
    const sku = normalizeSku(line.sku)
    if (itemId) byItemId.set(itemId, (byItemId.get(itemId) || 0) + qty)
    if (sku) bySku.set(sku, (bySku.get(sku) || 0) + qty)
  }
  return { byItemId, bySku }
}

function salesQtyForItem(aggregate, item) {
  const itemId = clean(item.zoho_item_id)
  const sku = normalizeSku(item.sku)
  if (itemId && aggregate.byItemId.has(itemId)) return aggregate.byItemId.get(itemId)
  return aggregate.bySku.get(sku) || 0
}

function addUsage(usage, { itemId, sku, qty }) {
  const n = toNumber(qty, 0)
  if (!n) return
  const id = clean(itemId)
  const normalizedSku = normalizeSku(sku)
  if (id) usage.byItemId.set(id, (usage.byItemId.get(id) || 0) + n)
  if (normalizedSku) usage.bySku.set(normalizedSku, (usage.bySku.get(normalizedSku) || 0) + n)
}

function bundleUsageQtyForItem(usage, item) {
  const itemId = clean(item.zoho_item_id)
  const sku = normalizeSku(item.sku)
  if (itemId && usage.byItemId.has(itemId)) return usage.byItemId.get(itemId)
  return usage.bySku.get(sku) || 0
}

function lineLooksLikeComposite(line) {
  const text = normalizeSku(`${line && line.sku ? line.sku : ''} ${line && (line.name || line.item_name) ? (line.name || line.item_name) : ''}`)
  return /\b(MIX|SET|KIT|COMBO|BUNDLE)\b/.test(text) || /(?:^|-)MIX(?:-|$)/.test(text) || /(?:^|-)SET(?:-|$)/.test(text)
}

async function getCompositeMappedItems(compositeItemId) {
  const detail = await fetchCompositeItemDetail(compositeItemId, {
    source: 'purchase_planning_composite_usage_detail',
  })
  const entity = detail && detail.composite_item ? detail.composite_item : detail
  return Array.isArray(entity && entity.mapped_items) ? entity.mapped_items : []
}

async function buildCompositeUsageAggregate(lines, fetchMappedItems = getCompositeMappedItems) {
  const usage = { byItemId: new Map(), bySku: new Map() }
  const compositeSales = []
  for (const line of Array.isArray(lines) ? lines : []) {
    const qtySold = toNumber(line.quantity, 0)
    const itemId = clean(line.item_id)
    if (qtySold > 0 && itemId && lineLooksLikeComposite(line)) compositeSales.push({ itemId, qtySold })
  }

  const uniqueCompositeIds = [...new Set(compositeSales.map((sale) => sale.itemId))]
    .slice(0, MAX_COMPOSITE_USAGE_LOOKUPS)
  const mappedByCompositeId = new Map()
  for (const itemId of uniqueCompositeIds) {
    try {
      mappedByCompositeId.set(itemId, await fetchMappedItems(itemId))
    } catch (err) {
      mappedByCompositeId.set(itemId, [])
    }
  }

  for (const sale of compositeSales) {
    const mappedItems = mappedByCompositeId.get(sale.itemId) || []
    for (const component of mappedItems) {
      const componentQty = toNumber(component.quantity, 0)
      if (componentQty <= 0) continue
      addUsage(usage, {
        itemId: component.item_id,
        sku: component.sku || component.item_code || component.name,
        qty: sale.qtySold * componentQty,
      })
    }
  }
  return usage
}

async function fetchLast3MonthsSalesAggregate() {
  const fromDate = isoDateDaysAgo(92)
  const toDate = todayIso()
  const sales = await getSales(fromDate, toDate)
  return {
    salesAggregate: aggregateSalesLines(sales.lines),
    bundleUsageAggregate: await buildCompositeUsageAggregate(sales.lines),
  }
}

async function getBundleUsageBySku() {
  return new Map()
}
function nextPlanNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PP-${stamp}-${suffix}`
}

async function generatePlan({ createdBy }) {
  const upload = await getLatestVigilUpload()
  if (!upload) {
    const err = new Error('Upload a Vigil stock file before generating a purchase plan')
    err.code = 'NO_VIGIL_UPLOAD'
    throw err
  }

  const lowStock = (await listLowStock()).filter((item) => item.status === 'pending')
  if (lowStock.length === 0) {
    const err = new Error('Upload low-stock SKUs before generating a purchase plan')
    err.code = 'NO_LOW_STOCK_ITEMS'
    throw err
  }
  const vigilRows = Array.isArray(upload.parsed_rows) ? upload.parsed_rows : []
  const fromDate = isoDateDaysAgo(92)
  const toDate = todayIso()
  const warnings = []
  const sales = await getSales(fromDate, toDate, {
    onWarning: (message) => warnings.push(message),
  })
  const salesAggregate = aggregateSalesLines(sales.lines)
  const bundleUsageAggregate = await buildCompositeUsageAggregate(sales.lines)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const planResult = await client.query(
      `
        INSERT INTO purchase_plans (plan_number, created_by, status, source_upload_id)
        VALUES ($1, $2, 'draft', $3)
        RETURNING *
      `,
      [nextPlanNumber(), createdBy || null, upload.id]
    )
    const plan = planResult.rows[0]

    const insertedItems = []
    for (const item of lowStock) {
      const match = matchZohoSkuToVigil(item.sku, vigilRows)
      const totalSales = salesQtyForItem(salesAggregate, {
        sku: item.sku,
        zoho_item_id: item.zohoItemId,
      })
      const totalBundle = bundleUsageQtyForItem(bundleUsageAggregate, {
        sku: item.sku,
        zoho_item_id: item.zohoItemId,
      })
      const totalUsage = totalSales + totalBundle
      const averageMonthlyUsage = totalUsage / 3
      const available = match.matched ? Math.max(0, Math.floor(match.wholesaleAvailableQty)) : 0
      const { suggestedQty, finalQty, wasAdjustedForVigil } = calculatePlanQuantities({
        totalSales,
        totalBundle,
        vigilAvailable: available,
      })
      const included = finalQty > 0 && available > 0 && match.matched
      const notes = !match.matched
        ? 'No matching Vigil stock row'
        : available <= 0
          ? 'Unavailable in wholesale stock'
          : wasAdjustedForVigil
            ? 'Vigil stock below required usage; final qty auto-adjusted'
          : ''

      const itemResult = await client.query(
        `
          INSERT INTO purchase_plan_items (
            purchase_plan_id, sku, item_name, zoho_item_id, current_zoho_stock,
            vigil_code, wholesale_available_qty, match_type,
            total_sales_last_3_months, total_bundle_usage_last_3_months,
            total_usage_last_3_months, average_monthly_usage,
            suggested_qty, final_qty, included, notes
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10,
            $11, $12,
            $13, $14, $15, $16
          )
          RETURNING *
        `,
        [
          plan.id,
          item.sku,
          item.itemName,
          item.zohoItemId,
          item.currentZohoStock,
          match.matchedVigilCode || '',
          available,
          match.matchType,
          totalSales,
          totalBundle,
          totalUsage,
          averageMonthlyUsage,
          suggestedQty,
          finalQty,
          included,
          notes,
        ]
      )
      insertedItems.push(mapPlanItemRow(itemResult.rows[0]))

      await client.query(
        `UPDATE purchase_low_stock_items SET status = 'planned', updated_at = NOW() WHERE sku = $1 AND status = 'pending'`,
        [item.sku]
      )
    }

    await client.query('COMMIT')
    return { ...mapPlanRow(plan, insertedItems), warnings }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listPlans() {
  const result = await query(`
    SELECT p.*,
      COUNT(i.id)::int AS items_count,
      COALESCE(SUM(CASE WHEN i.included THEN i.final_qty ELSE 0 END), 0)::int AS total_final_qty
    FROM purchase_plans p
    LEFT JOIN purchase_plan_items i ON i.purchase_plan_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 50
  `)
  return result.rows.map((row) => ({
    ...mapPlanRow(row),
    itemsCount: Number(row.items_count || 0),
    totalFinalQty: Number(row.total_final_qty || 0),
  }))
}

async function getPlan(id) {
  const planResult = await query(`SELECT * FROM purchase_plans WHERE id = $1`, [id])
  const plan = planResult.rows[0]
  if (!plan) return null
  const itemsResult = await query(`
    SELECT *
    FROM purchase_plan_items
    WHERE purchase_plan_id = $1
    ORDER BY included DESC, suggested_qty DESC, sku ASC
  `, [id])
  return mapPlanRow(plan, itemsResult.rows.map(mapPlanItemRow))
}

async function updatePlanItem(planId, itemId, patch) {
  const finalQty = patch.finalQty == null ? null : Math.max(0, Math.floor(toNumber(patch.finalQty, 0)))
  const included = patch.included == null ? null : Boolean(patch.included)
  const notes = patch.notes == null ? null : clean(patch.notes)
  const result = await query(
    `
      UPDATE purchase_plan_items
      SET
        final_qty = COALESCE($3, final_qty),
        included = COALESCE($4, included),
        notes = COALESCE($5, notes)
      WHERE purchase_plan_id = $1 AND id = $2
      RETURNING *
    `,
    [planId, itemId, finalQty, included, notes]
  )
  return result.rows[0] ? mapPlanItemRow(result.rows[0]) : null
}

function buildZohoJsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

function resolvePurchaseOrderVendor() {
  const explicitVendorId = clean(process.env.ZOHO_PURCHASE_VENDOR_ID)
  if (explicitVendorId) return { vendorId: explicitVendorId, source: 'ZOHO_PURCHASE_VENDOR_ID' }

  const reportGroup = clean(process.env.PURCHASE_PLANNING_REPORT_GROUP || DEFAULT_PURCHASE_PLANNING_REPORT_GROUP)
  const vendor = getResolvedReportVendor(reportGroup)
  if (vendor.vendorId) return { vendorId: vendor.vendorId, source: vendor.source }

  const err = new Error('Configure a Zoho vendor id before creating purchase orders')
  err.code = 'ZOHO_VENDOR_NOT_CONFIGURED'
  throw err
}

async function createZohoPurchaseOrder(planId) {
  const plan = await getPlan(planId)
  if (!plan) {
    const err = new Error('Purchase plan not found')
    err.code = 'PLAN_NOT_FOUND'
    throw err
  }
  if (plan.zohoPurchaseOrderId || plan.status === 'sent_to_zoho') {
    const err = new Error('This purchase plan was already sent to Zoho')
    err.code = 'DUPLICATE_PO'
    throw err
  }

  const config = readZohoConfig()
  if (config.code !== 'ok') {
    const err = new Error('Zoho is not configured')
    err.code = config.code || 'ZOHO_NOT_CONFIGURED'
    throw err
  }

  const vendor = resolvePurchaseOrderVendor()

  const selected = (plan.items || []).filter((item) =>
    item.included &&
    item.finalQty > 0 &&
    clean(item.zohoItemId)
  )
  if (selected.length === 0) {
    const err = new Error('No included rows with finalQty > 0 and Zoho item id were found')
    err.code = 'NO_PO_LINES'
    throw err
  }

  const payload = {
    vendor_id: vendor.vendorId,
    date: todayIso(),
    reference_number: plan.planNumber,
    notes: `Generated from HR & BI Purchase Planning plan ${plan.planNumber}. Review completed by admin before sending.`,
    line_items: selected.map((item) => ({
      item_id: item.zohoItemId,
      quantity: item.finalQty,
    })),
  }

  try {
    const json = await zohoApiRequest(
      `${INVENTORY_V1}/purchaseorders`,
      new URLSearchParams(),
      'POST',
      buildZohoJsonStringBody(payload),
      { source: 'purchase_planning_create_po', skipCache: true }
    )
    const po = (json && json.purchaseorder) || (json && json.purchase_order) || json || {}
    const zohoPurchaseOrderId = clean(po.purchaseorder_id || po.purchase_order_id || po.purchaseorderId || po.id)
    await query(
      `
        UPDATE purchase_plans
        SET status = 'sent_to_zoho', zoho_purchase_order_id = $2, zoho_error = NULL
        WHERE id = $1
      `,
      [plan.id, zohoPurchaseOrderId || null]
    )
    await query(
      `
        UPDATE purchase_low_stock_items
        SET status = 'ordered', updated_at = NOW()
        WHERE sku = ANY($1::text[])
      `,
      [selected.map((item) => item.sku)]
    )
    return {
      success: true,
      zohoPurchaseOrderId,
      purchaseOrder: po,
      sentLines: selected.length,
      skippedLines: (plan.items || []).length - selected.length,
    }
  } catch (err) {
    await query(
      `UPDATE purchase_plans SET status = 'failed', zoho_error = $2 WHERE id = $1`,
      [plan.id, err.message || String(err)]
    )
    throw err
  }
}

module.exports = {
  ensurePurchasePlanningTables,
  enrichUploadedLowStockSkus,
  saveUploadedLowStockSkus,
  refreshLowStockZohoEnrichment,
  listLowStock,
  previewLowStockUpload,
  saveLowStockUpload,
  previewVigilUpload,
  parseVigilExcel,
  saveVigilUpload,
  listVigilUploads,
  generatePlan,
  listPlans,
  getPlan,
  updatePlanItem,
  createZohoPurchaseOrder,
  _internals: {
    buildZohoItemIndex,
    buildCompositeUsageAggregate,
    bundleUsageQtyForItem,
    calculatePlanQuantities,
    resolvePurchaseOrderVendor,
    resolveZohoStock,
    resolvePurchasePlanningWarehouse,
    applyVigilMatchesToLowStockRows,
  },
}
