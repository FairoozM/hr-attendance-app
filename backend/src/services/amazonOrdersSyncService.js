/**
 * Amazon orders cache sync — guarded live calls, DB cache, PII-safe payloads only.
 *
 * Manual / scheduled sync here is for **controlled refresh and reconciliation** — not a substitute
 * for high-frequency polling. When Amazon supports event notifications for your use case, prefer
 * Notifications API → SQS/EventBridge → worker (see `amazonNotificationIngestionService` placeholder
 * and `backend/docs/amazon-spapi-architecture.md`).
 */

const {
  getAmazonOrders,
  getAmazonOrderItems,
  mapAmazonOrderItemSafe,
  normalizeMarketplaceKey,
  getAmazonConfig,
  describeAmazonSpApiFailure,
} = require('./amazonSpApiService')
const rate = require('./amazonRateLimitService')
const cache = require('./amazonOrdersCacheStore')
const { enrichOrdersWithPrimaryItemImages } = require('./amazonSkuImageService')
const {
  MAX_SYNC_RANGE_DAYS,
  MAX_ORDER_ITEMS_ENRICH_PER_SYNC,
  SYNC_CREATED_BEFORE_BUFFER_MS,
} = require('../config/amazonSpApiGuardrails')

const MAX_RANGE_MS = MAX_SYNC_RANGE_DAYS * 24 * 60 * 60 * 1000
const MAX_ORDER_ITEMS_FETCH = MAX_ORDER_ITEMS_ENRICH_PER_SYNC
const MS_BEFORE_NOW = SYNC_CREATED_BEFORE_BUFFER_MS

