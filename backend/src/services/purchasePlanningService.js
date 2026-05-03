const { query, pool } = require('../db')
const { parseCsv, indexHeaders, cellOf } = require('../utils/csv')
const {
  normalizeSku,
  matchZohoSkuToVigil,
} = require('../utils/purchasePlanningSkuMatcher')
const { fetchAllItemsRaw } = require('../integrations/zoho/zohoAdapter')
const { getSales } = require('../integrations/zoho/weeklyReportZohoTransactions')
const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')
const { zohoApiRequest } = require('../integrations/zoho/zohoInventoryClient')

const LOW_STOCK_THRESHOLD = 3

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

function resolveZohoStock(item) {
  for (const key of [
    'actual_available_stock',
    'available_stock',
    'stock_on_hand',
    'available_for_sale_stock',
    'warehouse_stock_on_hand',
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

async function ensurePurchasePlanningTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS purchase_low_stock_items (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(160) UNIQUE NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      zoho_item_id VARCHAR(100),
      current_zoho_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
      low_stock_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'planned', 'ordered', 'ignored')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

async function syncLowStockFromZoho() {
  const items = await fetchAllItemsRaw()
  const lowItems = items
    .map((item) => ({
      sku: clean(item.sku || item.item_code || item.code),
      itemName: clean(item.name || item.item_name),
      zohoItemId: clean(item.item_id || item.id),
      currentZohoStock: resolveZohoStock(item),
    }))
    .filter((item) => item.sku && item.currentZohoStock < LOW_STOCK_THRESHOLD)

  let upserted = 0
  for (const item of lowItems) {
    const result = await query(
      `
        INSERT INTO purchase_low_stock_items
          (sku, item_name, zoho_item_id, current_zoho_stock, low_stock_detected_at, status, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), 'pending', NOW())
        ON CONFLICT (sku) DO UPDATE SET
          item_name = EXCLUDED.item_name,
          zoho_item_id = EXCLUDED.zoho_item_id,
          current_zoho_stock = EXCLUDED.current_zoho_stock,
          low_stock_detected_at = CASE
            WHEN purchase_low_stock_items.current_zoho_stock >= $5 THEN NOW()
            ELSE purchase_low_stock_items.low_stock_detected_at
          END,
          status = CASE
            WHEN purchase_low_stock_items.status = 'ignored' THEN 'ignored'
            WHEN purchase_low_stock_items.status = 'ordered' THEN 'ordered'
            WHEN purchase_low_stock_items.status = 'planned' THEN 'planned'
            ELSE 'pending'
          END,
          updated_at = NOW()
        RETURNING id
      `,
      [item.sku, item.itemName, item.zohoItemId, item.currentZohoStock, LOW_STOCK_THRESHOLD]
    )
    upserted += result.rowCount
  }
  return { synced: upserted, detected: lowItems.length, threshold: LOW_STOCK_THRESHOLD }
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
  return result.rows.map(mapLowStockRow)
}

function findHeader(headerIdx, candidates) {
  for (const name of candidates) {
    if (headerIdx.has(name)) return name
  }
  return ''
}

function parseVigilCsv(text) {
  const parsed = parseCsv(text)
  const headerIdx = indexHeaders(parsed.headers)
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

  const rows = parsed.rows.map((raw, index) => {
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
    headers: parsed.headers,
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

async function previewVigilUpload(buffer) {
  return parseVigilCsv(buffer.toString('utf8'))
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
    const err = new Error('Upload a Vigil stock CSV before generating a purchase plan')
    err.code = 'NO_VIGIL_UPLOAD'
    throw err
  }

  const lowStock = (await listLowStock()).filter((item) => item.status === 'pending')
  const vigilRows = Array.isArray(upload.parsed_rows) ? upload.parsed_rows : []
  const fromDate = isoDateDaysAgo(92)
  const toDate = todayIso()
  const warnings = []
  const sales = await getSales(fromDate, toDate, {
    onWarning: (message) => warnings.push(message),
  })
  const salesAggregate = aggregateSalesLines(sales.lines)
  const bundleUsageBySku = await getBundleUsageBySku(fromDate, toDate)

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
      const totalBundle = bundleUsageBySku.get(normalizeSku(item.sku)) || 0
      const totalUsage = totalSales + totalBundle
      const averageMonthlyUsage = totalUsage / 3
      const requiredQty = Math.ceil((averageMonthlyUsage * 3) - item.currentZohoStock)
      const available = match.matched ? Math.max(0, Math.floor(match.wholesaleAvailableQty)) : 0
      const suggestedQty = requiredQty <= 0 ? 0 : Math.min(requiredQty, available)
      const included = suggestedQty > 0 && available > 0 && match.matched
      const notes = !match.matched
        ? 'No matching Vigil stock row'
        : available <= 0
          ? 'Unavailable in wholesale stock'
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
          suggestedQty,
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

  const vendorId = clean(process.env.ZOHO_PURCHASE_VENDOR_ID)
  if (!vendorId) {
    const err = new Error('Set ZOHO_PURCHASE_VENDOR_ID before creating purchase orders')
    err.code = 'ZOHO_VENDOR_NOT_CONFIGURED'
    throw err
  }

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
    vendor_id: vendorId,
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
  syncLowStockFromZoho,
  listLowStock,
  previewVigilUpload,
  saveVigilUpload,
  listVigilUploads,
  generatePlan,
  listPlans,
  getPlan,
  updatePlanItem,
  createZohoPurchaseOrder,
}
