/**
 * Inventory Health & Dead Stock — fast V1 (items + sales-by-item only).
 * No invoice history, last-sold dates, or per-SKU Zoho calls on the main path.
 */

const { fetchAllItemsRaw, fetchItemsRawForWarehouse } = require('../integrations/zoho/zohoAdapter')
const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const { parseFamilyFromZohoItem } = require('../integrations/zoho/zohoItemFamily')
const { getSales } = require('../integrations/zoho/weeklyReportZohoTransactions')
const { _internals: zohoWeeklyInternals } = require('./weeklyReportZohoData')
const { listMembersOfGroup } = require('./itemReportGroupsService')
const { attachImageFieldsToRows, getImageCacheDebugInfo } = require('./inventoryItemImageStore')
const { readDiskCacheEntry, writeDiskCacheEntry, clearDiskCache } = require('./inventoryHealthDiskCache')

const SLOW_MOVING_GROUP = 'slow_moving'
const ZERO_SALES_MONTHS_OF_COVER = 999
const CACHE_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.INVENTORY_HEALTH_CACHE_TTL_MS || String(6 * 60 * 60 * 1000), 10) || 6 * 60 * 60 * 1000,
)
const MIN_CACHE_ACTIVE_ITEMS = Math.max(
  10,
  parseInt(process.env.INVENTORY_HEALTH_MIN_CACHE_ITEMS || '100', 10) || 100,
)

const parseWarehouseScopedStockOnHand = zohoWeeklyInternals.parseWarehouseScopedStockOnHand
const parseZohoUnitPurchasePrice = zohoWeeklyInternals.parseZohoUnitPurchasePrice
const parseQty = zohoWeeklyInternals.parseQty

/** @type {Map<string, { expiresAt: number, value: object, error?: string }>} */
const _dashboardCache = new Map()
/** @type {Map<string, Promise<object>>} */
const _dashboardInFlight = new Map()

function isoDateDaysAgo(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - Math.max(0, Number(days) || 0))
  return d.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function normalizeSkuKey(sku) {
  return String(sku || '').trim().toLowerCase()
}

function isActiveZohoItem(item) {
  if (!item || typeof item !== 'object') return false
  const st = String(item.status || '').trim().toLowerCase()
  return !st || st === 'active'
}

function parseAvailableStockQty(item, warehouseId = null) {
  if (!item || typeof item !== 'object') return 0
  for (const k of [
    'actual_available_for_sale_stock',
    'available_for_sale',
    'warehouse_available_for_sale_stock',
    'location_available_for_sale',
    'actual_available_stock',
    'available_stock',
  ]) {
    const n = parseQty(item[k])
    if (Number.isFinite(n)) return Math.max(0, n)
  }
  return parseWarehouseScopedStockOnHand(item, warehouseId)
}

function aggregateSalesLines(lines) {
  const byItemId = new Map()
  const bySku = new Map()
  for (const line of lines || []) {
    const qty = Math.max(0, parseQty(line.quantity))
    if (qty <= 0) continue
    const itemId = line.item_id != null ? String(line.item_id).trim() : ''
    const sku = normalizeSkuKey(line.sku)
    if (itemId) byItemId.set(itemId, (byItemId.get(itemId) || 0) + qty)
    if (sku) bySku.set(sku, (bySku.get(sku) || 0) + qty)
  }
  return { byItemId, bySku }
}

function lookupSalesQty(maps, itemId, sku) {
  const id = itemId != null ? String(itemId).trim() : ''
  if (id && maps.byItemId.has(id)) return maps.byItemId.get(id)
  const sk = normalizeSkuKey(sku)
  if (sk && maps.bySku.has(sk)) return maps.bySku.get(sk)
  return 0
}

/** V1: zero avg monthly sales with stock → 999 months cover sentinel. */
function computeMonthsOfCover(currentStockQty, avgMonthlySales180) {
  const stock = Math.max(0, Number(currentStockQty) || 0)
  const avg = Number(avgMonthlySales180) || 0
  if (stock <= 0) return 0
  if (avg <= 0) return ZERO_SALES_MONTHS_OF_COVER
  return round2(stock / avg)
}