function iso8601Z(d) {
  if (typeof d === 'string') {
    const parsed = new Date(d)
    if (!Number.isNaN(parsed.getTime())) return iso8601Z(parsed)
    return d
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseDateInput(v) {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function buildDefaultDateWindow() {
  const now = Date.now()
  const createdBefore = new Date(now - MS_BEFORE_NOW)
  const createdAfter = new Date(now - MAX_RANGE_MS)
  return { createdAfter, createdBefore }
}

function validateDateRange(createdAfter, createdBefore) {
  if (!createdAfter || !createdBefore) {
    const err = new Error('createdAfter and createdBefore are required for sync')
    err.code = 'AMAZON_SYNC_VALIDATION'
    throw err
  }
  if (createdBefore.getTime() <= createdAfter.getTime()) {
    const err = new Error('createdBefore must be after createdAfter')
    err.code = 'AMAZON_SYNC_VALIDATION'
    throw err
  }
  const span = createdBefore.getTime() - createdAfter.getTime()
  if (span > MAX_RANGE_MS + 60_000) {
    const err = new Error('Date range cannot exceed 7 days for Amazon sync')
    err.code = 'AMAZON_SYNC_RANGE'
    throw err
  }
}

function extractOrdersFromPayload(data) {
  if (!data || typeof data !== 'object' || data.payload == null) return []
  const pl = data.payload
  if (Array.isArray(pl.Orders)) return pl.Orders
  return []
}

function extractOrderItemsFromPayload(data) {
  if (!data || typeof data !== 'object' || data.payload == null) return []
  const pl = data.payload
  if (Array.isArray(pl.OrderItems)) return pl.OrderItems
  return []
}

const SAFE_ORDER_JSON_KEYS = [
  'AmazonOrderId',
  'PurchaseDate',
  'OrderStatus',
  'FulfillmentChannel',
  'SalesChannel',
  'OrderTotal',
  'NumberOfItemsShipped',
  'NumberOfItemsUnshipped',
  'MarketplaceId',
]

function buildRawSafeOrder(order) {
  if (!order || typeof order !== 'object') return {}
  const out = {}
  for (const k of SAFE_ORDER_JSON_KEYS) {
    if (Object.prototype.hasOwnProperty.call(order, k)) out[k] = order[k]
  }
  return out
}

function orderRowFromAmazon(order, marketplaceKey, marketplaceId, itemsSyncPending, lastSyncedAt) {
  const oid = order.AmazonOrderId != null ? String(order.AmazonOrderId).trim() : ''
  if (!oid) return null
  const ot = order.OrderTotal
  let currencyCode = null
  let orderAmount = null
  if (ot && typeof ot === 'object') {
    if (ot.CurrencyCode) currencyCode = String(ot.CurrencyCode).trim().slice(0, 8) || null
    const amt = ot.Amount
    const n = typeof amt === 'string' ? parseFloat(amt.replace(/,/g, '')) : Number(amt)
    if (Number.isFinite(n)) orderAmount = n
  }
  let purchaseDate = null
  if (order.PurchaseDate) {
    const pd = new Date(String(order.PurchaseDate))
    if (!Number.isNaN(pd.getTime())) purchaseDate = pd
  }
  return {
    marketplaceKey,
    marketplaceId: marketplaceId || null,
    amazonOrderId: oid,
    purchaseDate,
    orderStatus: order.OrderStatus != null ? String(order.OrderStatus).slice(0, 64) : null,
    fulfillmentChannel:
      order.FulfillmentChannel != null ? String(order.FulfillmentChannel).slice(0, 32) : null,
    salesChannel: order.SalesChannel != null ? String(order.SalesChannel).slice(0, 2000) : null,
    currencyCode,
    orderAmount,
    numberOfItemsShipped:
      order.NumberOfItemsShipped != null ? parseInt(String(order.NumberOfItemsShipped), 10) : null,
    numberOfItemsUnshipped:
      order.NumberOfItemsUnshipped != null ? parseInt(String(order.NumberOfItemsUnshipped), 10) : null,
    itemsSyncPending: Boolean(itemsSyncPending),
    rawSafeJson: buildRawSafeOrder(order),
    lastSyncedAt,
  }
}

async function persistOrderItemsFromPayload(marketplaceKey, amazonOrderId, data, lastSyncedAt) {
  const rawItems = extractOrderItemsFromPayload(data)
  await cache.deleteOrderItemsForOrder(marketplaceKey, amazonOrderId)
  for (let idx = 0; idx < rawItems.length; idx += 1) {
    const row = rawItems[idx]
    const safe = mapAmazonOrderItemSafe(row)
    if (!safe) continue
    const oiid =
      row.OrderItemId != null && String(row.OrderItemId).trim()
        ? String(row.OrderItemId).trim().slice(0, 64)
        : `row-${idx}`
    const ip = safe.ItemPrice
    let itemCurrencyCode = null
    let itemAmount = null
    if (ip && typeof ip === 'object') {
      if (ip.CurrencyCode) itemCurrencyCode = String(ip.CurrencyCode).slice(0, 8)
      const a = ip.Amount
      const n = typeof a === 'string' ? parseFloat(String(a).replace(/,/g, '')) : Number(a)
      if (Number.isFinite(n)) itemAmount = n
    }
    await cache.insertAmazonOrderItem({
      marketplaceKey,
      amazonOrderId,
      amazonOrderItemId: oiid,
      asin: safe.ASIN != null ? String(safe.ASIN).slice(0, 32) : null,
      sellerSku: safe.SellerSKU != null ? String(safe.SellerSKU).slice(0, 512) : null,
      title: safe.Title != null ? String(safe.Title) : null,
      quantityOrdered:
        safe.QuantityOrdered != null ? parseInt(String(safe.QuantityOrdered), 10) : null,
      quantityShipped:
        safe.QuantityShipped != null ? parseInt(String(safe.QuantityShipped), 10) : null,
      itemCurrencyCode,
      itemAmount,
      rawSafeJson: safe,
      lastSyncedAt,
    })
  }
  return rawItems.length
}

/**
 * Read cached orders + items (no live Amazon).
 */
async function getCachedAmazonOrders({
  marketplaceKey,
  createdAfter = null,
  createdBefore = null,
  limit = 100,
  offset = 0,
  includeSkuImages = true,
}) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const cfg = getAmazonConfig(mk)
  const ca = createdAfter instanceof Date ? createdAfter : parseDateInput(createdAfter)
  const cb = createdBefore instanceof Date ? createdBefore : parseDateInput(createdBefore)
  const { orders, orderCount, marketplaceId } = await cache.selectCachedOrdersWithItems({
    marketplaceKey: mk,
    createdAfter: ca,
    createdBefore: cb,
    limit,
    offset,
  })
  let ordersOut = orders
  try {
    ordersOut = await enrichOrdersWithPrimaryItemImages(mk, orders, includeSkuImages !== false)
  } catch (e) {
    console.warn('[amazon orders] primary item images skipped:', e?.message || e)
    ordersOut = await enrichOrdersWithPrimaryItemImages(mk, orders, false)
  }
  const mid = marketplaceId || cfg.defaultMarketplaceId || ''
  return {
    marketplaceKey: mk,
    marketplaceId: mid,
    orderCount,
    orders: ordersOut,
    source: 'cache',
    includeSkuImages: includeSkuImages !== false,
  }
}

/**
 * @param {object} opts
 * @param {string} opts.marketplaceKey
 * @param {Date|string} [opts.createdAfter]
 * @param {Date|string} [opts.createdBefore]
 * @param {boolean} [opts.includeItems]
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.forceAllowed] - true only if admin requested force
 */
async function syncAmazonOrders(opts = {}) {
  const marketplaceKey = normalizeMarketplaceKey(opts.marketplaceKey)
  const includeItems = opts.includeItems !== false
  const force = Boolean(opts.force)
  const forceAllowed = Boolean(opts.forceAllowed)

  let createdAfter = opts.createdAfter instanceof Date ? opts.createdAfter : parseDateInput(opts.createdAfter)
  let createdBefore =
    opts.createdBefore instanceof Date ? opts.createdBefore : parseDateInput(opts.createdBefore)
  if (!createdAfter || !createdBefore) {
    const d = buildDefaultDateWindow()
    createdAfter = d.createdAfter
    createdBefore = d.createdBefore
  }
  validateDateRange(createdAfter, createdBefore)

  if (force && !forceAllowed) {
    const err = new Error('force sync is restricted to administrators')
    err.code = 'AMAZON_SYNC_FORBIDDEN'
    throw err
  }

  if (!force) {
    const gate = await rate.canStartSync('orders', marketplaceKey)
    if (!gate.allowed) {
      const syncId = await cache.insertSyncLog({
        syncType: 'orders',
        marketplaceKey,
        status: 'skipped',
        createdAfter,
        createdBefore,
        metadata: { reason: gate.reason },
      })
      await cache.updateSyncLogById(syncId, {
        status: 'skipped',
        finishedAt: new Date(),
        ordersFetched: 0,
        orderItemsFetched: 0,
        apiCallsMade: 0,
        errorMessage: gate.reason,
      })
      return {
        marketplaceKey,
        createdAfter: iso8601Z(createdAfter),
        createdBefore: iso8601Z(createdBefore),
        ordersFetched: 0,
        ordersSaved: 0,
        orderItemsFetched: 0,
        apiCallsMade: 0,
        skipped: true,
        message: gate.reason,
      }
    }
  }

  const cfg = getAmazonConfig(marketplaceKey)
  const marketplaceId = cfg.defaultMarketplaceId || ''
  const syncId = await cache.insertSyncLog({
    syncType: 'orders',
    marketplaceKey,
    status: 'running',
    createdAfter,
    createdBefore,
    metadata: { includeItems },
  })

  let syncMetadata = { includeItems }

  function captureAmazonRequestId(res) {
    const id = res && typeof res.amazonRequestId === 'string' ? res.amazonRequestId.trim() : ''
    if (!id) return
    const prev = Array.isArray(syncMetadata.lastAmazonRequestIds) ? syncMetadata.lastAmazonRequestIds : []
    syncMetadata = {
      ...syncMetadata,
      lastAmazonRequestIds: [...prev, id.slice(0, 128)].slice(-10),
    }
  }

  let lastSpApiRequestId = null

  let apiCallsMade = 0
  let ordersFetched = 0
  let ordersSaved = 0
  let orderItemsFetched = 0
  const now = new Date()

  try {
    const orderParams = {
      marketplaceKey,
      CreatedAfter: iso8601Z(createdAfter),
      CreatedBefore: iso8601Z(createdBefore),
      MaxResultsPerPage: 100,
      preferConfigMarketplaceId: true,
    }
    if (marketplaceId) {
      orderParams.MarketplaceIds = marketplaceId
    }

    const ordersRes = await getAmazonOrders(orderParams)
    apiCallsMade += 1
    captureAmazonRequestId(ordersRes)
    lastSpApiRequestId = ordersRes.amazonRequestId || lastSpApiRequestId
    const { status, data } = ordersRes

    if (status !== 200 || !data || typeof data !== 'object' || Array.isArray(data)) {
      const failDesc = describeAmazonSpApiFailure(ordersRes, 'getOrders', marketplaceKey)
      if (failDesc) {
        syncMetadata = { ...syncMetadata, amazonSpApiError: failDesc }
      }
      await cache.updateSyncLogById(syncId, {
        status: 'failed',
        finishedAt: new Date(),
        ordersFetched: 0,
        orderItemsFetched: 0,
        apiCallsMade,
        errorMessage: failDesc ? failDesc.safeErrorMessage : `HTTP ${status}`,
        metadata: syncMetadata,
      })
      return {
        marketplaceKey,
        createdAfter: iso8601Z(createdAfter),
        createdBefore: iso8601Z(createdBefore),
        ordersFetched: 0,
        ordersSaved: 0,
        orderItemsFetched: 0,
        apiCallsMade,
        skipped: false,
        message: 'Amazon orders request failed',
        amazonSupportRef: failDesc
          ? {
              amazonRequestId: failDesc.amazonRequestId || undefined,
              statusCode: failDesc.statusCode,
              error: failDesc.safeErrorMessage,
            }
          : undefined,
      }
    }

    const orders = extractOrdersFromPayload(data)
    ordersFetched = orders.length

    for (let i = 0; i < orders.length; i += 1) {
      const order = orders[i]
      const needItems = includeItems && i < MAX_ORDER_ITEMS_FETCH
      const pendingItems = includeItems && i >= MAX_ORDER_ITEMS_FETCH
      const row = orderRowFromAmazon(order, marketplaceKey, marketplaceId, pendingItems, now)
      if (!row) continue
      await cache.upsertAmazonOrder(row)
      ordersSaved += 1

      if (!needItems || !row.amazonOrderId) continue

      try {
        const itemsRes = await getAmazonOrderItems(row.amazonOrderId, {
          marketplaceKey,
        })
        apiCallsMade += 1
        captureAmazonRequestId(itemsRes)
        lastSpApiRequestId = itemsRes.amazonRequestId || lastSpApiRequestId
        const { status: st, data: itemData } = itemsRes
        if (st === 200 && itemData && typeof itemData === 'object') {
          const n = await persistOrderItemsFromPayload(
            marketplaceKey,
            row.amazonOrderId,
            itemData,
            now
          )
          orderItemsFetched += n
          await cache.upsertAmazonOrder({
            ...row,
            itemsSyncPending: false,
            lastSyncedAt: now,
          })
        } else {
          const failDesc = describeAmazonSpApiFailure(
            { status: st, data: itemData, amazonRequestId: itemsRes.amazonRequestId },
            'getOrderItems',
            marketplaceKey
          )
          if (failDesc) {
            syncMetadata = {
              ...syncMetadata,
              lastOrderItemsSpApiError: {
                ...failDesc,
                amazonOrderId: String(row.amazonOrderId).slice(0, 64),
              },
            }
          }
        }
      } catch (e) {
        console.warn('[amazon-sync] order items failed (order continues):', row.amazonOrderId, e.message || e)
      }
    }

    await cache.updateSyncLogById(syncId, {
      status: 'success',
      finishedAt: new Date(),
      ordersFetched,
      orderItemsFetched,
      apiCallsMade,
      errorMessage: null,
      metadata: syncMetadata,
    })

    return {
      marketplaceKey,
      createdAfter: iso8601Z(createdAfter),
      createdBefore: iso8601Z(createdBefore),
      ordersFetched,
      ordersSaved,
      orderItemsFetched,
      apiCallsMade,
      skipped: false,
      message: 'Amazon orders sync completed',
    }
  } catch (e) {
    if (lastSpApiRequestId && e && typeof e === 'object' && !e.amazonRequestId) {
      e.amazonRequestId = lastSpApiRequestId
    }
    if (e?.code === 'AMAZON_SP_HTTP' && typeof e === 'object') {
      syncMetadata = {
        ...syncMetadata,
        amazonSpApiError: {
          operation: e.operation,
          marketplaceKey: e.marketplaceKey,
          statusCode: e.statusCode,
          safeErrorMessage: e.safeErrorMessage,
          amazonRequestId: e.amazonRequestId || null,
        },
      }
    }
    await cache.updateSyncLogById(syncId, {
      status: 'failed',
      finishedAt: new Date(),
      ordersFetched,
      orderItemsFetched,
      apiCallsMade,
      errorMessage: e && e.message ? String(e.message).slice(0, 500) : 'sync_failed',
      metadata: syncMetadata,
    })
    throw e
  }
}

async function syncOrderItemsForOrder({ marketplaceKey, amazonOrderId }) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const oid = String(amazonOrderId || '').trim()
  if (!oid) {
    const err = new Error('amazonOrderId required')
    err.code = 'AMAZON_SYNC_VALIDATION'
    throw err
  }
  const now = new Date()
  const itemsRes = await getAmazonOrderItems(oid, { marketplaceKey: mk })
  const { status, data, amazonRequestId } = itemsRes
  if (status !== 200 || !data) {
    const fail = describeAmazonSpApiFailure(itemsRes, 'getOrderItems', mk)
    return {
      ok: false,
      status,
      amazonRequestId: amazonRequestId || fail?.amazonRequestId || null,
      amazonSupportRef: fail
        ? {
            amazonRequestId: fail.amazonRequestId || undefined,
            statusCode: fail.statusCode,
            error: fail.safeErrorMessage,
          }
        : undefined,
    }
  }
  const n = await persistOrderItemsFromPayload(mk, oid, data, now)
  await cache.markOrderItemsSynced(mk, oid, now)
  return { ok: true, itemsSaved: n }
}

/**
 * Process orders flagged items_sync_pending (best-effort).
 */
async function syncMissingOrderItems({ marketplaceKey, limit = 100 }) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const lim = Math.min(500, Math.max(1, parseInt(String(limit), 10) || 100))
  const { query } = require('../db')
  const r = await query(
    `SELECT amazon_order_id FROM amazon_orders
     WHERE marketplace_key = $1 AND items_sync_pending = true
     ORDER BY purchase_date DESC NULLS LAST
     LIMIT $2`,
    [mk, lim]
  )
  let processed = 0
  for (const row of r.rows) {
    try {
      await syncOrderItemsForOrder({ marketplaceKey: mk, amazonOrderId: row.amazon_order_id })
      processed += 1
    } catch (e) {
      console.warn('[amazon-sync] syncMissingOrderItems row failed:', row.amazon_order_id, e.message || e)
    }
  }
  return { marketplaceKey: mk, processed }
}

module.exports = {
  getCachedAmazonOrders,
  syncAmazonOrders,
  syncOrderItemsForOrder,
  syncMissingOrderItems,
}
