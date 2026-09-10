/**
 * PostgreSQL persistence for Amazon orders cache (PII-safe columns only).
 */

const { query } = require('../db')

async function ensureAmazonOrdersCacheTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_orders (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      marketplace_id VARCHAR(32),
      amazon_order_id VARCHAR(64) NOT NULL,
      purchase_date TIMESTAMPTZ,
      order_status VARCHAR(64),
      fulfillment_channel VARCHAR(32),
      sales_channel TEXT,
      currency_code VARCHAR(8),
      order_amount NUMERIC(16, 4),
      number_of_items_shipped INTEGER,
      number_of_items_unshipped INTEGER,
      items_sync_pending BOOLEAN NOT NULL DEFAULT false,
      raw_safe_json JSONB,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (marketplace_key, amazon_order_id)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_orders_mk_purchase ON amazon_orders (marketplace_key, purchase_date DESC NULLS LAST)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_orders_pending ON amazon_orders (marketplace_key, items_sync_pending) WHERE items_sync_pending = true`
  )

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_order_items (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      amazon_order_id VARCHAR(64) NOT NULL,
      amazon_order_item_id VARCHAR(64) NOT NULL DEFAULT '',
      asin VARCHAR(32),
      seller_sku VARCHAR(512),
      title TEXT,
      quantity_ordered INTEGER,
      quantity_shipped INTEGER,
      item_currency_code VARCHAR(8),
      item_amount NUMERIC(16, 4),
      raw_safe_json JSONB,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (marketplace_key, amazon_order_id, amazon_order_item_id)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_order_items_order ON amazon_order_items (marketplace_key, amazon_order_id)`
  )
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku ON amazon_order_items (seller_sku)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_order_items_asin ON amazon_order_items (asin)`)

  // Money from Amazon's flat-file order report. The Orders API withholds `OrderTotal` and every
  // item money field while an order is `Pending`, yet the report already carries `item-price` for
  // it, so these rows are what lets a same-day report show the real amount instead of nothing.
  // Buyer-identifying report columns (ship-city / state / postal-code / country, product-name) are
  // deliberately never stored.
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_order_report_lines (
      id BIGSERIAL PRIMARY KEY,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      amazon_order_id VARCHAR(64) NOT NULL,
      order_item_id VARCHAR(64) NOT NULL DEFAULT '',
      purchase_date TIMESTAMPTZ,
      order_status VARCHAR(64),
      item_status VARCHAR(64),
      seller_sku VARCHAR(512),
      asin VARCHAR(32),
      quantity INTEGER,
      currency VARCHAR(8),
      item_price NUMERIC(16, 4),
      item_tax NUMERIC(16, 4),
      shipping_price NUMERIC(16, 4),
      shipping_tax NUMERIC(16, 4),
      gift_wrap_price NUMERIC(16, 4),
      gift_wrap_tax NUMERIC(16, 4),
      item_promotion_discount NUMERIC(16, 4),
      ship_promotion_discount NUMERIC(16, 4),
      line_amount NUMERIC(16, 4),
      report_id VARCHAR(64),
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (marketplace_key, amazon_order_id, order_item_id)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_order_report_lines_mk_purchase ON amazon_order_report_lines (marketplace_key, purchase_date)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_order_report_lines_order ON amazon_order_report_lines (marketplace_key, amazon_order_id)`
  )

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_sync_log (
      id BIGSERIAL PRIMARY KEY,
      sync_type VARCHAR(32) NOT NULL,
      marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
      status VARCHAR(32) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      created_after TIMESTAMPTZ,
      created_before TIMESTAMPTZ,
      orders_fetched INTEGER NOT NULL DEFAULT 0,
      order_items_fetched INTEGER NOT NULL DEFAULT 0,
      api_calls_made INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata JSONB
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_sync_log_mk_started ON amazon_sync_log (marketplace_key, started_at DESC)`
  )

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_api_call_log (
      id BIGSERIAL PRIMARY KEY,
      operation VARCHAR(64) NOT NULL,
      marketplace_key VARCHAR(8) NOT NULL,
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status_code INTEGER,
      rate_limit_header VARCHAR(512),
      success BOOLEAN NOT NULL DEFAULT false,
      safe_error TEXT
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_api_call_log_op_mk ON amazon_api_call_log (operation, marketplace_key, called_at DESC)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_api_call_log_orderitems ON amazon_api_call_log (operation, called_at DESC)`
  )
  await query(
    `ALTER TABLE amazon_api_call_log ADD COLUMN IF NOT EXISTS amazon_request_id VARCHAR(128)`
  )
}

