const { noonPost } = require('./noonClient')
const { getNoonProductSnapshotsForAudit, normalizeCountryCode, updateNoonProductSnapshotStock } = require('./noonSnapshotStore')
const { flattenJson } = require('./noonRichContentAuditService')

const STOCK_LIST_PATH = '/v1/stock-list'
const STOCK_FIELD_KEYWORDS = [
  'quantity',
  'qty',
  'stock',
  'stockcount',
  'availablequantity',
  'availableqty',
  'sellablequantity',
  'inventory',
  'fulfillable',
  'reserved',
  'fbn',
  'fbp',
]
const WAREHOUSE_FIELD_KEYWORDS = ['warehouse', 'warehousecode', 'warehouseid']

function normalizeKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function displayValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function addSample(list, value) {
  const text = displayValue(value)
  if (!text || list.includes(text) || list.length >= 5) return
  list.push(text.length > 300 ? `${text.slice(0, 300)}...` : text)
}

function addSkuSample(list, sku) {
  if (!sku || list.includes(sku) || list.length >= 5) return
  list.push(sku)
}

function isStockPath(path) {
  const normalized = normalizeKey(path)
  return STOCK_FIELD_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function isWarehousePath(path) {
  const normalized = normalizeKey(path)
  return WAREHOUSE_FIELD_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function extractNumber(value) {
  if (value == null || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function findStringByKeys(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()
  function walk(value) {
    if (!value || typeof value !== 'object') return ''
    if (visited.has(value)) return ''
    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found) return found
      }
      return ''
    }
    for (const [key, entry] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key)) && typeof entry === 'string' && entry.trim()) {
        return entry.trim()
      }
    }
    for (const entry of Object.values(value)) {
      const found = walk(entry)
      if (found) return found
    }
    return ''
  }
  return walk(source)
}

function findNumberByKeys(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()
  function walk(value) {
    if (!value || typeof value !== 'object') return null
    if (visited.has(value)) return null
    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found != null) return found
      }
      return null
    }
    for (const [key, entry] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key))) {
        const found = extractNumber(entry)
        if (found != null) return found
      }
    }
    for (const entry of Object.values(value)) {
      const found = walk(entry)
      if (found != null) return found
    }
    return null
  }
  return walk(source)
}

function pickStockItems(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  for (const key of ['items', 'data', 'results', 'stock', 'stocks', 'inventory']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  return []
}

function normalizeStockResponse(raw, fallback = {}) {
  const items = pickStockItems(raw)
  const firstItem = items[0] && typeof items[0] === 'object' ? items[0] : raw
  return {
    quantity: findNumberByKeys(firstItem, [
      'quantity',
      'qty',
      'stock',
      'stock_count',
      'available_quantity',
      'available_qty',
      'sellable_quantity',
      'inventory',
      'fulfillable',
    ]),
    warehouse: findStringByKeys(firstItem, ['warehouse', 'warehouse_code', 'warehouse_id']) || fallback.warehouse || '',
    partnerSku: findStringByKeys(firstItem, ['partner_sku', 'partnerSku', 'sku']) || fallback.partnerSku || '',
    status: findStringByKeys(firstItem, ['status', 'status_code', 'message']),
  }
}

async function auditNoonStockFields(options = {}) {
  const countryCode = normalizeCountryCode(options.countryCode || options.country_code)
  const rows = await getNoonProductSnapshotsForAudit(countryCode)
  const fieldMap = new Map()
  const stockSkus = new Set()
  const warehouseSkus = new Set()

  for (const row of rows) {
    for (const sourceInfo of [
      { source: 'catalog', json: row.raw_catalog_json || {} },
      { source: 'pricing', json: row.raw_pricing_json || {} },
      { source: 'stock', json: row.raw_stock_json || {} },
    ]) {
      for (const entry of flattenJson(sourceInfo.json)) {
        const stockMatch = isStockPath(entry.path)
        const warehouseMatch = isWarehousePath(entry.path)
        if (!stockMatch && !warehouseMatch) continue
        if (stockMatch) stockSkus.add(row.partner_sku)
        if (warehouseMatch) warehouseSkus.add(row.partner_sku)
        const key = `${sourceInfo.source}:${stockMatch ? 'stock' : 'warehouse'}:${entry.path}`
        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            group: stockMatch ? 'stock' : 'warehouse',
            source: sourceInfo.source,
            path: entry.path,
            count: 0,
            sampleValues: [],
            sampleSkus: [],
          })
        }
        const field = fieldMap.get(key)
        field.count += 1
        addSample(field.sampleValues, entry.value)
        addSkuSample(field.sampleSkus, row.partner_sku)
      }
    }
  }

  return {
    ok: true,
    countryCode,
    totalRows: rows.length,
    summary: {
      stockQuantityFieldsFoundCount: stockSkus.size,
      warehouseFieldsFoundCount: warehouseSkus.size,
    },
    fields: Array.from(fieldMap.values()).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
  }
}