function computeSellThroughRate180(salesQty180, currentStockQty) {
  const sold = Math.max(0, Number(salesQty180) || 0)
  const stock = Math.max(0, Number(currentStockQty) || 0)
  const denom = sold + stock
  if (denom <= 0) return 0
  return round2(sold / denom)
}

function classifyRiskClassV1({ currentStockQty, salesQty180, monthsOfCover }) {
  const stock = Math.max(0, Number(currentStockQty) || 0)
  const sold180 = Math.max(0, Number(salesQty180) || 0)
  const cover = Number(monthsOfCover) || 0

  if (stock > 0 && sold180 === 0) return 'Dead Stock'
  if (cover >= 24) return 'Dead Stock'
  if (cover >= 12) return 'Slow Moving'
  if (stock > 0 && sold180 <= 2) return 'Slow Moving'
  if (cover >= 6) return 'Watch'
  return 'Healthy'
}

function computeRiskScoreV1({
  currentStockQty,
  salesQty180,
  monthsOfCover,
  inventoryValue,
  familyType,
  riskClass,
}) {
  let score = 0
  const stock = Math.max(0, Number(currentStockQty) || 0)
  const sold180 = Math.max(0, Number(salesQty180) || 0)
  const cover = Number(monthsOfCover) || 0
  const value = Number(inventoryValue) || 0

  if (stock > 0 && sold180 === 0) score += 60
  if (cover >= 24) score += 30
  else if (cover >= 12) score += 20
  else if (cover >= 6) score += 10

  if (value >= 5000) score += 20
  else if (value >= 1000) score += 10

  if (
    familyType === 'Other' &&
    (riskClass === 'Slow Moving' || riskClass === 'Dead Stock')
  ) {
    score += 10
  }

  return Math.min(100, Math.max(0, Math.round(score)))
}

function normalizeRiskClassFilter(value) {
  const v = String(value || 'all').trim().toLowerCase().replace(/\s+/g, '_')
  if (v === 'all') return 'all'
  if (v === 'healthy') return 'Healthy'
  if (v === 'watch') return 'Watch'
  if (v === 'slow_moving' || v === 'slowmoving') return 'Slow Moving'
  if (v === 'dead_stock' || v === 'deadstock') return 'Dead Stock'
  return 'all'
}

/**
 * V1 inventory health metrics (pure, testable).
 * @param {object} input
 */
function computeInventoryHealthMetrics(input) {
  const currentStockQty = Math.max(0, Number(input.currentStockQty) || 0)
  const salesQty90 = Math.max(0, Number(input.salesQty90) || 0)
  const salesQty180 = Math.max(0, Number(input.salesQty180) || 0)
  const salesQty365 = Math.max(0, Number(input.salesQty365) || 0)
  const purchaseRate = Math.max(0, Number(input.purchaseRate) || 0)
  const inventoryValue = round2(currentStockQty * purchaseRate)
  const familyType = input.familyType === 'Slow Moving' ? 'Slow Moving' : 'Other'

  const avgMonthlySales180 = round2(salesQty180 / 6)
  const monthsOfCover = computeMonthsOfCover(currentStockQty, avgMonthlySales180)
  const sellThroughRate180 = computeSellThroughRate180(salesQty180, currentStockQty)

  const riskClass = classifyRiskClassV1({ currentStockQty, salesQty180, monthsOfCover })
  const riskScore = computeRiskScoreV1({
    currentStockQty,
    salesQty180,
    monthsOfCover,
    inventoryValue,
    familyType,
    riskClass,
  })

  const tags = []
  if (currentStockQty > 0 && salesQty180 === 0) tags.push('Zero Sales 180')
  if (monthsOfCover >= 12 && salesQty180 > 0) tags.push('Overstock Risk')
  if (familyType === 'Slow Moving') tags.push('Slow Family')
  if (inventoryValue >= 1000 && (salesQty180 === 0 || monthsOfCover >= 12)) {
    tags.push('High Value Risk')
  }

  const hiddenSlowMoving =
    familyType === 'Other' && (riskClass === 'Slow Moving' || riskClass === 'Dead Stock')

  if (hiddenSlowMoving) tags.push('Hidden Slow Moving')
  if (riskClass === 'Dead Stock') tags.push('Dead Stock')
  else if (riskClass === 'Slow Moving') tags.push('Slow Moving')

  const reason = buildReasonV1({
    riskClass,
    hiddenSlowMoving,
    salesQty180,
    monthsOfCover,
    inventoryValue,
    currentStockQty,
  })

  const recommendedAction = pickRecommendedActionV1(riskClass)

  return {
    sku: input.sku || '',
    itemId: input.itemId || '',
    itemName: input.itemName || '',
    familyName: input.familyName || '',
    familyType,
    currentStockQty,
    availableStockQty: Math.max(0, Number(input.availableStockQty) || 0),
    purchaseRate,
    inventoryValue,
    salesQty90,
    salesQty180,
    salesQty365,
    avgMonthlySales180,
    monthsOfCover,
    sellThroughRate180,
    riskScore,
    riskClass,
    tags: [...new Set(tags)],
    reason,
    recommendedAction,
    hiddenSlowMoving,
  }
}