/**
 * @param {object} row
 */
async function upsertAmazonOrder(row) {
  const {
    marketplaceKey,
    marketplaceId,
    amazonOrderId,
    purchaseDate,
    orderStatus,
    fulfillmentChannel,
    salesChannel,
    currencyCode,
    orderAmount,
    numberOfItemsShipped,
    numberOfItemsUnshipped,
    itemsSyncPending,
    rawSafeJson,
    lastSyncedAt,
  } = row
  const now = new Date()
  const synced = lastSyncedAt instanceof Date ? lastSyncedAt : now
  await query(
    `INSERT INTO amazon_orders (
      marketplace_key, marketplace_id, amazon_order_id, purchase_date, order_status,
      fulfillment_channel, sales_channel, currency_code, order_amount,
      number_of_items_shipped, number_of_items_unshipped, items_sync_pending,
      raw_safe_json, last_synced_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$15)
    ON CONFLICT (marketplace_key, amazon_order_id) DO UPDATE SET
      marketplace_id = EXCLUDED.marketplace_id,
      purchase_date = EXCLUDED.purchase_date,
      order_status = EXCLUDED.order_status,
      fulfillment_channel = EXCLUDED.fulfillment_channel,
      sales_channel = EXCLUDED.sales_channel,
      currency_code = EXCLUDED.currency_code,
      order_amount = EXCLUDED.order_amount,
      number_of_items_shipped = EXCLUDED.number_of_items_shipped,
      number_of_items_unshipped = EXCLUDED.number_of_items_unshipped,
      items_sync_pending = EXCLUDED.items_sync_pending,
      raw_safe_json = EXCLUDED.raw_safe_json,
      last_synced_at = EXCLUDED.last_synced_at,
      updated_at = EXCLUDED.updated_at`,
    [
      marketplaceKey,
      marketplaceId || null,
      amazonOrderId,
      purchaseDate || null,
      orderStatus || null,
      fulfillmentChannel || null,
      salesChannel || null,
      currencyCode || null,
      orderAmount != null ? orderAmount : null,
      numberOfItemsShipped != null ? numberOfItemsShipped : null,
      numberOfItemsUnshipped != null ? numberOfItemsUnshipped : null,
      Boolean(itemsSyncPending),
      rawSafeJson != null ? JSON.stringify(rawSafeJson) : null,
      synced,
      now,
    ]
  )
}

async function deleteOrderItemsForOrder(marketplaceKey, amazonOrderId) {
  await query(
    `DELETE FROM amazon_order_items WHERE marketplace_key = $1 AND amazon_order_id = $2`,
    [marketplaceKey, amazonOrderId]
  )
}

/**
 * @param {object} row
 */
async function insertAmazonOrderItem(row) {
  const {
    marketplaceKey,
    amazonOrderId,
    amazonOrderItemId,
    asin,
    sellerSku,
    title,
    quantityOrdered,
    quantityShipped,
    itemCurrencyCode,
    itemAmount,
    rawSafeJson,
    lastSyncedAt,
  } = row
  const now = new Date()
  const synced = lastSyncedAt instanceof Date ? lastSyncedAt : now
  await query(
    `INSERT INTO amazon_order_items (
      marketplace_key, amazon_order_id, amazon_order_item_id, asin, seller_sku, title,
      quantity_ordered, quantity_shipped, item_currency_code, item_amount,
      raw_safe_json, last_synced_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13)
    ON CONFLICT (marketplace_key, amazon_order_id, amazon_order_item_id) DO UPDATE SET
      asin = EXCLUDED.asin,
      seller_sku = EXCLUDED.seller_sku,
      title = EXCLUDED.title,
      quantity_ordered = EXCLUDED.quantity_ordered,
      quantity_shipped = EXCLUDED.quantity_shipped,
      item_currency_code = EXCLUDED.item_currency_code,
      item_amount = EXCLUDED.item_amount,
      raw_safe_json = EXCLUDED.raw_safe_json,
      last_synced_at = EXCLUDED.last_synced_at,
      updated_at = EXCLUDED.updated_at`,
    [
      marketplaceKey,
      amazonOrderId,
      amazonOrderItemId != null ? String(amazonOrderItemId).slice(0, 64) : '',
      asin || null,
      sellerSku || null,
      title || null,
      quantityOrdered != null ? quantityOrdered : null,
      quantityShipped != null ? quantityShipped : null,
      itemCurrencyCode || null,
      itemAmount != null ? itemAmount : null,
      rawSafeJson != null ? JSON.stringify(rawSafeJson) : null,
      synced,
      now,
    ]
  )
}

