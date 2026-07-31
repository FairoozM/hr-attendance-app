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
  const itemName = clean(item?.name || item?.item_name)
  if (!sku && !itemName) return null

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
    sku: sku || itemName,
    normalizedSku: normalizeSku(sku) || normalizeSku(itemName),
    itemName,
    itemType: 'item',
    warehouseName,
    availableQty,
    stockStatus: availableQty > 0 ? 'In Stock' : 'Out of Stock',
  }
}

/** Keys used to link Amazon seller SKUs to Zoho rows (barcode SKU vs display name). */
function zohoItemLookupKeys(item, entry) {
  const keys = new Set()
  const add = (raw) => {
    const key = normalizeSku(raw)
    if (key) keys.add(key)
  }

  add(entry.sku)
  add(item?.item_code)
  add(item?.code)
  add(entry.itemName)
  add(item?.name)
  add(item?.item_name)
  add(item?.part_number)

  if (zohoExpandMatchEnabled()) {
    for (const variant of expandExactMatchVariants(entry.sku)) add(variant)
    for (const variant of expandExactMatchVariants(entry.itemName)) add(variant)
  }

  return keys
}

function indexZohoWarehouseItems(items, warehouseName, warehouseId) {
  const byKey = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const entry = buildZohoStockEntry(item, warehouseName, warehouseId)
    if (!entry) continue
    for (const key of zohoItemLookupKeys(item, entry)) {
      if (!byKey.has(key)) byKey.set(key, entry)
    }
  }
  return byKey
}

function lookupZohoEntry(index, amazonKey) {
  let hit = index.get(amazonKey)
  if (hit) return hit
  if (!zohoExpandMatchEnabled()) return null
  for (const variant of expandExactMatchVariants(amazonKey)) {
    hit = index.get(variant)
    if (hit) return hit
  }
  return null
}

function buildZohoStockMap(items, skuSet, warehouseName, warehouseId) {
  const index = indexZohoWarehouseItems(items, warehouseName, warehouseId)
  const map = new Map()
  let matchedKeys = 0

  for (const key of skuSet) {
    if (!key) continue
    const hit = lookupZohoEntry(index, key)
    if (!hit) continue
    if (!map.has(key)) matchedKeys += 1
    const matchedBy =
      normalizeSku(hit.sku) === key
        ? 'zoho_sku'
        : normalizeSku(hit.itemName) === key
          ? 'zoho_item_name'
          : 'zoho_alias'
    map.set(key, {
      ...hit,
      normalizedSku: key,
      matchedBy,
    })
  }

  return { map, matchedKeys }
}

function zohoMapToRows(zohoBySku) {
  return Array.from(zohoBySku.values())
}

async function fetchAllLifeSmileWarehouseStock() {
  const warehouse = await resolveLifeSmileWarehouse()
  const rawItems = await fetchItemsRawForWarehouse(warehouse.warehouseId)
  const rawList = Array.isArray(rawItems) ? rawItems : []
  const index = indexZohoWarehouseItems(rawList, warehouse.warehouseName, warehouse.warehouseId)
  const rows = []
  const seenItemIds = new Set()
  for (const item of rawList) {
    const entry = buildZohoStockEntry(item, warehouse.warehouseName, warehouse.warehouseId)
    if (!entry) continue
    const itemId = entry.itemId || entry.normalizedSku
    if (!itemId || seenItemIds.has(itemId)) continue
    seenItemIds.add(itemId)
    rows.push(entry)
  }
  return {
    warehouse,
    rows,
    rawItems: rawList,
    index,
    fetchedAt: new Date().toISOString(),
    itemCount: rows.length,
    rawItemCount: rawList.length,
  }
}

/** Build Amazon SKU lookup set (normalized + optional exact variants) for warehouse matching. */
function buildAmazonSkuSet(skus) {
  const skuSet = new Set()
  for (const raw of skus || []) {
    const base = normalizeSku(raw)
    if (!base) continue
    skuSet.add(base)
    if (zohoExpandMatchEnabled()) {
      for (const variant of expandExactMatchVariants(raw)) skuSet.add(variant)
    }
  }
  return skuSet
}

async function fetchZohoStockForSkus({ skus, progress }) {
  const warehouse = await resolveLifeSmileWarehouse()
  progress?.({ step: 'Fetching Zoho Life Smile warehouse stock', current: 0, total: skus.length })

  const skuSet = buildAmazonSkuSet(skus)
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

/**
 * Match Amazon SKUs against an already-fetched Life Smile warehouse dump (avoids a second Zoho scan).
 */
function matchZohoStockFromWarehouseDump({ warehouseStock, skus }) {
  const warehouse = warehouseStock?.warehouse || {}
  const rawItems = Array.isArray(warehouseStock?.rawItems) ? warehouseStock.rawItems : []
  const skuSet = buildAmazonSkuSet(skus)
  const { map: zohoBySku, matchedKeys } = buildZohoStockMap(
    rawItems,
    skuSet,
    warehouse.warehouseName,
    warehouse.warehouseId
  )
  return {
    zohoBySku,
    warehouse,
    fetchedAt: warehouseStock?.fetchedAt || new Date().toISOString(),
    matchStats: {
      matched: matchedKeys,
      requested: skuSet.size,
      zohoItemsScanned: rawItems.length,
      warehouseId: warehouse.warehouseId,
      warehouseName: warehouse.warehouseName,
    },
  }
}

module.exports = {
  resolveLifeSmileWarehouse,
  buildZohoStockEntry,
  zohoItemLookupKeys,
  indexZohoWarehouseItems,
  buildZohoStockMap,
  buildAmazonSkuSet,
  fetchAllLifeSmileWarehouseStock,
  fetchZohoStockForSkus,
  matchZohoStockFromWarehouseDump,
  lookupZohoEntry,
  zohoMapToRows,
  normalizeSku,
}