function buildReasonV1(ctx) {
  const reasons = []
  if (ctx.currentStockQty > 0 && ctx.salesQty180 === 0) {
    reasons.push('No sales in last 180 days while stock is available')
  }
  if (ctx.monthsOfCover >= 12) {
    reasons.push('Stock cover is above 12 months')
  } else if (ctx.monthsOfCover >= 6) {
    reasons.push('Stock cover is above 6 months')
  }
  if (ctx.inventoryValue >= 1000 && ctx.salesQty180 <= 2) {
    reasons.push('High inventory value with weak sales')
  }
  if (ctx.hiddenSlowMoving) {
    reasons.push('Hidden risk inside normal family')
  }
  if (reasons.length === 0) {
    return 'Sales velocity and stock cover are within normal range'
  }
  return reasons.join('. ') + '.'
}

function pickRecommendedActionV1(riskClass) {
  if (riskClass === 'Dead Stock') {
    return 'Create clearance offer or move to wholesale liquidation'
  }
  if (riskClass === 'Slow Moving') {
    return 'Run coupon/deal and stop reordering'
  }
  if (riskClass === 'Watch') {
    return 'Monitor before next purchase'
  }
  return 'No action needed'
}

function buildSlowMovingSkuSet(members) {
  const set = new Set()
  for (const m of members || []) {
    const sku = normalizeSkuKey(m.sku)
    if (sku) set.add(sku)
    const id = m.item_id != null ? String(m.item_id).trim() : ''
    if (id) set.add(`id:${id}`)
  }
  return set
}

function isSlowMovingFamilyMember(slowSet, itemId, sku) {
  const sk = normalizeSkuKey(sku)
  if (sk && slowSet.has(sk)) return true
  const id = itemId != null ? String(itemId).trim() : ''
  if (id && slowSet.has(`id:${id}`)) return true
  return false
}

function buildSummary(rows, meta = {}) {
  let totalStockQty = 0
  let totalInventoryValue = 0
  let deadStockCount = 0
  let deadStockValue = 0
  let slowMovingCount = 0
  let slowMovingValue = 0
  let hiddenSlowMovingCount = 0
  let hiddenSlowMovingValue = 0
  let zeroSales180Count = 0
  let zeroSales365Count = 0
  const familyRisk = new Map()

  for (const row of rows) {
    totalStockQty += row.currentStockQty || 0
    totalInventoryValue += row.inventoryValue || 0

    if (row.riskClass === 'Dead Stock') {
      deadStockCount += 1
      deadStockValue += row.inventoryValue || 0
    }
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      slowMovingCount += 1
      slowMovingValue += row.inventoryValue || 0
    }
    if (row.hiddenSlowMoving) {
      hiddenSlowMovingCount += 1
      hiddenSlowMovingValue += row.inventoryValue || 0
    }
    if (row.currentStockQty > 0 && row.salesQty180 === 0) zeroSales180Count += 1
    if (row.currentStockQty > 0 && row.salesQty365 === 0) zeroSales365Count += 1

    const fam = row.familyName || '(No family)'
    const fr = familyRisk.get(fam) || { familyName: fam, value: 0, count: 0 }
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      fr.value += row.inventoryValue || 0
      fr.count += 1
    }
    familyRisk.set(fam, fr)
  }

  let topRiskFamily = null
  for (const fr of familyRisk.values()) {
    if (!topRiskFamily || fr.value > topRiskFamily.value) topRiskFamily = fr
  }

  return {
    totalItemsChecked: rows.length,
    totalStockQty: round2(totalStockQty),
    totalInventoryValue: round2(totalInventoryValue),
    deadStockCount,
    deadStockValue: round2(deadStockValue),
    slowMovingCount,
    slowMovingValue: round2(slowMovingValue),
    hiddenSlowMovingCount,
    hiddenSlowMovingValue: round2(hiddenSlowMovingValue),
    zeroSales180Count,
    zeroSales365Count,
    topRiskFamily: topRiskFamily
      ? {
          familyName: topRiskFamily.familyName,
          riskValue: round2(topRiskFamily.value),
          riskSkuCount: topRiskFamily.count,
        }
      : null,
    generatedAt: meta.generatedAt || new Date().toISOString(),
    cacheStatus: meta.cacheStatus || 'miss',
    warnings: meta.warnings || [],
  }
}