/**
 * @param {object} opts
 * @param {string} opts.marketplaceKey
 * @param {Date|null} [opts.createdAfter]
 * @param {Date|null} [opts.createdBefore]
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 */
async function selectCachedOrdersWithItems(opts) {
  const { marketplaceKey, createdAfter, createdBefore, limit = 100, offset = 0 } = opts
  const lim = Math.min(500, Math.max(1, parseInt(String(limit), 10) || 100))
  const off = Math.max(0, parseInt(String(offset), 10) || 0)

  const orderRows = await query(
    `SELECT o.id, o.marketplace_key, o.marketplace_id, o.amazon_order_id, o.purchase_date, o.order_status,
            o.fulfillment_channel, o.sales_channel, o.currency_code, o.order_amount,
            o.number_of_items_shipped, o.number_of_items_unshipped, o.items_sync_pending,
            o.last_synced_at, o.raw_safe_json
     FROM amazon_orders o
     WHERE o.marketplace_key = $1
       AND ($2::timestamptz IS NULL OR o.purchase_date >= $2)
       AND ($3::timestamptz IS NULL OR o.purchase_date < $3)
     ORDER BY o.purchase_date DESC NULLS LAST, o.amazon_order_id DESC
     LIMIT $4 OFFSET $5`,
    [marketplaceKey, createdAfter || null, createdBefore || null, lim, off]
  )

  const orders = []
  for (const r of orderRows.rows) {
    const itemsRes = await query(
      `SELECT asin, seller_sku, title, quantity_ordered, quantity_shipped, item_currency_code, item_amount
       FROM amazon_order_items
       WHERE marketplace_key = $1 AND amazon_order_id = $2
       ORDER BY id ASC`,
      [marketplaceKey, r.amazon_order_id]
    )
    const items = itemsRes.rows.map((it) => {
      const out = {}
      if (it.asin) out.ASIN = it.asin
      if (it.seller_sku) out.SellerSKU = it.seller_sku
      if (it.title) out.Title = it.title
      if (it.quantity_ordered != null) out.QuantityOrdered = it.quantity_ordered
      if (it.quantity_shipped != null) out.QuantityShipped = it.quantity_shipped
      if (it.item_currency_code && it.item_amount != null) {
        out.ItemPrice = { CurrencyCode: it.item_currency_code, Amount: String(it.item_amount) }
      }
      return out
    })
    const skus = []
    const seen = new Set()
    for (const it of items) {
      const sku = it.SellerSKU != null ? String(it.SellerSKU).trim() : ''
      if (sku && !seen.has(sku)) {
        seen.add(sku)
        skus.push(sku)
      }
    }
    const orderTotal =
      r.currency_code && r.order_amount != null
        ? { CurrencyCode: r.currency_code, Amount: String(r.order_amount) }
        : undefined
    orders.push({
      AmazonOrderId: r.amazon_order_id,
      PurchaseDate: r.purchase_date ? r.purchase_date.toISOString() : undefined,
      OrderStatus: r.order_status || undefined,
      FulfillmentChannel: r.fulfillment_channel || undefined,
      SalesChannel: r.sales_channel || undefined,
      OrderTotal: orderTotal,
      NumberOfItemsShipped: r.number_of_items_shipped,
      NumberOfItemsUnshipped: r.number_of_items_unshipped,
      items,
      skus,
      itemsSyncPending: r.items_sync_pending,
    })
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS c FROM amazon_orders o
     WHERE o.marketplace_key = $1
       AND ($2::timestamptz IS NULL OR o.purchase_date >= $2)
       AND ($3::timestamptz IS NULL OR o.purchase_date < $3)`,
    [marketplaceKey, createdAfter || null, createdBefore || null]
  )
  const total = countRes.rows[0]?.c ?? orders.length

  const mkId =
    orderRows.rows[0]?.marketplace_id ||
    (marketplaceKey === 'ksa' ? 'A17E79C6D8DWNP' : 'A2VIGQ35RCS4UG')

  return { orders, orderCount: total, marketplaceId: mkId }
}

async function countCachedOrders(marketplaceKey) {
  const r = await query(`SELECT COUNT(*)::int AS c FROM amazon_orders WHERE marketplace_key = $1`, [
    marketplaceKey,
  ])
  return r.rows[0]?.c ?? 0
}

async function getMaxLastSyncedAt(marketplaceKey) {
  const r = await query(
    `SELECT MAX(last_synced_at) AS t FROM amazon_orders WHERE marketplace_key = $1`,
    [marketplaceKey]
  )
  return r.rows[0]?.t || null
}

async function markOrderItemsSynced(marketplaceKey, amazonOrderId, lastSyncedAt) {
  const t = lastSyncedAt instanceof Date ? lastSyncedAt : new Date()
  await query(
    `UPDATE amazon_orders SET items_sync_pending = false, last_synced_at = $3, updated_at = $3
     WHERE marketplace_key = $1 AND amazon_order_id = $2`,
    [marketplaceKey, amazonOrderId, t]
  )
}

async function appendApiCallLog(entry) {
  await query(
    `INSERT INTO amazon_api_call_log (operation, marketplace_key, called_at, status_code, rate_limit_header, success, safe_error, amazon_request_id)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)`,
    [
      entry.operation,
      entry.marketplaceKey,
      entry.statusCode != null ? entry.statusCode : null,
      entry.rateLimitHeader != null ? String(entry.rateLimitHeader).slice(0, 512) : null,
      Boolean(entry.success),
      entry.safeError != null ? String(entry.safeError).slice(0, 2000) : null,
      entry.amazonRequestId != null ? String(entry.amazonRequestId).trim().slice(0, 128) : null,
    ]
  )
}

async function insertSyncLog(row) {
  const r = await query(
    `INSERT INTO amazon_sync_log (
      sync_type, marketplace_key, status, started_at, created_after, created_before, metadata
    ) VALUES ($1,$2,$3,NOW(),$4,$5,$6::jsonb) RETURNING id`,
    [
      row.syncType,
      row.marketplaceKey,
      row.status,
      row.createdAfter || null,
      row.createdBefore || null,
      row.metadata != null ? JSON.stringify(row.metadata) : null,
    ]
  )
  return r.rows[0].id
}

async function updateSyncLogById(id, patch) {
  const fields = []
  const vals = []
  let i = 1
  if (patch.status != null) {
    fields.push(`status = $${i++}`)
    vals.push(patch.status)
  }
  if (patch.finishedAt !== undefined) {
    fields.push(`finished_at = $${i++}`)
    vals.push(patch.finishedAt)
  }
  if (patch.ordersFetched != null) {
    fields.push(`orders_fetched = $${i++}`)
    vals.push(patch.ordersFetched)
  }
  if (patch.orderItemsFetched != null) {
    fields.push(`order_items_fetched = $${i++}`)
    vals.push(patch.orderItemsFetched)
  }
  if (patch.apiCallsMade != null) {
    fields.push(`api_calls_made = $${i++}`)
    vals.push(patch.apiCallsMade)
  }
  if (patch.errorMessage !== undefined) {
    fields.push(`error_message = $${i++}`)
    vals.push(patch.errorMessage != null ? String(patch.errorMessage).slice(0, 4000) : null)
  }
  if (patch.metadata != null) {
    fields.push(`metadata = $${i++}::jsonb`)
    vals.push(JSON.stringify(patch.metadata))
  }
  if (fields.length === 0) return
  vals.push(id)
  await query(`UPDATE amazon_sync_log SET ${fields.join(', ')} WHERE id = $${i}`, vals)
}

async function findRecentRunningSync(marketplaceKey, staleAfterMinutes = 35) {
  const mins = Math.max(5, parseInt(String(staleAfterMinutes), 10) || 35)
  const r = await query(
    `SELECT id, started_at FROM amazon_sync_log
     WHERE marketplace_key = $1 AND status = 'running'
       AND started_at > NOW() - ($2::int * interval '1 minute')
     ORDER BY started_at DESC LIMIT 1`,
    [marketplaceKey, mins]
  )
  return r.rows[0] || null
}

async function markStaleRunningSyncsFailed(marketplaceKey, staleAfterMinutes = 40) {
  const mins = Math.max(5, parseInt(String(staleAfterMinutes), 10) || 40)
  await query(
    `UPDATE amazon_sync_log SET status = 'failed', finished_at = NOW(),
        error_message = COALESCE(error_message, 'Stale sync abandoned')
     WHERE marketplace_key = $1 AND status = 'running'
       AND started_at < NOW() - ($2::int * interval '1 minute')`,
    [marketplaceKey, mins]
  )
}

async function getLastSyncRow(marketplaceKey, syncType = 'orders') {
  const r = await query(
    `SELECT id, sync_type, marketplace_key, status, started_at, finished_at,
            created_after, created_before,
            orders_fetched, order_items_fetched, api_calls_made, error_message, metadata
     FROM amazon_sync_log
     WHERE marketplace_key = $1 AND sync_type = $2
     ORDER BY started_at DESC LIMIT 1`,
    [marketplaceKey, syncType]
  )
  return r.rows[0] || null
}

async function getLastSuccessfulSyncRow(marketplaceKey, syncType = 'orders') {
  const r = await query(
    `SELECT id, status, started_at, finished_at, orders_fetched, order_items_fetched, api_calls_made, error_message
     FROM amazon_sync_log
     WHERE marketplace_key = $1 AND sync_type = $2 AND status = 'success'
     ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 1`,
    [marketplaceKey, syncType]
  )
  return r.rows[0] || null
}

async function selectRecentApiCalls(limit = 50) {
  const lim = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50))
  const r = await query(
    `SELECT id, operation, marketplace_key, called_at, status_code, rate_limit_header, success, safe_error, amazon_request_id
     FROM amazon_api_call_log
     ORDER BY called_at DESC
     LIMIT $1`,
    [lim]
  )
  return r.rows
}

async function selectRecentSyncLogs(marketplaceKey, limit = 15) {
  const lim = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 15))
  const r = await query(
    `SELECT id, sync_type, marketplace_key, status, started_at, finished_at,
            created_after, created_before,
            orders_fetched, order_items_fetched, api_calls_made, error_message, metadata
     FROM amazon_sync_log
     WHERE marketplace_key = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [marketplaceKey, lim]
  )
  return r.rows
}

