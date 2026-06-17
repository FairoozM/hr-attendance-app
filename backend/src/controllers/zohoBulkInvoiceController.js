const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')
const { zohoApiRequest } = require('../integrations/zoho/zohoInventoryClient')
const { getDailySuccessCount, getZohoGuardStatus } = require('../services/zohoApiClient')
const {
  upsertItems,
  findItemsBySkus,
  findItemsByNames,
  getItemCacheStats,
  findInvoiceByReference,
  insertInvoiceLog,
} = require('../services/zohoBulkInvoiceStore')

const MAX_ITEMS = 1000
const ITEMS_PER_PAGE = 200
const MAX_SYNC_PAGES = 80

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function uniqueStrings(input) {
  const source = Array.isArray(input) ? input : []
  const seen = new Set()
  const out = []
  for (const raw of source) {
    const value = clean(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function usageSnapshot() {
  const guard = getZohoGuardStatus()
  const out = {
    utc_day: new Date().toISOString().slice(0, 10),
    daily_limit: guard.dailyLimit,
    successful_calls: null,
    per_minute_limit: guard.perMinuteLimit,
    warning_limit: guard.warningLimit,
    safe_stop_limit: guard.safeStopLimit,
  }
  try {
    out.successful_calls = await getDailySuccessCount()
  } catch {
    out.count_unavailable = true
  }
  return out
}

function mapCacheRow(row) {
  return {
    sku: row.sku,
    item_id: row.item_id,
    name: row.name || '',
    rate: row.rate == null ? 0 : Number(row.rate),
    tax_id: row.tax_id || '',
    unit: row.unit || '',
    status: row.status || '',
  }
}

function firstRowByLowerValue(rows, getValue) {
  const out = new Map()
  for (const row of rows) {
    const key = clean(getValue(row)).toLowerCase()
    if (key && !out.has(key)) out.set(key, row)
  }
  return out
}

async function validateSkus(req, res) {
  if (!Array.isArray(req.body && req.body.skus)) {
    return res.status(400).json({ error: 'Input must be { skus: string[] }' })
  }
  const cache = await getItemCacheStats()
  const requested = uniqueStrings(req.body.skus)
  const foundRows = await findItemsBySkus(requested)
  const foundBySku = firstRowByLowerValue(foundRows, (row) => row.sku)
  const found = []
  const missing = []
  for (const sku of requested) {
    const row = foundBySku.get(sku.toLowerCase())
    if (row) found.push(mapCacheRow(row))
    else missing.push(sku)
  }
  return res.json({
    found,
    missing,
    summary: {
      requested: requested.length,
      found: found.length,
      missing: missing.length,
    },
    cache,
    usage: await usageSnapshot(),
  })
}

async function validateNames(req, res) {
  if (!Array.isArray(req.body && req.body.names)) {
    return res.status(400).json({ error: 'Input must be { names: string[] }' })
  }
  const cache = await getItemCacheStats()
  const requested = uniqueStrings(req.body.names)
  const foundRows = await findItemsByNames(requested)
  const foundByName = firstRowByLowerValue(foundRows, (row) => row.name)
  const found = []
  const missing = []
  for (const name of requested) {
    const row = foundByName.get(name.toLowerCase())
    if (row) found.push(mapCacheRow(row))
    else missing.push(name)
  }
  return res.json({
    found,
    missing,
    summary: {
      requested: requested.length,
      found: found.length,
      missing: missing.length,
    },
    cache,
    usage: await usageSnapshot(),
  })
}

async function syncItems(req, res) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    return res.status(503).json({ error: 'Zoho is not configured', code: c.code, missing: c.missing || [] })
  }
  const requestedMaxPages = Math.max(1, Math.min(Number(req.body && req.body.max_pages) || MAX_SYNC_PAGES, MAX_SYNC_PAGES))
  let pagesFetched = 0
  let itemsSynced = 0
  let hasMore = true

  try {
    for (let page = 1; page <= requestedMaxPages && hasMore; page += 1) {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('per_page', String(ITEMS_PER_PAGE))
      params.set('filter_by', 'Status.Active')
      const json = await zohoApiRequest(`${INVENTORY_V1}/items`, params, 'GET', undefined, {
        source: 'bulk_invoice_items_sync',
        cacheCategory: 'items_list',
        skipCache: true,
      })
      pagesFetched += 1
      const rows = Array.isArray(json && json.items) ? json.items : []
      itemsSynced += await upsertItems(rows)
      hasMore = json && json.page_context && json.page_context.has_more_page === true
      if (rows.length < ITEMS_PER_PAGE) hasMore = false
    }

    return res.json({
      pages_fetched: pagesFetched,
      items_synced: itemsSynced,
      api_calls_used: pagesFetched,
      cache: await getItemCacheStats(),
      usage: await usageSnapshot(),
    })
  } catch (err) {
    return res.status(err.code === 'ZOHO_NOT_CONFIGURED' ? 503 : 502).json({
      error: err.message || 'Failed to sync Zoho items',
      code: err.code || 'ZOHO_ITEMS_SYNC_FAILED',
      usage: await usageSnapshot(),
    })
  }
}

function validateInvoiceInput(body) {
  const errors = []
  const customerId = clean(body.customer_id)
  const warehouseId = clean(body.warehouse_id)
  const lines = Array.isArray(body.line_items) ? body.line_items : []
  if (!customerId) errors.push('customer_id is required')
  if (!warehouseId) errors.push('warehouse_id is required')
  if (!lines.length) errors.push('line_items must not be empty')
  const normalizedLines = lines.map((line, index) => {
    const itemId = clean(line.item_id)
    const quantity = asNumber(line.quantity, NaN)
    const rate = asNumber(line.rate, NaN)
    if (!itemId) errors.push(`line_items[${index}].item_id is required`)
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`line_items[${index}].quantity must be > 0`)
    if (!Number.isFinite(rate) || rate < 0) errors.push(`line_items[${index}].rate must be >= 0`)
    return {
      sku: clean(line.sku),
      item_id: itemId,
      quantity,
      rate,
      discount: asNumber(line.discount, 0),
      tax_id: clean(line.tax_id),
      warehouse_id: clean(line.warehouse_id) || warehouseId,
    }
  })
  return { errors, customerId, warehouseId, normalizedLines }
}