function buildFamilyMoneyFrozen(rows) {
  const byFamily = new Map()
  for (const row of rows) {
    const fam = row.familyName || '(No family)'
    const entry = byFamily.get(fam) || {
      familyName: fam,
      totalInventoryValue: 0,
      deadStockValue: 0,
      hiddenSlowMovingValue: 0,
      numberOfRiskSkus: 0,
    }
    entry.totalInventoryValue += row.inventoryValue || 0
    if (row.riskClass === 'Dead Stock') entry.deadStockValue += row.inventoryValue || 0
    if (row.hiddenSlowMoving) entry.hiddenSlowMovingValue += row.inventoryValue || 0
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      entry.numberOfRiskSkus += 1
    }
    byFamily.set(fam, entry)
  }
  return [...byFamily.values()]
    .map((e) => ({
      familyName: e.familyName,
      totalInventoryValue: round2(e.totalInventoryValue),
      deadStockValue: round2(e.deadStockValue),
      hiddenSlowMovingValue: round2(e.hiddenSlowMovingValue),
      numberOfRiskSkus: e.numberOfRiskSkus,
    }))
    .sort((a, b) => b.totalInventoryValue - a.totalInventoryValue)
}

function cacheKeyForBase(warehouseId) {
  return `wh:${warehouseId || 'all'}`
}

/** Reject test/tiny payloads that must never serve production (e.g. single "Widget" row). */
function isPlausibleCachePayload(value) {
  if (!value || !Array.isArray(value.rows) || value.rows.length === 0) return false
  const active = Number(value.debug?.activeItemsFetched) || value.rows.length
  if (active < MIN_CACHE_ACTIVE_ITEMS) {
    console.warn(
      `[inventory-health] rejecting cache with ${active} active items (min ${MIN_CACHE_ACTIVE_ITEMS})`,
    )
    return false
  }
  return true
}

function invalidateBadCacheEntry(key) {
  _dashboardCache.delete(key)
  clearDiskCache()
}

function applyRowFilters(rows, filters) {
  let out = rows

  if (!filters.includeZeroStock) {
    out = out.filter((r) => r.currentStockQty >= (filters.minStockQty || 1))
  } else if (filters.minStockQty > 0) {
    out = out.filter((r) => r.currentStockQty >= filters.minStockQty)
  }

  if (filters.minInventoryValue != null && Number.isFinite(filters.minInventoryValue)) {
    out = out.filter((r) => r.inventoryValue >= filters.minInventoryValue)
  }

  if (filters.familyType === 'slow_moving') {
    out = out.filter((r) => r.familyType === 'Slow Moving')
  } else if (filters.familyType === 'other') {
    out = out.filter((r) => r.familyType === 'Other')
  }

  const rc = normalizeRiskClassFilter(filters.riskClass)
  if (rc !== 'all') {
    out = out.filter((r) => r.riskClass === rc)
  }

  if (filters.hiddenOnly) {
    out = out.filter((r) => r.hiddenSlowMoving)
  }

  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase()
    out = out.filter(
      (r) =>
        String(r.sku || '').toLowerCase().includes(q) ||
        String(r.itemName || '').toLowerCase().includes(q) ||
        String(r.familyName || '').toLowerCase().includes(q),
    )
  }

  return out
}