async function getLastSyncRowByStatus(marketplaceKey, syncType, status) {
  const r = await query(
    `SELECT id, sync_type, marketplace_key, status, started_at, finished_at,
            orders_fetched, order_items_fetched, api_calls_made, error_message, metadata
     FROM amazon_sync_log
     WHERE marketplace_key = $1 AND sync_type = $2 AND status = $3
     ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
     LIMIT 1`,
    [marketplaceKey, syncType, status]
  )
  return r.rows[0] || null
}

/** Last finished sync row (any status) — used for manual sync cooldown window. */
async function getLastFinishedSyncRow(marketplaceKey, syncType = 'orders') {
  const r = await query(
    `SELECT finished_at, status FROM amazon_sync_log
     WHERE marketplace_key = $1 AND sync_type = $2 AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`,
    [marketplaceKey, syncType]
  )
  return r.rows[0] || null
}

async function selectRecentApiCallsByMarketplace(marketplaceKey, limit = 50) {
  const lim = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50))
  const r = await query(
    `SELECT id, operation, marketplace_key, called_at, status_code, rate_limit_header, success, safe_error, amazon_request_id
     FROM amazon_api_call_log
     WHERE marketplace_key = $1
     ORDER BY called_at DESC
     LIMIT $2`,
    [marketplaceKey, lim]
  )
  return r.rows
}

