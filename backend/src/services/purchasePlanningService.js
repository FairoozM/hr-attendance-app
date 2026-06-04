const { query, pool } = require('../db')
const { parseCsv, indexHeaders, cellOf } = require('../utils/csv')
const {
  previewVigilUpload,
  parseVigilExcel,
  parseTabularExcel,
  isExcelFile,
} = require('./vigilStockParseService')
const {
  normalizeSku,
  expandExactMatchVariants,
  buildVigilIndexes,
  matchZohoSkuToVigil,
  matchZohoSkuToVigilWithIndexes,
} = require('../utils/purchasePlanningSkuMatcher')
const { _internals: zohoWeeklyInternals } = require('./weeklyReportZohoData')
const parseWarehouseScopedStockOnHand = zohoWeeklyInternals.parseWarehouseScopedStockOnHand
const { fetchItemsRawForWarehouse } = require('../integrations/zoho/zohoAdapter')
const { getSales } = require('../integrations/zoho/weeklyReportZohoTransactions')
const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')
const { fetchCompositeItemDetail, zohoApiRequest } = require('../integrations/zoho/zohoInventoryClient')
const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { getResolvedReportVendor } = require('./weeklyReportReportVendor')

const DEFAULT_PURCHASE_PLANNING_WAREHOUSE_NAME = 'LIFE SMILE'
const DEFAULT_PURCHASE_PLANNING_REPORT_GROUP = 'default'
const MAX_COMPOSITE_USAGE_LOOKUPS = 80

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    purchasePrice: row.purchase_price == null ? null : Number(row.purchase_price),
    included: Boolean(row.included),
    notes: row.notes || '',
  }
}

/** Use Zoho sales/bundle totals already stored on pending low-stock rows during enrichment. */
function planUsageFromEnrichedPendingItem(item) {
  return {
    totalSales: Number(item?.totalSalesLast3Months || 0),
    totalBundle: Number(item?.totalBundleUsageLast3Months || 0),
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
      purchase_price NUMERIC(14, 4),
      included BOOLEAN NOT NULL DEFAULT true,
      notes TEXT NOT NULL DEFAULT ''
    )
  `)
  await query(`
    ALTER TABLE purchase_plan_items
    ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14, 4)
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_plan_id ON purchase_plan_items(purchase_plan_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_sku ON purchase_plan_items(sku)`)
}

function buildZohoItemIndex(items, warehouseId = '') {
  const bySku = new Map()
  const addKey = (raw, entry) => {
    const key = normalizeSku(raw)
    if (!key || bySku.has(key)) return
    bySku.set(key, entry)
  }
  for (const item of Array.isArray(items) ? items : []) {
    const primaryCode = clean(item.sku || item.item_code || item.code)
    const itemName = clean(item.name || item.item_name)
    const onHand = parseWarehouseScopedStockOnHand(item, warehouseId)
    const forSale = resolveZohoStock(item)
    const entry = {
      sku: primaryCode,
      itemName,
      zohoItemId: clean(item.item_id || item.id),
      currentZohoStock: Number.isFinite(forSale) && forSale > onHand ? forSale : onHand,
    }
    const identifiers = [
      primaryCode,
      item.item_code,
      item.code,
      itemName,
      item.part_number,
    ]
    for (const rawIdentifier of identifiers) addKey(rawIdentifier, entry)
    for (const variant of expandExactMatchVariants(primaryCode)) addKey(variant, entry)
    for (const variant of expandExactMatchVariants(itemName)) addKey(variant, entry)
  }
  return bySku
}

async function enrichUploadedLowStockSkus(skus) {
  const warehouse = await resolvePurchasePlanningWarehouse()
  const items = await fetchItemsRawForWarehouse(warehouse.warehouseId)
  const bySku = buildZohoItemIndex(items, warehouse.warehouseId)
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

async function persistLowStockItems(items) {
  const rows = Array.isArray(items) ? items : []
  if (rows.length === 0) {
    return { uploaded: 0, items: [], uploadedKeys: [] }
  }

  await query(`
    UPDATE purchase_low_stock_items
    SET status = 'ignored', updated_at = NOW()
    WHERE status IN ('pending', 'planned')
  `)

  const savedRows = []
  let upserted = 0
  for (const item of rows) {
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
        RETURNING *
      `,
      [
        item.sku,
        item.itemName || '',
        item.zohoItemId || '',
        item.currentZohoStock || 0,
        item.totalSalesLast3Months || 0,
        item.totalBundleUsageLast3Months || 0,
      ]
    )
    upserted += result.rowCount
    if (result.rows[0]) savedRows.push(mapLowStockRow(result.rows[0]))
  }
  const upload = await getLatestVigilUpload()
  const persisted = applyVigilMatchesToLowStockRows(savedRows, coerceVigilRowsFromUpload(upload))
  return {
    uploaded: upserted,
    items: persisted,
    uploadedKeys: persisted.map((row) => normalizeSku(row.sku)),
  }
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
    return { uploaded: 0, matched: 0, unmatched: 0, items: [], enrichmentPending: false }
  }

  const minimalItems = uniqueSkus.map((sku) => ({
    sku,
    itemName: '',
    zohoItemId: '',
    currentZohoStock: 0,
    totalSalesLast3Months: 0,
    totalBundleUsageLast3Months: 0,
  }))
  const persisted = await persistLowStockItems(minimalItems)
  return {
    uploaded: persisted.uploaded,
    matched: 0,
    unmatched: uniqueSkus.length,
    uploadedKeys: persisted.uploadedKeys,
    items: persisted.items,
    enrichmentPending: true,
  }
}