function sortRows(rows, sortBy, sortDirection) {
  const dir = String(sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1
  const key = String(sortBy || 'riskScore')
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const getters = {
    riskScore: (r) => r.riskScore,
    inventoryValue: (r) => r.inventoryValue,
    monthsOfCover: (r) => Number(r.monthsOfCover) || 0,
    sku: (r) => r.sku,
    itemName: (r) => r.itemName,
    familyName: (r) => r.familyName,
  }
  const get = getters[key] || getters.riskScore

  return [...rows].sort((a, b) => {
    const av = get(a)
    const bv = get(b)
    if (typeof av === 'string' || typeof bv === 'string') {
      return collator.compare(String(av), String(bv)) * dir
    }
    if (av === bv) return 0
    return av > bv ? dir : -dir
  })
}

function emptyDebug() {
  return {
    itemsFetched: 0,
    activeItemsFetched: 0,
    stockItemsIncluded: 0,
    sales90RowsFetched: 0,
    sales180RowsFetched: 0,
    sales365RowsFetched: 0,
    zohoCallCountApprox: 0,
    timingsMs: {
      items: 0,
      sales90: 0,
      sales180: 0,
      sales365: 0,
      processing: 0,
      total: 0,
    },
    mode: 'fast_items_sales_only',
  }
}

async function loadInventoryHealthBase({ warehouseId = null, refresh = false } = {}) {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    const err = new Error('Zoho is not configured')
    err.code = 'ZOHO_NOT_CONFIGURED'
    throw err
  }

  const key = cacheKeyForBase(warehouseId)
  if (!refresh) {
    const hit = _dashboardCache.get(key)
    if (hit && Date.now() < hit.expiresAt && !hit.error) {
      if (isPlausibleCachePayload(hit.value)) {
        return { ...hit.value, cacheStatus: 'hit' }
      }
      invalidateBadCacheEntry(key)
    }
    if (hit && hit.error && Date.now() < hit.expiresAt) {
      const err = new Error(hit.error)
      err.code = 'INVENTORY_HEALTH_CACHE_ERROR'
      throw err
    }
    const diskHit = readDiskCacheEntry(key)
    if (diskHit) {
      if (isPlausibleCachePayload(diskHit.value)) {
        _dashboardCache.set(key, diskHit)
        return { ...diskHit.value, cacheStatus: 'disk' }
      }
      console.warn('[inventory-health] ignoring invalid disk cache — will refetch from Zoho')
      invalidateBadCacheEntry(key)
    }
  }

  if (_dashboardInFlight.has(key)) {
    const v = await _dashboardInFlight.get(key)
    return { ...v, cacheStatus: refresh ? 'refresh' : v.cacheStatus || 'shared' }
  }

  const promise = (async () => {
    const tTotal = Date.now()
    const warnings = []
    const asOfDate = todayIso()
    const from365 = isoDateDaysAgo(365)
    const from180 = isoDateDaysAgo(180)
    const from90 = isoDateDaysAgo(90)
    const whOpts = warehouseId ? { warehouseId: String(warehouseId) } : {}
    const debug = emptyDebug()

    const tItems = Date.now()
    const tSalesParallel = Date.now()
    const [rawItems, sales90R, sales180R, sales365R, slowMembers] = await Promise.all([
      warehouseId
        ? fetchItemsRawForWarehouse(String(warehouseId))
        : fetchAllItemsRaw(),
      getSales(from90, asOfDate, whOpts),
      getSales(from180, asOfDate, whOpts),
      getSales(from365, asOfDate, whOpts),
      listMembersOfGroup(SLOW_MOVING_GROUP).catch(() => []),
    ])
    debug.timingsMs.items = Date.now() - tItems
    debug.timingsMs.sales90 = Date.now() - tSalesParallel
    debug.timingsMs.sales180 = debug.timingsMs.sales90
    debug.timingsMs.sales365 = debug.timingsMs.sales90
    debug.itemsFetched = Array.isArray(rawItems) ? rawItems.length : 0

    const activeItems = (rawItems || []).filter(isActiveZohoItem)
    debug.activeItemsFetched = activeItems.length
    debug.sales90RowsFetched = Array.isArray(sales90R.lines) ? sales90R.lines.length : 0
    debug.sales180RowsFetched = Array.isArray(sales180R.lines) ? sales180R.lines.length : 0
    debug.sales365RowsFetched = Array.isArray(sales365R.lines) ? sales365R.lines.length : 0

    if (sales90R.list_truncated) {
      warnings.push('Sales (90d) list may be incomplete due to pagination cap.')
    }
    if (sales180R.list_truncated) {
      warnings.push('Sales (180d) list may be incomplete due to pagination cap.')
    }
    if (sales365R.list_truncated) {
      warnings.push('Sales (365d) list may be incomplete due to pagination cap.')
    }

    const tProcessing = Date.now()
    const sales90 = aggregateSalesLines(sales90R.lines)
    const sales180 = aggregateSalesLines(sales180R.lines)
    const sales365 = aggregateSalesLines(sales365R.lines)
    const slowSet = buildSlowMovingSkuSet(slowMembers)
    const familyFieldId = cfg.familyCustomFieldId

    const rows = []
    for (const item of activeItems) {
      const itemId = item.item_id != null ? String(item.item_id).trim() : ''
      const sku = item.sku != null ? String(item.sku).trim() : ''
      const itemName = item.name != null ? String(item.name).trim() : ''
      const familyName = parseFamilyFromZohoItem(item, familyFieldId)
      const familyType = isSlowMovingFamilyMember(slowSet, itemId, sku) ? 'Slow Moving' : 'Other'
      const currentStockQty = parseWarehouseScopedStockOnHand(item, warehouseId)
      const availableStockQty = parseAvailableStockQty(item, warehouseId)
      const purchaseRate = parseZohoUnitPurchasePrice(item) || parseQty(item.rate) || 0

      rows.push(
        computeInventoryHealthMetrics({
          sku,
          itemId,
          itemName,
          familyName,
          familyType,
          currentStockQty,
          availableStockQty,
          purchaseRate,
          salesQty90: lookupSalesQty(sales90, itemId, sku),
          salesQty180: lookupSalesQty(sales180, itemId, sku),
          salesQty365: lookupSalesQty(sales365, itemId, sku),
        }),
      )
    }

    debug.stockItemsIncluded = rows.filter((r) => r.currentStockQty > 0).length
    debug.timingsMs.processing = Date.now() - tProcessing
    debug.timingsMs.total = Date.now() - tTotal
    debug.zohoCallCountApprox =
      Math.ceil(debug.itemsFetched / 200) + (sales90R.list_pages || 1) + (sales180R.list_pages || 1) + (sales365R.list_pages || 1)

    console.log(
      `[inventory-health] mode=${debug.mode} items=${debug.activeItemsFetched} stock=${debug.stockItemsIncluded} ` +
        `ms(items=${debug.timingsMs.items} sales90=${debug.timingsMs.sales90} sales180=${debug.timingsMs.sales180} ` +
        `sales365=${debug.timingsMs.sales365} processing=${debug.timingsMs.processing} total=${debug.timingsMs.total})`,
    )

    const payload = {
      rows,
      warnings,
      debug,
      asOfDate,
      warehouseId: warehouseId || null,
      generatedAt: new Date().toISOString(),
      cacheStatus: refresh ? 'refresh' : 'miss',
    }

    _dashboardCache.set(key, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: payload,
      error: null,
    })
    writeDiskCacheEntry(key, Date.now() + CACHE_TTL_MS, payload)

    return payload
  })()
    .catch((err) => {
      _dashboardCache.set(key, {
        expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 5 * 60 * 1000),
        value: null,
        error: err && err.message ? err.message : String(err),
      })
      throw err
    })
    .finally(() => {
      _dashboardInFlight.delete(key)
    })

  _dashboardInFlight.set(key, promise)
  return promise
}