function buildInvoicePayload(body, normalizedLines) {
  const payload = {
    customer_id: clean(body.customer_id),
    date: clean(body.date),
    due_date: clean(body.due_date),
    currency_code: clean(body.currency_code || 'AED'),
    reference_number: clean(body.reference_number),
    notes: clean(body.notes),
    is_inclusive_tax: body.is_inclusive_tax === true,
    line_items: normalizedLines.map((line) => ({
      item_id: line.item_id,
      quantity: line.quantity,
      rate: line.rate,
      discount: line.discount || 0,
      warehouse_id: line.warehouse_id,
      ...(line.tax_id ? { tax_id: line.tax_id } : {}),
    })),
  }
  Object.keys(payload).forEach((key) => {
    if (payload[key] === '') delete payload[key]
  })
  return payload
}

function buildZohoJsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

async function bulkCreateInvoice(req, res) {
  const body = req.body || {}
  const referenceNumber = clean(body.reference_number)
  if (referenceNumber) {
    const existing = await findInvoiceByReference(referenceNumber)
    if (existing) {
      return res.json({
        duplicate: true,
        invoice: {
          reference_number: existing.reference_number,
          invoice_number: existing.invoice_number,
          zoho_invoice_id: existing.zoho_invoice_id,
          status: existing.status,
          total: existing.total == null ? null : Number(existing.total),
        },
        usage: await usageSnapshot(),
      })
    }
  }

  const { errors, customerId, normalizedLines } = validateInvoiceInput(body)
  if (errors.length) return res.status(400).json({ error: 'Invalid invoice payload', errors })

  const payload = buildInvoicePayload(body, normalizedLines)
  try {
    const json = await zohoApiRequest(`${INVENTORY_V1}/invoices`, new URLSearchParams(), 'POST', buildZohoJsonStringBody(payload), {
      source: 'bulk_invoice_create',
      skipCache: true,
    })
    const invoice = (json && json.invoice) || json || {}
    const log = await insertInvoiceLog({
      reference_number: referenceNumber || invoice.reference_number || null,
      invoice_number: invoice.invoice_number || invoice.number || null,
      zoho_invoice_id: invoice.invoice_id || invoice.invoiceId || invoice.id || null,
      customer_id: customerId,
      status: invoice.status || json.message || 'created',
      total: invoice.total,
      api_calls_used: 1,
      request_json: payload,
      response_json: json,
    })
    return res.json({
      success: true,
      invoice: {
        reference_number: log.reference_number,
        invoice_number: log.invoice_number,
        zoho_invoice_id: log.zoho_invoice_id,
        status: log.status,
        total: log.total == null ? null : Number(log.total),
      },
      api_calls_used: 1,
      usage: await usageSnapshot(),
    })
  } catch (err) {
    return res.status(err.code === 'ZOHO_NOT_CONFIGURED' ? 503 : 502).json({
      error: err.message || 'Failed to create Zoho invoice',
      code: err.code || 'ZOHO_BULK_INVOICE_FAILED',
      usage: await usageSnapshot(),
    })
  }
}

module.exports = {
  validateSkus,
  validateNames,
  syncItems,
  bulkCreateInvoice,
}