async function discoverNoonWarehouses(options = {}) {
  const countryCode = normalizeCountryCode(options.countryCode || options.country_code)
  const rows = await getNoonProductSnapshotsForAudit(countryCode)
  const warehouses = new Map()
  const configured = String(process.env.NOON_WAREHOUSE_CODE || '').trim()
  if (configured) {
    warehouses.set(configured, {
      code: configured,
      name: '',
      countryCode,
      type: 'configured',
      raw: { source: 'NOON_WAREHOUSE_CODE' },
    })
  }

  for (const row of rows) {
    for (const sourceInfo of [
      { source: 'catalog', json: row.raw_catalog_json || {} },
      { source: 'pricing', json: row.raw_pricing_json || {} },
      { source: 'stock', json: row.raw_stock_json || {} },
    ]) {
      for (const entry of flattenJson(sourceInfo.json)) {
        if (!isWarehousePath(entry.path)) continue
        const code = displayValue(entry.value)
        if (!code || warehouses.has(code)) continue
        warehouses.set(code, {
          code,
          name: '',
          countryCode,
          type: 'snapshot-raw',
          raw: {
            source: sourceInfo.source,
            path: entry.path,
            sampleSku: row.partner_sku,
            value: entry.value,
          },
        })
      }
    }
  }

  return {
    ok: true,
    warehouses: Array.from(warehouses.values()),
    raw: {
      note: 'No public Noon ListWarehouses endpoint was confirmed. Provide NOON_WAREHOUSE_CODE or select a warehouse code found in raw snapshot data.',
      configuredWarehouseCode: configured || null,
      discoveredFromSnapshotCount: warehouses.size,
    },
  }
}

async function debugNoonStock(partnerSku, warehouse) {
  const normalizedSku = String(partnerSku || '').trim()
  const normalizedWarehouse = String(warehouse || '').trim()
  if (!normalizedSku) {
    throw new Error('partnerSku is required.')
  }
  if (!normalizedWarehouse) {
    throw new Error('warehouse is required for Noon stock-list diagnostics.')
  }

  const requestBody = {
    items: [
      {
        warehouse: normalizedWarehouse,
        partner_sku: normalizedSku,
      },
    ],
  }
  const response = await noonPost(STOCK_LIST_PATH, requestBody)
  return {
    ok: true,
    partnerSku: normalizedSku,
    warehouse: normalizedWarehouse,
    path: STOCK_LIST_PATH,
    requestBody,
    response: response.data,
    normalized: normalizeStockResponse(response.data, {
      partnerSku: normalizedSku,
      warehouse: normalizedWarehouse,
    }),
  }
}

async function syncNoonStockForSkus(options = {}) {
  const countryCode = normalizeCountryCode(options.countryCode || options.country_code)
  const warehouse = String(options.warehouse || '').trim()
  const partnerSkus = Array.isArray(options.partnerSkus) ? options.partnerSkus : []
  const uniqueSkus = Array.from(new Set(partnerSkus.map((sku) => String(sku || '').trim()).filter(Boolean)))
  const results = []
  const errors = []

  if (!warehouse) {
    return {
      ok: false,
      countryCode,
      warehouse,
      requested: 0,
      updated: 0,
      results,
      errors: [{ code: 'NOON_WAREHOUSE_REQUIRED', message: 'warehouse is required.' }],
    }
  }

  for (const partnerSku of uniqueSkus) {
    try {
      const diagnostic = await debugNoonStock(partnerSku, warehouse)
      const updated = await updateNoonProductSnapshotStock({
        partnerSku,
        countryCode,
        stockQuantity: diagnostic.normalized.quantity,
        stockWarehouse: diagnostic.normalized.warehouse || warehouse,
        rawStockJson: diagnostic.response,
      })
      results.push({ partnerSku, diagnostic, updated: Boolean(updated) })
    } catch (error) {
      errors.push({
        partnerSku,
        code: error && error.code ? error.code : 'NOON_STOCK_SYNC_FAILED',
        message: error && error.message ? error.message : 'Stock diagnostic failed.',
        status: error && error.httpStatus ? error.httpStatus : null,
        meta: error && error.meta ? error.meta : undefined,
      })
    }
  }

  return {
    ok: errors.length === 0,
    countryCode,
    warehouse,
    requested: uniqueSkus.length,
    updated: results.filter((result) => result.updated).length,
    results,
    errors,
  }
}

module.exports = {
  auditNoonStockFields,
  debugNoonStock,
  discoverNoonWarehouses,
  syncNoonStockForSkus,
}