function parseFilters(query = {}) {
  const minStockQtyRaw = query.minStockQty
  const minInvRaw = query.minInventoryValue
  return {
    warehouseId: query.warehouseId ? String(query.warehouseId).trim() : null,
    familyType: String(query.familyType || 'all').trim().toLowerCase(),
    riskClass: String(query.riskClass || 'all').trim(),
    hiddenOnly: query.hiddenOnly === true || query.hiddenOnly === 'true' || query.hiddenOnly === '1',
    minStockQty:
      minStockQtyRaw != null && String(minStockQtyRaw).trim() !== ''
        ? Math.max(0, parseInt(String(minStockQtyRaw), 10) || 1)
        : 1,
    minInventoryValue:
      minInvRaw != null && String(minInvRaw).trim() !== '' ? parseFloat(String(minInvRaw)) : null,
    salesWindowDays: Math.max(30, parseInt(String(query.salesWindowDays || '180'), 10) || 180),
    includeZeroStock:
      query.includeZeroStock === true ||
      query.includeZeroStock === 'true' ||
      query.includeZeroStock === '1',
    sortBy: String(query.sortBy || 'riskScore').trim(),
    sortDirection: String(query.sortDirection || 'desc').trim(),
    search: String(query.search || '').trim(),
    refresh: query.refresh === true || query.refresh === 'true' || query.refresh === '1',
    includeImages:
      query.includeImages === true ||
      query.includeImages === 'true' ||
      query.includeImages === '1',
  }
}