function reportLineNumber(value) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Writes one report run's lines, then drops rows in the same purchase-date window that this run did
 * not return. Without that delete a line Amazon later removed (a cancelled item, a re-keyed order
 * item id) would keep inflating the day forever.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date }} window purchase-date range the report covered
 * @param {object[]} lines parsed report lines
 * @param {string|null} reportId
 * @returns {Promise<{ saved: number, removed: number }>}
 */
async function replaceOrderReportLines(marketplaceKey, window, lines, reportId = null) {
  let saved = 0
  // Kept as two parallel arrays rather than one joined key: PostgreSQL `text` cannot hold a NUL byte,
  // so any separator-based key risks an "invalid byte sequence for encoding UTF8" on the delete.
  /** @type {string[]} */
  const seenOrderIds = []
  /** @type {string[]} */
  const seenItemIds = []
  for (const line of lines || []) {
    const orderId = String(line.amazonOrderId || '').trim()
    if (!orderId) continue
    const orderItemId = String(line.orderItemId || '').trim()
    await query(
      `INSERT INTO amazon_order_report_lines (
         marketplace_key, amazon_order_id, order_item_id, purchase_date, order_status, item_status,
         seller_sku, asin, quantity, currency,
         item_price, item_tax, shipping_price, shipping_tax, gift_wrap_price, gift_wrap_tax,
         item_promotion_discount, ship_promotion_discount, line_amount, report_id, last_synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
       ON CONFLICT (marketplace_key, amazon_order_id, order_item_id) DO UPDATE SET
         purchase_date = EXCLUDED.purchase_date,
         order_status = EXCLUDED.order_status,
         item_status = EXCLUDED.item_status,
         seller_sku = EXCLUDED.seller_sku,
         asin = EXCLUDED.asin,
         quantity = EXCLUDED.quantity,
         currency = EXCLUDED.currency,
         item_price = EXCLUDED.item_price,
         item_tax = EXCLUDED.item_tax,
         shipping_price = EXCLUDED.shipping_price,
         shipping_tax = EXCLUDED.shipping_tax,
         gift_wrap_price = EXCLUDED.gift_wrap_price,
         gift_wrap_tax = EXCLUDED.gift_wrap_tax,
         item_promotion_discount = EXCLUDED.item_promotion_discount,
         ship_promotion_discount = EXCLUDED.ship_promotion_discount,
         line_amount = EXCLUDED.line_amount,
         report_id = EXCLUDED.report_id,
         last_synced_at = NOW(),
         updated_at = NOW()`,
      [
        marketplaceKey,
        orderId,
        orderItemId,
        line.purchaseDate || null,
        line.orderStatus || null,
        line.itemStatus || null,
        line.sellerSku || null,
        line.asin || null,
        line.quantity == null ? null : Math.trunc(reportLineNumber(line.quantity) ?? 0),
        line.currency || null,
        reportLineNumber(line.itemPrice),
        reportLineNumber(line.itemTax),
        reportLineNumber(line.shippingPrice),
        reportLineNumber(line.shippingTax),
        reportLineNumber(line.giftWrapPrice),
        reportLineNumber(line.giftWrapTax),
        reportLineNumber(line.itemPromotionDiscount),
        reportLineNumber(line.shipPromotionDiscount),
        reportLineNumber(line.lineAmount),
        reportId,
      ]
    )
    saved += 1
    seenOrderIds.push(orderId)
    seenItemIds.push(orderItemId)
  }

  const del = await query(
    `DELETE FROM amazon_order_report_lines t
     WHERE t.marketplace_key = $1
       AND t.purchase_date >= $2::timestamptz
       AND t.purchase_date < $3::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM unnest($4::text[], $5::text[]) AS seen (amazon_order_id, order_item_id)
         WHERE seen.amazon_order_id = t.amazon_order_id
           AND seen.order_item_id = t.order_item_id
       )`,
    [marketplaceKey, window.start, window.end, seenOrderIds, seenItemIds]
  )
  return { saved, removed: del.rowCount || 0 }
}