const ENRICHMENT_STALE_MS = 20 * 60 * 1000
const emptySalesAggregate = () => ({ byItemId: new Map(), bySku: new Map() })

const lowStockEnrichmentJob = {
  running: false,
  queuedAgain: false,
  startedAt: null,
  lastError: null,
  lastCompletedAt: null,
  lastSummary: null,
}

function maybeResetStaleEnrichmentJob() {
  if (!lowStockEnrichmentJob.running || !lowStockEnrichmentJob.startedAt) return
  if (Date.now() - lowStockEnrichmentJob.startedAt > ENRICHMENT_STALE_MS) {
    lowStockEnrichmentJob.running = false
    lowStockEnrichmentJob.queuedAgain = false
    if (!lowStockEnrichmentJob.lastError) {
      lowStockEnrichmentJob.lastError =
        'Enrichment timed out on the server (likely Zoho sales report). Click Refresh Zoho Data to retry.'
    }
  }
}

function getLowStockEnrichmentStatus() {
  maybeResetStaleEnrichmentJob()
  return {
    running: lowStockEnrichmentJob.running,
    queuedAgain: lowStockEnrichmentJob.queuedAgain,
    lastError: lowStockEnrichmentJob.lastError,
    lastCompletedAt: lowStockEnrichmentJob.lastCompletedAt,
    lastSummary: lowStockEnrichmentJob.lastSummary
      ? {
          refreshed: lowStockEnrichmentJob.lastSummary.refreshed,
          matched: lowStockEnrichmentJob.lastSummary.matched,
          unmatched: lowStockEnrichmentJob.lastSummary.unmatched,
        }
      : null,
  }
}

async function runLowStockEnrichmentJobOnce() {
  lowStockEnrichmentJob.running = true
  lowStockEnrichmentJob.startedAt = Date.now()
  lowStockEnrichmentJob.lastError = null
  try {
    const summary = await refreshLowStockZohoEnrichment()
    lowStockEnrichmentJob.lastSummary = summary
    lowStockEnrichmentJob.lastCompletedAt = new Date().toISOString()
  } catch (err) {
    lowStockEnrichmentJob.lastError = (err && err.message) || String(err)
    console.error('[purchase-planning] background Zoho enrichment failed:', err)
  } finally {
    lowStockEnrichmentJob.running = false
    lowStockEnrichmentJob.startedAt = null
    if (lowStockEnrichmentJob.queuedAgain) {
      lowStockEnrichmentJob.queuedAgain = false
      await runLowStockEnrichmentJobOnce()
    }
  }
}