async function getInventoryHealthDashboard(query = {}) {
  const filters = parseFilters(query)
  const base = await loadInventoryHealthBase({
    warehouseId: filters.warehouseId,
    refresh: filters.refresh,
  })

  const filtered = applyRowFilters(base.rows, filters)
  const sorted = sortRows(filtered, filters.sortBy, filters.sortDirection)
  const rowsWithImages = filters.includeImages
    ? await attachImageFieldsToRows(sorted)
    : sorted.map((row) => ({
        ...row,
        imageUrl: null,
        imageSource: null,
        imageCachedAt: null,
        imageMissing: true,
      }))
  const summary = buildSummary(rowsWithImages, {
    generatedAt: base.generatedAt,
    cacheStatus: base.cacheStatus,
    warnings: base.warnings,
  })

  const debug = { ...(base.debug || emptyDebug()) }
  if (filters.includeImages) {
    debug.imageCache = await getImageCacheDebugInfo()
  }

  return {
    summary,
    debug,
    rows: rowsWithImages,
    familyMoneyFrozen: buildFamilyMoneyFrozen(rowsWithImages),
    filters,
    warehouseId: base.warehouseId,
    asOfDate: base.asOfDate,
  }
}

function rowsToCsv(rows) {
  const headers = [
    'sku',
    'itemId',
    'itemName',
    'familyName',
    'familyType',
    'currentStockQty',
    'availableStockQty',
    'purchaseRate',
    'inventoryValue',
    'salesQty90',
    'salesQty180',
    'salesQty365',
    'avgMonthlySales180',
    'monthsOfCover',
    'sellThroughRate180',
    'riskScore',
    'riskClass',
    'hiddenSlowMoving',
    'tags',
    'reason',
    'recommendedAction',
    'imageUrl',
    'imageSource',
    'imageMissing',
  ]

  function esc(v) {
    const s = v == null ? '' : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => {
          if (h === 'tags') return esc(Array.isArray(r.tags) ? r.tags.join('; ') : '')
          if (h === 'hiddenSlowMoving') return r.hiddenSlowMoving ? 'true' : 'false'
          if (h === 'imageMissing') return r.imageMissing ? 'true' : 'false'
          return esc(r[h])
        })
        .join(','),
    )
  }
  return lines.join('\n')
}

function clearInventoryHealthCache() {
  _dashboardCache.clear()
  _dashboardInFlight.clear()
  clearDiskCache()
}

module.exports = {
  getInventoryHealthDashboard,
  loadInventoryHealthBase,
  rowsToCsv,
  clearInventoryHealthCache,
  parseFilters,
  computeInventoryHealthMetrics,
  buildSummary,
  computeMonthsOfCover,
  aggregateSalesLines,
  applyRowFilters,
  classifyRiskClassV1,
  computeRiskScoreV1,
  ZERO_SALES_MONTHS_OF_COVER,
  _internals: {
    buildFamilyMoneyFrozen,
    sortRows,
    isActiveZohoItem,
    emptyDebug,
  },
}