/**
 * Report lines that carry money for a purchase-date window.
 *
 * Cancelled lines are excluded rather than summed as zero: a cancelled item contributes nothing, and
 * an order whose every line is cancelled must not surface as an AED 0.00 sale. Lines where Amazon
 * reported no money at all are excluded too, so a missing amount stays unknown instead of zero.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {Date} start
 * @param {Date} end
 */
async function selectOrderReportLines(marketplaceKey, start, end) {
  const r = await query(
    `SELECT amazon_order_id, order_item_id, seller_sku, asin, quantity, currency,
            line_amount, item_status, last_synced_at
     FROM amazon_order_report_lines
     WHERE marketplace_key = $1
       AND purchase_date >= $2::timestamptz
       AND purchase_date < $3::timestamptz
       AND COALESCE(item_status, '') NOT ILIKE 'cancel%'
       AND line_amount IS NOT NULL
     ORDER BY amazon_order_id, order_item_id`,
    [marketplaceKey, start, end]
  )
  return r.rows || []
}

/**
 * Whether a successful sync window fully covers [createdAfter, createdBefore).
 * @param {string} marketplaceKey 'uae' | 'ksa'
 * @param {Date} createdAfter
 * @param {Date} createdBefore
 * @param {string} [syncType='orders']
 */