function queueLowStockZohoEnrichment() {
  if (lowStockEnrichmentJob.running) {
    lowStockEnrichmentJob.queuedAgain = true
    return
  }
  runLowStockEnrichmentJobOnce().catch((err) => {
    lowStockEnrichmentJob.running = false
    lowStockEnrichmentJob.lastError = (err && err.message) || String(err)
    console.error('[purchase-planning] background Zoho enrichment failed:', err)
  })
}

async function fetchEnrichmentSalesAggregate() {
  const fromDate = isoDateDaysAgo(92)
  const toDate = todayIso()
  const sales = await getSales(fromDate, toDate)
  return aggregateSalesLines(sales.lines)
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
  let matched = 0
  let unmatched = 0

  // Phase 1: persist Zoho item match + stock immediately (do not wait for sales report).
  for (let i = 0; i < current.rows.length; i += 1) {
    const row = current.rows[i]
    const item = enriched[i]
    if (item && item.matchedInZoho) matched += 1
    else unmatched += 1
    await query(
      `
        UPDATE purchase_low_stock_items
        SET
          item_name = $2,
          zoho_item_id = $3,
          current_zoho_stock = $4,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        row.id,
        item && item.matchedInZoho ? item.itemName : '',
        item && item.matchedInZoho ? item.zohoItemId : '',
        item && item.matchedInZoho ? item.currentZohoStock : 0,
      ]
    )
  }

  // Phase 2: direct sales only (skip composite detail lookups — they hung enrichment for 25+ SKUs).
  let salesAggregate = emptySalesAggregate()
  try {
    salesAggregate = await fetchEnrichmentSalesAggregate()
  } catch (err) {
    console.error('[purchase-planning] enrichment sales fetch failed (Zoho matches saved):', err)
  }

  for (let i = 0; i < current.rows.length; i += 1) {
    const row = current.rows[i]
    const item = enriched[i]
    if (!item || !item.matchedInZoho) continue
    const totalSalesLast3Months = salesQtyForItem(salesAggregate, {
      sku: item.sku,
      zoho_item_id: item.zohoItemId,
    })
    await query(
      `
        UPDATE purchase_low_stock_items
        SET
          total_sales_last_3_months = $2,
          total_bundle_usage_last_3_months = 0,
          updated_at = NOW()
        WHERE id = $1
      `,
      [row.id, totalSalesLast3Months]
    )
  }

  const items = await listLowStock()
  matched = items.filter((item) => String(item.zohoItemId || '').trim()).length
  unmatched = items.length - matched
  return {
    refreshed: current.rows.length,
    matched,
    unmatched,
    items,
  }
}

async function listLowStock() {
  const result = await query(`
    SELECT *
    FROM purchase_low_stock_items
    WHERE status = 'pending'
    ORDER BY current_zoho_stock ASC, sku ASC
  `)
  const rows = result.rows.map(mapLowStockRow)
  const upload = await getLatestVigilUpload()
  return applyVigilMatchesToLowStockRows(rows, coerceVigilRowsFromUpload(upload))
}

async function removePendingLowStockItem(id) {
  const itemId = Number(id)
  if (!Number.isInteger(itemId) || itemId <= 0) {
    const err = new Error('Invalid low-stock item id')
    err.code = 'INVALID_LOW_STOCK_ITEM_ID'
    throw err
  }

  const updated = await query(
    `
      UPDATE purchase_low_stock_items
      SET status = 'ignored', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *
    `,
    [itemId]
  )
  if (updated.rows[0]) {
    const items = await listLowStock()
    return { removed: mapLowStockRow(updated.rows[0]), items }
  }

  const existing = await query(`SELECT id, status FROM purchase_low_stock_items WHERE id = $1`, [itemId])
  if (!existing.rows[0]) {
    const err = new Error('Low-stock item not found')
    err.code = 'LOW_STOCK_ITEM_NOT_FOUND'
    throw err
  }
  const err = new Error('Only pending low-stock SKUs can be removed from the current batch')
  err.code = 'LOW_STOCK_ITEM_NOT_REMOVABLE'
  throw err
}

function applyVigilMatchesToLowStockRows(rows, vigilRows) {
  const vigilIndexes = buildVigilIndexes(vigilRows)
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const match = matchZohoSkuToVigilWithIndexes(vigilIndexes, item.sku)
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

/** JSONB from Postgres should be an array; tolerate stringified legacy rows. */
function coerceVigilRowsFromUpload(upload) {
  if (!upload) return []
  let rows = upload.parsed_rows
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows)
    } catch {
      return []
    }
  }
  return Array.isArray(rows) ? rows : []
}

function parseTabularUpload(buffer, fileName = '') {
  if (isExcelFile(fileName)) return parseTabularExcel(buffer)
  const parsed = parseCsv(buffer.toString('utf8'))
  return { headers: parsed.headers, rows: parsed.rows }
}

const LOW_STOCK_HEADER_LIKE_SKUS = new Set([
  'SKU',
  'LOW STOCK',
  'LOW-STOCK',
  'ITEM CODE',
  'ITEM',
  'CODE',
  'PRODUCT',
  'PRODUCT SKU',
])

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
    else if (LOW_STOCK_HEADER_LIKE_SKUS.has(normalizeSku(sku))) errors.push('Header or label row (not a SKU)')
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

function nextZohoPurchaseOrderReference(planNumber) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 14)
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  const base = clean(planNumber || 'PP')
    .replace(/[^A-Z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  return `${base || 'PP'}-${stamp}-${suffix}`
}

function planItemNotes(match, available, wasAdjustedForVigil) {
  if (!match.matched) return 'No matching Vigil stock row'
  if (available <= 0) return 'Unavailable in wholesale stock'
  if (wasAdjustedForVigil) return 'Vigil stock below required usage; final qty auto-adjusted'
  return ''
}

const SYSTEM_PLAN_NOTES = new Set([
  'No matching Vigil stock row',
  'Unavailable in wholesale stock',
  'Vigil stock below required usage; final qty auto-adjusted',
])

function isSystemGeneratedNote(notes) {
  return SYSTEM_PLAN_NOTES.has(clean(notes))
}

function resolveRefreshUserFields(item, autoFinalQty, autoIncluded, autoNotes) {
  const preserveFinalQty = Number(item.finalQty) !== Number(item.suggestedQty)
  const preserveNotes = clean(item.notes) && !isSystemGeneratedNote(item.notes)
  return {
    finalQty: preserveFinalQty ? Number(item.finalQty) : autoFinalQty,
    included: item.included,
    notes: preserveNotes ? clean(item.notes) : autoNotes,
    purchasePrice: item.purchasePrice,
  }
}

async function waitForLowStockEnrichment(maxWaitMs = 120_000, pollMs = 500) {
  const deadline = Date.now() + maxWaitMs
  while (lowStockEnrichmentJob.running && Date.now() < deadline) {
    await sleep(pollMs)
  }
  if (lowStockEnrichmentJob.running) {
    const err = new Error('Zoho enrichment is still running; try again in a moment')
    err.code = 'ENRICHMENT_RUNNING'
    throw err
  }
}

function assertPendingSkusZohoReady(lowStock) {
  const unmatched = (Array.isArray(lowStock) ? lowStock : []).filter((item) => !clean(item.zohoItemId))
  if (unmatched.length === 0) return
  const err = new Error(`${unmatched.length} pending SKU(s) not matched in Zoho`)
  err.code = 'LOW_STOCK_ZOHO_MATCH_INCOMPLETE'
  err.details = {
    unmatchedCount: unmatched.length,
    unmatchedSkus: unmatched.slice(0, 20).map((item) => item.sku),
  }
  throw err
}

function assertPlanEligibleForPo(planRow) {
  if (clean(planRow.zoho_purchase_order_id)) {
    const err = new Error('This purchase plan already has a Zoho purchase order')
    err.code = 'DUPLICATE_PO'
    throw err
  }
  if (planRow.status === 'sent_to_zoho') {
    const err = new Error('This purchase plan was already sent to Zoho')
    err.code = 'DUPLICATE_PO'
    throw err
  }
  if (planRow.status !== 'draft' && planRow.status !== 'failed') {
    const err = new Error('Only draft or failed plans without an existing PO can create a Zoho purchase order')
    err.code = 'DUPLICATE_PO'
    throw err
  }
}

async function generatePlan({ createdBy }) {
  const upload = await getLatestVigilUpload()
  if (!upload) {
    const err = new Error('Upload a Vigil stock file before generating a purchase plan')
    err.code = 'NO_VIGIL_UPLOAD'
    throw err
  }

  let lowStock = (await listLowStock()).filter((item) => item.status === 'pending')
  if (lowStock.length === 0) {
    const err = new Error('Upload low-stock SKUs before generating a purchase plan')
    err.code = 'NO_LOW_STOCK_ITEMS'
    throw err
  }
  if (lowStockEnrichmentJob.running) {
    await waitForLowStockEnrichment()
  }
  if (lowStock.some((item) => !clean(item.zohoItemId))) {
    await refreshLowStockZohoEnrichment()
    lowStock = (await listLowStock()).filter((item) => item.status === 'pending')
    if (lowStock.length === 0) {
      const err = new Error('Upload low-stock SKUs before generating a purchase plan')
      err.code = 'NO_LOW_STOCK_ITEMS'
      throw err
    }
  }
  assertPendingSkusZohoReady(lowStock)
  const vigilRows = coerceVigilRowsFromUpload(upload)
  const warnings = []

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
    const vigilIndexes = buildVigilIndexes(vigilRows)
    for (const item of lowStock) {
      const match = matchZohoSkuToVigilWithIndexes(vigilIndexes, item.sku)
      const { totalSales, totalBundle } = planUsageFromEnrichedPendingItem(item)
      const totalUsage = totalSales + totalBundle
      const averageMonthlyUsage = totalUsage / 3
      const available = match.matched ? Math.max(0, Math.floor(match.wholesaleAvailableQty)) : 0
      const { suggestedQty, finalQty, wasAdjustedForVigil } = calculatePlanQuantities({
        totalSales,
        totalBundle,
        vigilAvailable: available,
      })
      const included = finalQty > 0 && available > 0 && match.matched
      const notes = planItemNotes(match, available, wasAdjustedForVigil)

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

async function refreshDraftPlanZohoData(planId) {
  const plan = await getPlan(planId)
  if (!plan) {
    const err = new Error('Purchase plan not found')
    err.code = 'PLAN_NOT_FOUND'
    throw err
  }
  if (plan.status !== 'draft') {
    const err = new Error('Only draft plans can be refreshed from Zoho')
    err.code = 'PLAN_NOT_DRAFT'
    throw err
  }
  if (!Array.isArray(plan.items) || plan.items.length === 0) {
    const err = new Error('Purchase plan has no line items to refresh')
    err.code = 'PLAN_HAS_NO_ITEMS'
    throw err
  }

  const upload = await getLatestVigilUpload()
  const vigilRows = coerceVigilRowsFromUpload(upload)
  const vigilIndexes = buildVigilIndexes(vigilRows)
  const enriched = await enrichUploadedLowStockSkus(plan.items.map((item) => item.sku))
  const enrichedBySku = new Map(enriched.map((item) => [normalizeSku(item.sku), item]))
  const { salesAggregate, bundleUsageAggregate } = await fetchLast3MonthsSalesAggregate()

  let matched = 0
  let unmatched = 0
  for (const item of plan.items) {
    const zoho = enrichedBySku.get(normalizeSku(item.sku)) || {}
    if (zoho.matchedInZoho) matched += 1
    else unmatched += 1
    const match = matchZohoSkuToVigilWithIndexes(vigilIndexes, item.sku)
    const totalSales = zoho.matchedInZoho
      ? salesQtyForItem(salesAggregate, { sku: item.sku, zoho_item_id: zoho.zohoItemId })
      : 0
    const totalBundle = zoho.matchedInZoho
      ? bundleUsageQtyForItem(bundleUsageAggregate, { sku: item.sku, zoho_item_id: zoho.zohoItemId })
      : 0
    const totalUsage = totalSales + totalBundle
    const averageMonthlyUsage = totalUsage / 3
    const available = match.matched ? Math.max(0, Math.floor(match.wholesaleAvailableQty)) : 0
    const { suggestedQty, finalQty: autoFinalQty, wasAdjustedForVigil } = calculatePlanQuantities({
      totalSales,
      totalBundle,
      vigilAvailable: available,
    })
    const autoIncluded = autoFinalQty > 0 && available > 0 && match.matched
    const autoNotes = planItemNotes(match, available, wasAdjustedForVigil)
    const userFields = resolveRefreshUserFields(item, autoFinalQty, autoIncluded, autoNotes)

    await query(
      `
        UPDATE purchase_plan_items
        SET
          item_name = $2,
          zoho_item_id = $3,
          current_zoho_stock = $4,
          vigil_code = $5,
          wholesale_available_qty = $6,
          match_type = $7,
          total_sales_last_3_months = $8,
          total_bundle_usage_last_3_months = $9,
          total_usage_last_3_months = $10,
          average_monthly_usage = $11,
          suggested_qty = $12,
          final_qty = $13,
          included = $14,
          notes = $15,
          purchase_price = $16
        WHERE id = $1
      `,
      [
        item.id,
        zoho.matchedInZoho ? zoho.itemName : '',
        zoho.matchedInZoho ? zoho.zohoItemId : '',
        zoho.matchedInZoho ? zoho.currentZohoStock : 0,
        match.matchedVigilCode || '',
        available,
        match.matchType,
        totalSales,
        totalBundle,
        totalUsage,
        averageMonthlyUsage,
        suggestedQty,
        userFields.finalQty,
        userFields.included,
        userFields.notes,
        userFields.purchasePrice,
      ]
    )
  }

  const refreshedPlan = await getPlan(planId)
  return {
    plan: refreshedPlan,
    summary: {
      refreshed: plan.items.length,
      matched,
      unmatched,
    },
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

async function deleteDraftPlan(id) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const planResult = await client.query(
      `SELECT id, status FROM purchase_plans WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const planRow = planResult.rows[0]
    if (!planRow) {
      const err = new Error('Purchase plan not found')
      err.code = 'PLAN_NOT_FOUND'
      throw err
    }
    if (planRow.status !== 'draft') {
      const err = new Error('Only draft plans can be deleted')
      err.code = 'PLAN_NOT_DRAFT'
      throw err
    }

    const skuResult = await client.query(
      `SELECT sku FROM purchase_plan_items WHERE purchase_plan_id = $1`,
      [id]
    )
    const skus = skuResult.rows.map((row) => row.sku)

    await client.query(`DELETE FROM purchase_plans WHERE id = $1`, [id])

    let restoredSkuCount = 0
    if (skus.length > 0) {
      const restoreResult = await client.query(
        `
          UPDATE purchase_low_stock_items
          SET status = 'pending', updated_at = NOW()
          WHERE sku = ANY($1::text[]) AND status = 'planned'
        `,
        [skus]
      )
      restoredSkuCount = restoreResult.rowCount || 0
    }

    await client.query('COMMIT')
    return { deleted: true, id: planRow.id, restoredSkuCount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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
  const planRow = await query(`SELECT status FROM purchase_plans WHERE id = $1`, [planId])
  if (!planRow.rows[0]) {
    const err = new Error('Purchase plan not found')
    err.code = 'PLAN_NOT_FOUND'
    throw err
  }
  if (planRow.rows[0].status !== 'draft') {
    const err = new Error('Only draft plans can be edited')
    err.code = 'PLAN_NOT_EDITABLE'
    throw err
  }
  const finalQty = patch.finalQty == null ? null : Math.max(0, Math.floor(toNumber(patch.finalQty, 0)))
  const included = patch.included == null ? null : Boolean(patch.included)
  const purchasePrice = patch.purchasePrice == null || patch.purchasePrice === ''
    ? null
    : Math.max(0, toNumber(patch.purchasePrice, 0))
  const notes = patch.notes == null ? null : clean(patch.notes)
  const result = await query(
    `
      UPDATE purchase_plan_items
      SET
        final_qty = COALESCE($3, final_qty),
        included = COALESCE($4, included),
        purchase_price = COALESCE($5, purchase_price),
        notes = COALESCE($6, notes)
      WHERE purchase_plan_id = $1 AND id = $2
      RETURNING *
    `,
    [planId, itemId, finalQty, included, purchasePrice, notes]
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

function buildPurchasePriceMap(purchasePrices) {
  const byItemId = new Map()
  const bySku = new Map()
  for (const entry of Array.isArray(purchasePrices) ? purchasePrices : []) {
    const price = toNumber(entry && entry.purchasePrice, NaN)
    if (!Number.isFinite(price) || price <= 0) continue
    const itemId = Number(entry.planItemId || entry.itemId || entry.id)
    if (Number.isInteger(itemId) && itemId > 0) byItemId.set(itemId, price)
    const sku = normalizeSku(entry && entry.sku)
    if (sku) bySku.set(sku, price)
  }
  return { byItemId, bySku }
}

function applyPurchasePricesToPlanItems(items, purchasePrices) {
  const priceMap = buildPurchasePriceMap(purchasePrices)
  return (Array.isArray(items) ? items : []).map((item) => {
    const price =
      priceMap.byItemId.get(Number(item.id)) ||
      priceMap.bySku.get(normalizeSku(item.sku)) ||
      toNumber(item.purchasePrice, NaN)
    return {
      ...item,
      purchasePrice: Number.isFinite(price) && price > 0 ? price : null,
    }
  })
}

function sortPurchaseOrderLinesBySku(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) =>
    clean(a && a.sku).localeCompare(clean(b && b.sku), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  )
}

async function createZohoPurchaseOrder(planId, options = {}) {
  const config = readZohoConfig()
  if (config.code !== 'ok') {
    const err = new Error('Zoho is not configured')
    err.code = config.code || 'ZOHO_NOT_CONFIGURED'
    throw err
  }

  const vendor = resolvePurchaseOrderVendor()
  const requestedPoNumber = clean(options.purchaseOrderNumber)
  if (!requestedPoNumber) {
    const err = new Error('Enter a purchase order number before sending to Zoho')
    err.code = 'ZOHO_PO_NUMBER_REQUIRED'
    throw err
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const planResult = await client.query(
      `SELECT * FROM purchase_plans WHERE id = $1 FOR UPDATE`,
      [planId]
    )
    const planRow = planResult.rows[0]
    if (!planRow) {
      const err = new Error('Purchase plan not found')
      err.code = 'PLAN_NOT_FOUND'
      throw err
    }
    assertPlanEligibleForPo(planRow)

    const itemsResult = await client.query(
      `
        SELECT *
        FROM purchase_plan_items
        WHERE purchase_plan_id = $1
        ORDER BY included DESC, suggested_qty DESC, sku ASC
      `,
      [planId]
    )
    const plan = mapPlanRow(planRow, itemsResult.rows.map(mapPlanItemRow))
    const pricedItems = applyPurchasePricesToPlanItems(plan.items || [], options.purchasePrices)

    const selected = sortPurchaseOrderLinesBySku(
      pricedItems.filter((item) =>
        item.included &&
        item.finalQty > 0 &&
        clean(item.zohoItemId)
      )
    )
    if (selected.length === 0) {
      const err = new Error('No included rows with finalQty > 0 and Zoho item id were found')
      err.code = 'NO_PO_LINES'
      throw err
    }
    const missingPrices = selected.filter((item) => !Number.isFinite(Number(item.purchasePrice)) || Number(item.purchasePrice) <= 0)
    if (missingPrices.length > 0) {
      const err = new Error(`Purchase price is missing for ${missingPrices.length} selected line(s): ${missingPrices.slice(0, 5).map((item) => item.sku).join(', ')}`)
      err.code = 'ZOHO_PO_PRICE_REQUIRED'
      throw err
    }

    for (const item of selected) {
      await client.query(
        `UPDATE purchase_plan_items SET purchase_price = $3 WHERE purchase_plan_id = $1 AND id = $2`,
        [plan.id, item.id, Number(item.purchasePrice)]
      )
    }

    const zohoReferenceNumber = nextZohoPurchaseOrderReference(plan.planNumber)
    const payload = {
      vendor_id: vendor.vendorId,
      purchaseorder_number: requestedPoNumber,
      date: todayIso(),
      reference_number: zohoReferenceNumber,
      notes: `Generated from HR & BI Purchase Planning plan ${plan.planNumber}. Review completed by admin before sending.`,
      line_items: selected.map((item) => ({
        item_id: item.zohoItemId,
        quantity: item.finalQty,
        rate: Number(item.purchasePrice),
      })),
    }

    const json = await zohoApiRequest(
      `${INVENTORY_V1}/purchaseorders`,
      new URLSearchParams(),
      'POST',
      buildZohoJsonStringBody(payload),
      { source: 'purchase_planning_create_po', skipCache: true }
    )
    const po = (json && json.purchaseorder) || (json && json.purchase_order) || json || {}
    const zohoPurchaseOrderId = clean(po.purchaseorder_id || po.purchase_order_id || po.purchaseorderId || po.id)

    await client.query(
      `
        UPDATE purchase_plans
        SET status = 'sent_to_zoho', zoho_purchase_order_id = $2, zoho_error = NULL
        WHERE id = $1
      `,
      [plan.id, zohoPurchaseOrderId || null]
    )
    await client.query(
      `
        UPDATE purchase_low_stock_items
        SET status = 'ordered', updated_at = NOW()
        WHERE sku = ANY($1::text[])
      `,
      [selected.map((item) => item.sku)]
    )

    await client.query('COMMIT')
    return {
      success: true,
      zohoPurchaseOrderId,
      purchaseOrder: po,
      sentLines: selected.length,
      skippedLines: (plan.items || []).length - selected.length,
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (_) {
      // ignore rollback failure
    }
    if (planId && err && err.code !== 'DUPLICATE_PO' && err.code !== 'PLAN_NOT_FOUND' && err.code !== 'NO_PO_LINES' && err.code !== 'ZOHO_PO_PRICE_REQUIRED') {
      try {
        await query(
          `UPDATE purchase_plans SET status = 'failed', zoho_error = $2 WHERE id = $1 AND status IN ('draft', 'failed')`,
          [planId, err.message || String(err)]
        )
      } catch (_) {
        // ignore follow-up status update failure
      }
    }
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  ensurePurchasePlanningTables,
  enrichUploadedLowStockSkus,
  saveUploadedLowStockSkus,
  refreshLowStockZohoEnrichment,
  queueLowStockZohoEnrichment,
  getLowStockEnrichmentStatus,
  listLowStock,
  removePendingLowStockItem,
  previewLowStockUpload,
  saveLowStockUpload,
  previewVigilUpload,
  parseVigilExcel,
  saveVigilUpload,
  listVigilUploads,
  generatePlan,
  refreshDraftPlanZohoData,
  listPlans,
  getPlan,
  deleteDraftPlan,
  updatePlanItem,
  createZohoPurchaseOrder,
  _internals: {
    buildZohoItemIndex,
    buildCompositeUsageAggregate,
    bundleUsageQtyForItem,
    calculatePlanQuantities,
    planUsageFromEnrichedPendingItem,
    nextZohoPurchaseOrderReference,
    resolvePurchaseOrderVendor,
    resolveZohoStock,
    resolvePurchasePlanningWarehouse,
    coerceVigilRowsFromUpload,
    applyVigilMatchesToLowStockRows,
    applyPurchasePricesToPlanItems,
    sortPurchaseOrderLinesBySku,
    planItemNotes,
    isSystemGeneratedNote,
    resolveRefreshUserFields,
    assertPendingSkusZohoReady,
    assertPlanEligibleForPo,
    waitForLowStockEnrichment,
    lowStockEnrichmentJob,
  },
}
