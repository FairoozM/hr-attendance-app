'use strict'

/**
 * Cache for Noon marketplace order lines and per-order money fetched from the Noon Partner API.
 *
 * `noon_order_lines` comes from the Noon OMS orders export (`noon_noonoms_ordersexport`, reached
 * through `/impex/v1/export/*`). One row per Noon item number, which is how Noon models a unit of
 * an order, so an order's quantity is its number of item lines. That export carries no money.
 *
 * `noon_order_finance_rows` comes from the Noon finance item-level transaction report
 * (`noon_financeweb_transactionviewreportonitemlevel`), which is where Noon publishes per-order
 * proceeds and fees. Noon only writes an order into it once the order enters a settlement
 * statement, so the two feeds are joined on the Noon order number, never on a date.
 */

const { query } = require('../../db')

/** Two report channels ask for these tables at once; PostgreSQL races `CREATE TABLE IF NOT EXISTS`. */
let ensurePromise = null

async function ensureNoonOrderTables() {
  if (!ensurePromise) {
    ensurePromise = createNoonOrderTables().catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}

/**
 * `CREATE ... IF NOT EXISTS` is not atomic: two backends running it at the same moment both pass
 * the existence check and the loser fails on the system catalog's unique index. Those specific
 * duplicate-object errors mean the object now exists, which is the outcome we asked for.
 */
const DUPLICATE_OBJECT_CODES = new Set(['23505', '42P07', '42P06', '42710'])

async function ddl(sql) {
  try {
    await query(sql)
  } catch (err) {
    if (!DUPLICATE_OBJECT_CODES.has(err && err.code)) throw err
  }
}

async function createNoonOrderTables() {
  await ddl(`
    CREATE TABLE IF NOT EXISTS noon_order_lines (
      id BIGSERIAL PRIMARY KEY,
      country_code TEXT NOT NULL,
      order_nr TEXT NOT NULL,
      item_nr TEXT NOT NULL,
      marketplace TEXT,
      destination_country_code TEXT,
      noon_sku TEXT,
      partner_sku TEXT,
      warehouse_code TEXT,
      order_placed_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      item_status TEXT,
      shipment_nr TEXT,
      awb_nr TEXT,
      is_fulfilled_by_noon BOOLEAN,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (country_code, order_nr, item_nr)
    )
  `)
  await ddl(
    `CREATE INDEX IF NOT EXISTS idx_noon_order_lines_placed_at
     ON noon_order_lines (order_placed_at)`,
  )
  await ddl(`
    CREATE TABLE IF NOT EXISTS noon_order_export_runs (
      id BIGSERIAL PRIMARY KEY,
      export_category_code TEXT NOT NULL,
      export_code TEXT,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      status TEXT NOT NULL,
      rows_parsed INTEGER NOT NULL DEFAULT 0,
      rows_saved INTEGER NOT NULL DEFAULT 0,
      poll_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `)
  await ddl(`
    CREATE TABLE IF NOT EXISTS noon_order_finance_rows (
      id BIGSERIAL PRIMARY KEY,
      order_nr TEXT NOT NULL,
      item_nr TEXT NOT NULL DEFAULT '',
      reference_nr TEXT NOT NULL DEFAULT '',
      transaction_type TEXT NOT NULL DEFAULT '',
      contract TEXT,
      contract_title TEXT,
      country_code TEXT,
      currency TEXT,
      order_date DATE,
      transaction_date DATE,
      net_proceeds NUMERIC(14,4),
      referral_fee NUMERIC(14,4),
      fulfillment_fee NUMERIC(14,4),
      shipping_credits NUMERIC(14,4),
      other_order_fees NUMERIC(14,4),
      order_subsidies NUMERIC(14,4),
      total NUMERIC(14,4),
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_nr, item_nr, reference_nr, transaction_type)
    )
  `)
  await ddl(
    `CREATE INDEX IF NOT EXISTS idx_noon_order_finance_rows_order_nr
     ON noon_order_finance_rows (order_nr)`,
  )

  // Noon's own per-SKU, per-day sales report
  // (`noon_catalog_reports_productviewsandsalesdata`). The OMS orders export carries no money and
  // the finance report only appears once Noon settles an order, 1–8 days later, so this is the only
  // Noon source that prices a recent day. Verified against Noon UAE for 2026-09-08: where an order
  // had settled, `revenue_shipped / shipped_units` equalled the settled net proceeds exactly.
  await ddl(`
    CREATE TABLE IF NOT EXISTS noon_sku_daily_sales (
      id BIGSERIAL PRIMARY KEY,
      country_code TEXT NOT NULL,
      sales_date DATE NOT NULL,
      noon_sku TEXT NOT NULL,
      partner_sku TEXT,
      currency TEXT,
      gross_units NUMERIC(14,4),
      shipped_units NUMERIC(14,4),
      cancelled_units NUMERIC(14,4),
      revenue_shipped NUMERIC(14,4),
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (country_code, sales_date, noon_sku)
    )
  `)
  await ddl(
    `CREATE INDEX IF NOT EXISTS idx_noon_sku_daily_sales_date
     ON noon_sku_daily_sales (country_code, sales_date)`,
  )

  // Noon's live catalog, from `noon_catalog_catalogexport`. `sku_child` is the same identifier the
  // orders export calls `sku`, so this is the only Noon feed that both prices an order the day it is
  // placed and maps Noon's psku to our own partner SKU.
  //
  // `active_price` is what the item is listed at now, so it is an estimate of what a past order sold
  // for, not settled money: measured against 22 settled Noon UAE orders it matched exactly 19 times
  // and was too high 3 times where the price had since changed. Callers must treat it as the last
  // resort and label it as an estimate.
  await ddl(`
    CREATE TABLE IF NOT EXISTS noon_catalog_prices (
      id BIGSERIAL PRIMARY KEY,
      country_code TEXT NOT NULL,
      noon_sku TEXT NOT NULL,
      psku_code TEXT,
      partner_sku TEXT,
      noon_title TEXT,
      active_price NUMERIC(14,2),
      strikethrough_price NUMERIC(14,2),
      seller_price_min NUMERIC(14,2),
      noon_status TEXT,
      is_active BOOLEAN,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (country_code, noon_sku)
    )
  `)
}

async function upsertNoonCatalogPrice(row) {
  await query(
    `INSERT INTO noon_catalog_prices (
       country_code, noon_sku, psku_code, partner_sku, noon_title, active_price,
       strikethrough_price, seller_price_min, noon_status, is_active, last_synced_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (country_code, noon_sku) DO UPDATE SET
       psku_code = EXCLUDED.psku_code,
       partner_sku = EXCLUDED.partner_sku,
       noon_title = EXCLUDED.noon_title,
       active_price = EXCLUDED.active_price,
       strikethrough_price = EXCLUDED.strikethrough_price,
       seller_price_min = EXCLUDED.seller_price_min,
       noon_status = EXCLUDED.noon_status,
       is_active = EXCLUDED.is_active,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = EXCLUDED.last_synced_at`,
    [
      row.countryCode,
      row.noonSku,
      row.pskuCode ?? null,
      row.partnerSku ?? null,
      row.noonTitle ?? null,
      row.activePrice ?? null,
      row.strikethroughPrice ?? null,
      row.sellerPriceMin ?? null,
      row.noonStatus ?? null,
      row.isActive ?? null,
      row.lastSyncedAt ?? new Date(),
    ],
  )
}

/**
 * How much catalog we hold for a country and how fresh it is.
 *
 * Noon caps how many Impex exports an account may create and answers an over-quota create with
 * `INVALID_ARGUMENT: Export Quota exceeded`. The catalog changes slowly, so it is re-exported only
 * when what we hold has gone stale, which keeps the quota for the exports that are date-specific.
 *
 * @param {string} countryCode
 */
async function getNoonCatalogFreshness(countryCode) {
  const res = await query(
    `SELECT COUNT(*)::int AS rows,
            COUNT(active_price)::int AS priced_rows,
            MAX(last_synced_at) AS newest
     FROM noon_catalog_prices
     WHERE UPPER(country_code) = UPPER($1)`,
    [countryCode],
  )
  const row = res.rows[0] || {}
  return {
    rows: row.rows || 0,
    pricedRows: row.priced_rows || 0,
    newest: row.newest ? new Date(row.newest) : null,
  }
}

/**
 * Live catalog price and partner SKU for the given Noon skus.
 *
 * Rows with no usable price still come back, because the partner SKU alone is worth having: without
 * it the report shows Noon's opaque psku instead of our own item code.
 *
 * @param {string} countryCode
 * @param {string[]} noonSkus
 */
async function selectNoonCatalogPrices(countryCode, noonSkus) {
  if (!noonSkus.length) return []
  const res = await query(
    `SELECT noon_sku, partner_sku, noon_title, active_price, seller_price_min, noon_status,
            last_synced_at
     FROM noon_catalog_prices
     WHERE UPPER(country_code) = UPPER($1)
       AND noon_sku = ANY($2::text[])`,
    [countryCode, noonSkus],
  )
  return res.rows || []
}

async function upsertNoonSkuDailySales(row) {
  await query(
    `INSERT INTO noon_sku_daily_sales (
       country_code, sales_date, noon_sku, partner_sku, currency,
       gross_units, shipped_units, cancelled_units, revenue_shipped, raw_row, last_synced_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11)
     ON CONFLICT (country_code, sales_date, noon_sku) DO UPDATE SET
       partner_sku = EXCLUDED.partner_sku,
       currency = EXCLUDED.currency,
       gross_units = EXCLUDED.gross_units,
       shipped_units = EXCLUDED.shipped_units,
       cancelled_units = EXCLUDED.cancelled_units,
       revenue_shipped = EXCLUDED.revenue_shipped,
       raw_row = EXCLUDED.raw_row,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = EXCLUDED.last_synced_at`,
    [
      row.countryCode,
      row.salesDate,
      row.noonSku,
      row.partnerSku ?? null,
      row.currency ?? null,
      row.grossUnits ?? null,
      row.shippedUnits ?? null,
      row.cancelledUnits ?? null,
      row.revenueShipped ?? null,
      JSON.stringify(row.rawRow ?? {}),
      row.lastSyncedAt ?? new Date(),
    ],
  )
}

/**
 * Noon's reported sales for one country and calendar date, keyed by Noon sku.
 *
 * Rows with no units at all are the "browsed but not bought" rows and carry no price, so they are
 * left out rather than becoming a zero-priced SKU.
 *
 * @param {string} countryCode
 * @param {string} salesYmd
 */
async function selectNoonSkuDailySales(countryCode, salesYmd) {
  const res = await query(
    `SELECT noon_sku, partner_sku, currency, gross_units, shipped_units, cancelled_units,
            revenue_shipped, last_synced_at
     FROM noon_sku_daily_sales
     WHERE UPPER(country_code) = UPPER($1)
       AND sales_date = $2::date
       AND COALESCE(revenue_shipped, 0) <> 0
       AND (COALESCE(shipped_units, 0) <> 0 OR COALESCE(gross_units, 0) <> 0)`,
    [countryCode, salesYmd],
  )
  return res.rows || []
}

async function upsertNoonOrderLine(row) {
  const res = await query(
    `INSERT INTO noon_order_lines (
       country_code, order_nr, item_nr, marketplace, destination_country_code,
       noon_sku, partner_sku, warehouse_code, order_placed_at, delivered_at,
       item_status, shipment_nr, awb_nr, is_fulfilled_by_noon, raw_row, last_synced_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16)
     ON CONFLICT (country_code, order_nr, item_nr) DO UPDATE SET
       marketplace = EXCLUDED.marketplace,
       destination_country_code = EXCLUDED.destination_country_code,
       noon_sku = EXCLUDED.noon_sku,
       partner_sku = EXCLUDED.partner_sku,
       warehouse_code = EXCLUDED.warehouse_code,
       order_placed_at = EXCLUDED.order_placed_at,
       delivered_at = EXCLUDED.delivered_at,
       item_status = EXCLUDED.item_status,
       shipment_nr = EXCLUDED.shipment_nr,
       awb_nr = EXCLUDED.awb_nr,
       is_fulfilled_by_noon = EXCLUDED.is_fulfilled_by_noon,
       raw_row = EXCLUDED.raw_row,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = EXCLUDED.last_synced_at
     RETURNING id`,
    [
      row.countryCode,
      row.orderNr,
      row.itemNr,
      row.marketplace,
      row.destinationCountryCode,
      row.noonSku,
      row.partnerSku,
      row.warehouseCode,
      row.orderPlacedAt,
      row.deliveredAt,
      row.itemStatus,
      row.shipmentNr,
      row.awbNr,
      row.isFulfilledByNoon,
      JSON.stringify(row.rawRow || {}),
      row.lastSyncedAt || new Date(),
    ],
  )
  return res.rows[0]?.id || null
}

/**
 * Order lines whose Noon order timestamp falls inside the given window.
 * @param {{ start: Date, end: Date, countryCode: string }} opts
 */
async function selectNoonOrderLines({ start, end, countryCode }) {
  const res = await query(
    `SELECT country_code, order_nr, item_nr, noon_sku, partner_sku, item_status,
            order_placed_at, delivered_at, warehouse_code, is_fulfilled_by_noon,
            shipment_nr, last_synced_at
     FROM noon_order_lines
     WHERE UPPER(country_code) = UPPER($1)
       AND order_placed_at >= $2
       AND order_placed_at < $3
     ORDER BY order_placed_at, order_nr, item_nr`,
    [countryCode, start, end],
  )
  return res.rows || []
}

/**
 * Line counts per Noon marketplace country across the whole cache.
 *
 * Used to tell "this partner account has no store in that country" apart from "that country had
 * no order on this date", which the report must not confuse.
 */
async function countLinesByCountry() {
  const res = await query(
    `SELECT UPPER(country_code) AS country_code, COUNT(*)::int AS lines
     FROM noon_order_lines
     GROUP BY 1`,
  )
  const map = new Map()
  for (const row of res.rows || []) map.set(row.country_code, row.lines)
  return map
}

async function upsertNoonFinanceRow(row) {
  await query(
    `INSERT INTO noon_order_finance_rows (
       order_nr, item_nr, reference_nr, transaction_type, contract, contract_title, country_code,
       currency, order_date, transaction_date, net_proceeds, referral_fee, fulfillment_fee,
       shipping_credits, other_order_fees, order_subsidies, total, raw_row, last_synced_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$19)
     ON CONFLICT (order_nr, item_nr, reference_nr, transaction_type) DO UPDATE SET
       contract = EXCLUDED.contract,
       contract_title = EXCLUDED.contract_title,
       country_code = EXCLUDED.country_code,
       currency = EXCLUDED.currency,
       order_date = EXCLUDED.order_date,
       transaction_date = EXCLUDED.transaction_date,
       net_proceeds = EXCLUDED.net_proceeds,
       referral_fee = EXCLUDED.referral_fee,
       fulfillment_fee = EXCLUDED.fulfillment_fee,
       shipping_credits = EXCLUDED.shipping_credits,
       other_order_fees = EXCLUDED.other_order_fees,
       order_subsidies = EXCLUDED.order_subsidies,
       total = EXCLUDED.total,
       raw_row = EXCLUDED.raw_row,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = EXCLUDED.last_synced_at`,
    [
      row.orderNr,
      row.itemNr || '',
      row.referenceNr || '',
      row.transactionType || '',
      row.contract,
      row.contractTitle,
      row.countryCode,
      row.currency,
      row.orderDate,
      row.transactionDate,
      row.netProceeds,
      row.referralFee,
      row.fulfillmentFee,
      row.shippingCredits,
      row.otherOrderFees,
      row.orderSubsidies,
      row.total,
      JSON.stringify(row.rawRow || {}),
      row.lastSyncedAt || new Date(),
    ],
  )
}

/**
 * Per-order Noon money for the given order numbers, aggregated over every settlement row Noon
 * has published for them (an order can be corrected by a later `order_update`).
 */
async function selectNoonFinanceByOrders(orderNumbers) {
  if (!orderNumbers.length) return []
  const res = await query(
    `SELECT order_nr,
            SUM(COALESCE(net_proceeds, 0))::numeric AS net_proceeds,
            SUM(COALESCE(referral_fee, 0))::numeric AS referral_fee,
            SUM(COALESCE(fulfillment_fee, 0) + COALESCE(shipping_credits, 0))::numeric AS logistics,
            MAX(currency) AS currency,
            MAX(transaction_date) AS transaction_date
     FROM noon_order_finance_rows
     WHERE order_nr = ANY($1::text[])
       AND transaction_type = ANY($2::text[])
     GROUP BY order_nr`,
    [orderNumbers, ['order', 'order_update']],
  )
  return res.rows || []
}

async function insertExportRun({ exportCategoryCode, fromDate, toDate, status }) {
  const res = await query(
    `INSERT INTO noon_order_export_runs (export_category_code, from_date, to_date, status)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [exportCategoryCode, fromDate, toDate, status],
  )
  return res.rows[0].id
}

async function updateExportRun(id, patch) {
  await query(
    `UPDATE noon_order_export_runs SET
       export_code = COALESCE($2, export_code),
       status = COALESCE($3, status),
       rows_parsed = COALESCE($4, rows_parsed),
       rows_saved = COALESCE($5, rows_saved),
       poll_count = COALESCE($6, poll_count),
       error_message = $7,
       finished_at = COALESCE($8, finished_at)
     WHERE id = $1`,
    [
      id,
      patch.exportCode ?? null,
      patch.status ?? null,
      patch.rowsParsed ?? null,
      patch.rowsSaved ?? null,
      patch.pollCount ?? null,
      patch.errorMessage ?? null,
      patch.finishedAt ?? null,
    ],
  )
}

/** Most recent successful export run, used to show the report's data age. */
async function selectLastSuccessfulRun(exportCategoryCode) {
  const res = await query(
    `SELECT id, export_code, from_date, to_date, rows_saved, finished_at
     FROM noon_order_export_runs
     WHERE export_category_code = $1 AND status = 'success'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`,
    [exportCategoryCode],
  )
  return res.rows[0] || null
}

/**
 * The most recent successful export whose requested window actually contains `ymd`. Used to tell
 * "Noon reported no order that day" from "nobody has asked Noon about that day yet".
 *
 * @param {string} exportCategoryCode
 * @param {string} ymd YYYY-MM-DD
 */
async function findSuccessfulRunCoveringDate(exportCategoryCode, ymd) {
  const res = await query(
    `SELECT id, export_code, from_date, to_date, rows_saved, finished_at
     FROM noon_order_export_runs
     WHERE export_category_code = $1
       AND status = 'success'
       AND from_date <= $2::date
       AND to_date >= $2::date
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`,
    [exportCategoryCode, ymd],
  )
  return res.rows[0] || null
}

module.exports = {
  ensureNoonOrderTables,
  upsertNoonOrderLine,
  selectNoonOrderLines,
  countLinesByCountry,
  upsertNoonFinanceRow,
  selectNoonFinanceByOrders,
  upsertNoonSkuDailySales,
  selectNoonSkuDailySales,
  upsertNoonCatalogPrice,
  selectNoonCatalogPrices,
  getNoonCatalogFreshness,
  insertExportRun,
  updateExportRun,
  selectLastSuccessfulRun,
  findSuccessfulRunCoveringDate,
}