async function findSuccessfulSyncCoveringRange(
  marketplaceKey,
  createdAfter,
  createdBefore,
  syncType = 'orders'
) {
  const r = await query(
    `SELECT finished_at, created_after, created_before
     FROM amazon_sync_log
     WHERE sync_type = $4
       AND marketplace_key = $1
       AND status = 'success'
       AND created_after IS NOT NULL
       AND created_before IS NOT NULL
       AND created_after <= $2::timestamptz
       AND created_before >= $3::timestamptz
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`,
    [marketplaceKey, createdAfter, createdBefore, syncType]
  )
  return r.rows[0] || null
}

async function getLatestSuccessfulOrdersSyncFinishedAt(marketplaceKey) {
  const r = await query(
    `SELECT MAX(finished_at) AS t
     FROM amazon_sync_log
     WHERE sync_type = 'orders'
       AND marketplace_key = $1
       AND status = 'success'`,
    [marketplaceKey]
  )
  return r.rows[0]?.t || null
}

/**
 * @param {'all'|'uae'|'ksa'} marketplaceKey
 * @param {Date} createdAfter
 * @param {Date} createdBefore
 */
async function getOrdersCacheCoverage(marketplaceKey, createdAfter, createdBefore) {
  const mkList = marketplaceKey === 'all' ? ['uae', 'ksa'] : [marketplaceKey]
  const coveringFinished = []
  const latestSuccess = []
  for (const mk of mkList) {
    const row = await findSuccessfulSyncCoveringRange(mk, createdAfter, createdBefore)
    coveringFinished.push(row?.finished_at ? new Date(row.finished_at).toISOString() : null)
    const t = await getLatestSuccessfulOrdersSyncFinishedAt(mk)
    latestSuccess.push(t ? new Date(t).toISOString() : null)
  }
  const fullyCovered = mkList.every((_, i) => Boolean(coveringFinished[i]))
  const coveringTimes = coveringFinished.filter(Boolean)
  const latestOk = latestSuccess.filter(Boolean)
  let lastSuccessfulSync = null
  if (fullyCovered && coveringTimes.length) {
    lastSuccessfulSync = coveringTimes.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
  } else if (latestOk.length) {
    lastSuccessfulSync = latestOk.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
  }
  const warn =
    'This date range may be incomplete. Sync this range from Amazon to update the cache.'
  const ok = 'Cache covers this selected range.'
  return {
    fullyCovered,
    message: fullyCovered ? ok : warn,
    lastSuccessfulSync,
  }
}

module.exports = {
  ensureAmazonOrdersCacheTables,
  upsertAmazonOrder,
  deleteOrderItemsForOrder,
  insertAmazonOrderItem,
  selectCachedOrdersWithItems,
  countCachedOrders,
  getMaxLastSyncedAt,
  markOrderItemsSynced,
  appendApiCallLog,
  insertSyncLog,
  updateSyncLogById,
  findRecentRunningSync,
  markStaleRunningSyncsFailed,
  getLastSyncRow,
  getLastSuccessfulSyncRow,
  getLastSyncRowByStatus,
  getLastFinishedSyncRow,
  selectRecentApiCalls,
  selectRecentApiCallsByMarketplace,
  selectRecentSyncLogs,
  replaceOrderReportLines,
  selectOrderReportLines,
  findSuccessfulSyncCoveringRange,
  getLatestSuccessfulOrdersSyncFinishedAt,
  getOrdersCacheCoverage,
}
