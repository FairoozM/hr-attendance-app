const { fetchItemsRawForWarehouse } = require('../integrations/zoho/zohoAdapter')
const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { normalizeSku } = require('../utils/normalizeSku')
const { expandExactMatchVariants } = require('../utils/purchasePlanningSkuMatcher')
const { _internals: zohoWeeklyInternals } = require('./weeklyReportZohoData')

const parseWarehouseScopedStockOnHand = zohoWeeklyInternals.parseWarehouseScopedStockOnHand

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function normalizeWarehouseName(value) {
  return clean(value).replace(/\s+/g, ' ').toUpperCase()
}

function zohoExpandMatchEnabled() {
  const raw = String(process.env.AMAZON_ZOHO_EXPAND_SKU_MATCH || '1').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'no'
}

async function resolveLifeSmileWarehouse() {
  const configuredId = clean(
    process.env.ZOHO_LIFE_SMILE_WAREHOUSE_ID ||
      process.env.LIFE_SMILE_WAREHOUSE_ID ||
      process.env.PURCHASE_PLANNING_WAREHOUSE_ID
  )
  const configuredNameRaw =
    process.env.ZOHO_LIFE_SMILE_WAREHOUSE_NAME ||
    process.env.PURCHASE_PLANNING_WAREHOUSE_NAME ||
    'Life Smile Warehouse'
  const configuredName = normalizeWarehouseName(configuredNameRaw)
  if (configuredId) {
    return { warehouseId: configuredId, warehouseName: clean(configuredNameRaw) || 'Life Smile Warehouse' }
  }
  const warehouses = await fetchWarehouses()
  const match = warehouses.find((warehouse) => {
    const name = normalizeWarehouseName(warehouse.warehouse_name || warehouse.location_name || warehouse.name)
    return name === configuredName || name === 'LIFE SMILE'
  })
  if (!match) {
    const err = new Error(`Zoho warehouse "${clean(configuredNameRaw) || 'Life Smile Warehouse'}" was not found`)
    err.code = 'ZOHO_LIFE_SMILE_WAREHOUSE_NOT_FOUND'
    throw err
  }
  return {
    warehouseId: clean(match.warehouse_id || match.location_id || match.id),
    warehouseName: clean(match.warehouse_name || match.location_name || match.name),
  }
}

function pickZohoQty(item, keys, fallback = 0) {
  for (const key of keys) {
    const n = toNumber(item?.[key], NaN)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/**
 * Warehouse-scoped qty for Amazon↔Zoho comparison.
 * Uses the same parser as weekly reports so `warehouse_stock_on_hand` wins over
 * `warehouse_actual_available_stock: 0` on the list API response.
 */
function buildZohoStockEntry(item, warehouseName, warehouseId) {
  const sku = clean(item?.sku || item?.item_code || item?.code)
  const normalized = normalizeSku(sku)
  if (!normalized) return null

  const onHand = parseWarehouseScopedStockOnHand(item, warehouseId)
  const forSale = pickZohoQty(
    item,
    [
      'warehouse_available_for_sale_stock',
      'location_available_for_sale_stock',
      'available_for_sale_stock',
      'warehouse_available_stock',
      'location_available_stock',
      'available_stock',
    ],
    NaN
  )
  const availableQty = Number.isFinite(forSale) ? Math.max(forSale, onHand) : onHand
  return {
    itemId: clean(item?.item_id || item?.id),
    sku,
    normalizedSku: normalized,
    itemName: clean(item?.name || item?.item_name),
    itemType: 'item',
    warehouseName,
    availableQty,
    stockStatus: availableQty > 0 ? 'In Stock' : 'Out of Stock',
  }
}

function indexZohoWarehouseItems(items, warehouseName, warehouseId) {
  const byKey = new Map()
  const expand = zohoExpandMatchEnabled()
  for (const item of Array.isArray(items) ? items : []) {
    const entry = buildZohoStockEntry(item, warehouseName, warehouseId)
    if (!entry) continue
    const keys = new Set([entry.normalizedSku, normalizeSku(entry.sku)])
    if (expand) {
      for (const variant of expandExactMatchVariants(entry.sku)) keys.add(variant)
    }
    for (const key of keys) {
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, entry)
    }
  }
  return byKey
}

function buildZohoStockMap(items, skuSet, warehouseName, warehouseId) {
  const index = indexZohoWarehouseItems(items, warehouseName, warehouseId)
  const map = new Map()
  let matchedKeys = 0

  for (const key of skuSet) {
    if (!key) continue
    let hit = index.get(key)
    if (!hit && zohoExpandMatchEnabled()) {
      for (const variant of expandExactMatchVariants(key)) {
        hit = index.get(variant)
        if (hit) break
      }
    }
    if (!hit) continue
    if (!map.has(key)) matchedKeys += 1
    map.set(key, { ...hit, normalizedSku: key })
  }

  return { map, matchedKeys }
}

function zohoMapToRows(zohoBySku) {
  return Array.from(zohoBySku.values())
}

async function fetchZohoStockForSkus({ skus, progress }) {
  const warehouse = await resolveLifeSmileWarehouse()
  progress?.({ step: 'Fetching Zoho Life Smile warehouse stock', current: 0, total: skus.length })

  const skuSet = new Set()
  for (const raw of skus) {
    const base = normalizeSku(raw)
    if (!base) continue
    skuSet.add(base)
    if (zohoExpandMatchEnabled()) {
      for (const variant of expandExactMatchVariants(raw)) skuSet.add(variant)
    }
  }

  const items = await fetchItemsRawForWarehouse(warehouse.warehouseId)
  const { map: zohoBySku, matchedKeys } = buildZohoStockMap(
    items,
    skuSet,
    warehouse.warehouseName,
    warehouse.warehouseId
  )

  return {
    zohoBySku,
    warehouse,
    fetchedAt: new Date().toISOString(),
    matchStats: {
      matched: matchedKeys,
      requested: skuSet.size,
      zohoItemsScanned: Array.isArray(items) ? items.length : 0,
      warehouseId: warehouse.warehouseId,
      warehouseName: warehouse.warehouseName,
    },
  }
}

module.exports = {
  resolveLifeSmileWarehouse,
  buildZohoStockEntry,
  buildZohoStockMap,
  fetchZohoStockForSkus,
  zohoMapToRows,
  normalizeSku,
}
