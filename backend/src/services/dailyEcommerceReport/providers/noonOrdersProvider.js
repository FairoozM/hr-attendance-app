'use strict'

/**
 * Noon UAE / KSA orders for the Daily Ecommerce Report.
 *
 * Source chain: Noon Partner API OMS orders export (`noon_noonoms_ordersexport` via
 * `/impex/v1/export/*`) → `noon_order_lines` → report. UAE vs KSA comes from Noon's own
 * `market_place_country_code`, and inclusion is decided by `order_placed_at`, the Noon order
 * timestamp, converted from UTC to the Dubai day boundaries of the report date.
 *
 * Money is a separate Noon feed. The OMS orders export carries no money at all, so per-order
 * proceeds and fees come from Noon's finance item-level transaction report
 * (`noon_financeweb_transactionviewreportonitemlevel` → `noon_order_finance_rows`), with
 * already-imported Noon settlement statements (`noon_payment_clearing_rows`) as a second
 * Noon-issued source for older orders. Both are matched by Noon order number rather than by a
 * printed date, because Noon prints statement dates in mixed formats.
 *
 * Noon settles an order 1 to 8 days after it is placed, so on a recent day most orders have no
 * settlement yet. Summing only the settled ones would report a fraction of the day as if it were the
 * whole day — on 2026-09-08 that was AED 590 of a day Noon itself puts at AED 2,329. So an unsettled
 * order is priced from Noon's own per-SKU daily sales report (`noon_sku_daily_sales`), matched on
 * Noon sku and the order's Noon calendar date. Where an order has since settled, that report's unit
 * price equals the settled net proceeds exactly, which is why it is trusted for the ones that have
 * not.
 *
 * That report is itself published about two days late, so a day only hours old has nothing in either
 * feed. For those orders the price Noon currently lists the item at (`noon_catalog_prices`) is used
 * as a last resort. It is an estimate, not money Noon has reported — against 22 settled Noon UAE
 * orders it was exact 19 times and too high 3 times where the price had since changed — so such an
 * order carries `amountIsEstimate` and the channel reports how much of its total is estimated. Every
 * estimate is replaced by Noon's own figure as soon as Noon publishes one.
 *
 * An order that none of the three sources can price stays Pending, never zero.
 */

const { query } = require('../../../db')
const { computeChannelFinancials } = require('../formulas')
const { round2, toAed, toFiniteNumber } = require('../money')
const { buildChannelShell, channelMeta } = require('../channels')
const noonStore = require('../../noon/noonOrdersStore')
const { ORDERS_EXPORT_CATEGORY } = require('../../noon/noonOrdersExportService')
const { readNoonConfig } = require('../../noon/noonConfig')

const SETTLED_TRANSACTION_TYPES = ['order', 'order_update']
const CANCELLED_ITEM_STATUSES = new Set(['cancelled', 'canceled', 'killed', 'failed'])

function countryCodeFor(channelKey) {
  return channelKey === 'noon_ksa' ? 'SA' : 'AE'
}

/**
 * Settled Noon money for the given order numbers, keyed by order number.
 *
 * Matching on the Noon order number avoids the printed statement date entirely: Noon statements
 * mix `M/D/YY` and `DD/MM/YYYY` in different batches, so any date-based match silently mixes up
 * days (for example `09/08/2026` is 9 August, not 8 September).
 *
 * Noon's finance API report wins over an imported statement for the same order, so a re-imported
 * statement can never double-count.
 */
async function loadSettledMoney(orderNumbers, fallbackCurrency, fx) {
  /** @type {Map<string, { amount: number, commission: number, shipping: number, currency: string, source: string }>} */
  const map = new Map()
  if (!orderNumbers.length) return map

  const financeRows = await noonStore.selectNoonFinanceByOrders(orderNumbers)
  for (const row of financeRows) {
    const orderNr = String(row.order_nr || '').trim()
    if (!orderNr) continue
    const currency = String(row.currency || fallbackCurrency)
    // Noon posts a refund as a negative `order_update` against the original order, so the summed net
    // proceeds can legitimately be negative or zero. Taking its absolute value would turn a refunded
    // order back into a positive sale, so the sign is kept. Fees are always negative in Noon's
    // report, and they are cost rows here, so those are the ones made positive.
    map.set(orderNr, {
      amount: toAed(toFiniteNumber(row.net_proceeds, 0), currency, fx),
      commission: toAed(Math.abs(toFiniteNumber(row.referral_fee, 0)), currency, fx),
      shipping: toAed(Math.abs(toFiniteNumber(row.logistics, 0)), currency, fx),
      currency,
      source: 'noon_finance_transaction_report',
    })
  }

  const res = await query(
    `SELECT r.order_nr,
            SUM(COALESCE(r.net_proceed, 0))::numeric AS net_proceed,
            SUM(COALESCE(r.referral_fee, 0))::numeric AS referral_fee,
            SUM(COALESCE(r.fulfillment_fee, 0) + COALESCE(r.shipping_charges, 0))::numeric AS logistics,
            MAX(r.currency) AS currency
     FROM noon_payment_clearing_rows r
     WHERE r.order_nr = ANY($1::text[])
       AND r.transaction_type = ANY($2::text[])
     GROUP BY r.order_nr`,
    [orderNumbers, SETTLED_TRANSACTION_TYPES],
  )
  for (const row of res.rows || []) {
    const orderNr = String(row.order_nr || '').trim()
    if (!orderNr || map.has(orderNr)) continue
    const currency = String(row.currency || fallbackCurrency)
    map.set(orderNr, {
      amount: toAed(toFiniteNumber(row.net_proceed, 0), currency, fx),
      commission: toAed(Math.abs(toFiniteNumber(row.referral_fee, 0)), currency, fx),
      shipping: toAed(Math.abs(toFiniteNumber(row.logistics, 0)), currency, fx),
      currency,
      source: 'noon_settlement_statement',
    })
  }
  return map
}

/**
 * Noon's own selling price per unit, per Noon sku, for one Noon calendar day.
 *
 * Noon reports the day's revenue and units per SKU, so the unit price is revenue ÷ units. `shipped`
 * is preferred because `revenue_shipped` is the revenue of those units; when a SKU shipped nothing
 * that day, gross units are used so an order placed but not yet shipped is still priced.
 *
 * A SKU with revenue but no units at all yields no price rather than a division by zero.
 *
 * @param {string} countryCode
 * @param {string[]} salesYmds Noon calendar dates the day's orders fall on
 * @returns {Promise<{ priceBySku: Map<string, { unitPrice: number, currency: string|null, basis: string, lastSyncedAt: Date|null }>, error: string|null }>}
 */
async function loadNoonSkuUnitPrices(countryCode, salesYmds) {
  /** @type {Map<string, { unitPrice: number, currency: string|null, basis: string, lastSyncedAt: Date|null }>} */
  const priceBySku = new Map()
  for (const ymd of salesYmds) {
    let rows
    try {
      rows = await noonStore.selectNoonSkuDailySales(countryCode, ymd)
    } catch (err) {
      console.error(
        `[dailyEcommerceReport] noon ${countryCode} sku daily sales lookup failed for ${ymd}:`,
        err,
      )
      return { priceBySku, error: err && err.message ? err.message : String(err) }
    }
    for (const row of rows) {
      const sku = String(row.noon_sku || '').trim()
      if (!sku) continue
      const revenue = toFiniteNumber(row.revenue_shipped, 0)
      const shipped = toFiniteNumber(row.shipped_units, 0)
      const gross = toFiniteNumber(row.gross_units, 0)
      const units = shipped > 0 ? shipped : gross
      if (!units || !revenue) continue
      // Two Noon calendar days can both touch one Dubai day; the first priced day wins, and the
      // second only fills SKUs the first did not price.
      if (priceBySku.has(sku)) continue
      priceBySku.set(sku, {
        unitPrice: revenue / units,
        currency: row.currency ? String(row.currency).toUpperCase() : null,
        basis: shipped > 0 ? 'shipped_units' : 'gross_units',
        // This report names our own SKU too, which is the only mapping for an item that has since
        // been delisted and so no longer appears in Noon's live catalog.
        partnerSku: String(row.partner_sku || '').trim() || null,
        lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
      })
    }
  }
  return { priceBySku, error: null }
}

/**
 * Noon's live catalog price and our own item code for the given Noon skus.
 *
 * This is the last-resort price. `active_price` is what the item is listed at now, not what a past
 * order was actually charged, so an order priced this way is an estimate and has to be labelled one.
 * Measured against 22 settled Noon UAE orders it matched the settled proceeds exactly 19 times and
 * was too high 3 times, in each case because the price had changed since the order.
 *
 * @param {string} countryCode
 * @param {string[]} noonSkus
 */
async function loadCatalogPrices(countryCode, noonSkus) {
  /** @type {Map<string, { unitPrice: number|null, partnerSku: string|null, lastSyncedAt: Date|null }>} */
  const bySku = new Map()
  const unique = [...new Set(noonSkus.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!unique.length) return { bySku, error: null }
  let rows
  try {
    rows = await noonStore.selectNoonCatalogPrices(countryCode, unique)
  } catch (err) {
    console.error(`[dailyEcommerceReport] noon ${countryCode} catalog price lookup failed:`, err)
    return { bySku, error: err && err.message ? err.message : String(err) }
  }
  for (const row of rows) {
    const sku = String(row.noon_sku || '').trim()
    if (!sku) continue
    const price = toFiniteNumber(row.active_price, 0)
    bySku.set(sku, {
      unitPrice: price > 0 ? price : null,
      partnerSku: String(row.partner_sku || '').trim() || null,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    })
  }
  return { bySku, error: null }
}

/** `Z…Z-1` in the orders export is Noon's psku plus a variant index. */
function noonPskuOf(noonSku) {
  const s = String(noonSku || '').trim()
  if (!s) return null
  return s.replace(/-\d+$/, '')
}

/**
 * Our own item codes for the Noon pskus on these order lines, where the Noon catalog knows them.
 *
 * The OMS orders export identifies items by Noon psku only. The Noon catalog snapshots this app
 * syncs from the Noon catalog API carry the partner SKU and print the psku inside the Noon CDN
 * image path, which is the only place the two identifiers meet. Unmapped items keep the Noon psku
 * rather than showing a blank or invented code.
 */
async function loadPartnerSkus(noonSkus) {
  const map = new Map()
  const unique = [...new Set(noonSkus.map(noonPskuOf).filter(Boolean))]
  if (!unique.length) return map
  const res = await query(
    `SELECT (regexp_match(COALESCE(image_url, ''), 'pzsku/(Z[0-9A-Z]+Z)'))[1] AS psku,
            MAX(partner_sku) AS partner_sku
     FROM noon_product_snapshots
     WHERE (regexp_match(COALESCE(image_url, ''), 'pzsku/(Z[0-9A-Z]+Z)'))[1] = ANY($1::text[])
     GROUP BY 1`,
    [unique],
  )
  for (const row of res.rows || []) {
    const partner = String(row.partner_sku || '').trim()
    if (row.psku && partner) map.set(String(row.psku), partner)
  }
  return map
}

/**
 * @param {'noon_uae'|'noon_ksa'} channelKey
 * @param {{ start: Date, end: Date, dateYmd: string }} bounds
 * @param {{ rate: number }} fx
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null }} ads
 */
async function loadNoonChannel(channelKey, bounds, fx, ads) {
  const meta = channelMeta(channelKey)
  const countryCode = countryCodeFor(channelKey)
  const adsSummary = { adSpendAED: ads.adSpendAED, clicks: ads.clicks }
  const dataSource = 'noon_partner_api_oms_orders_export'

  const noonConfig = readNoonConfig()
  if (!noonConfig.configured) {
    const detail = noonConfig.enabled
      ? `Noon API configuration is incomplete (${noonConfig.missing.join(', ') || 'unknown'})`
      : 'Noon API integration is disabled (NOON_API_ENABLED)'
    return buildChannelShell(meta, 'not_configured', {
      dataSource,
      warnings: [`${meta.label}: ${detail}`],
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      summary: {
        ...buildChannelShell(meta, 'not_configured').summary,
        ...adsSummary,
        quantity: null,
        commissionAED: null,
        shippingAED: null,
      },
    })
  }

  let lines
  let lastRun
  let coveringRun
  let linesByCountry
  try {
    await noonStore.ensureNoonOrderTables()
    lines = await noonStore.selectNoonOrderLines({
      start: bounds.start,
      end: bounds.end,
      countryCode,
    })
    lastRun = await noonStore.selectLastSuccessfulRun(ORDERS_EXPORT_CATEGORY)
    coveringRun = await noonStore.findSuccessfulRunCoveringDate(
      ORDERS_EXPORT_CATEGORY,
      bounds.dateYmd,
    )
    linesByCountry = await noonStore.countLinesByCountry()
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    console.error(`[dailyEcommerceReport] ${meta.label} Noon order cache read failed:`, err)
    return buildChannelShell(meta, 'unavailable', {
      dataSource,
      warnings: [`${meta.label}: Data Error — ${message}`],
      errorDetail: message,
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      summary: {
        ...buildChannelShell(meta, 'unavailable').summary,
        ...adsSummary,
        commissionAED: null,
        shippingAED: null,
      },
    })
  }

  if (!lines.length) {
    // Nothing cached for this Noon country and day. Three different situations, three different
    // messages: no export has covered this date, this partner account has no store in that country
    // at all, or Noon genuinely had no order there on this date. Only the last one may report zero,
    // and that needs an export whose window actually included the date — a run that covered
    // 6–8 September says nothing about the 9th.
    const neverSynced = !coveringRun
    const countryEverSeen = (linesByCountry?.get(countryCode) || 0) > 0
    if (!neverSynced && !countryEverSeen) {
      return buildChannelShell(meta, 'not_configured', {
        dataSource,
        lastSyncedAt: lastRun?.finished_at ? new Date(lastRun.finished_at).toISOString() : null,
        warnings: [
          `${meta.label}: this Noon partner account (project ${noonConfig.projectCode || 'n/a'}) has no ${countryCode} marketplace contract — every order the Noon orders export returns is ${[...(linesByCountry?.keys() || [])].join(', ') || 'none'}`,
        ],
        adsStatus: ads.adsStatus,
        adsProvider: ads.adsProvider,
        summary: {
          ...buildChannelShell(meta, 'not_configured').summary,
          ...adsSummary,
          quantity: null,
          commissionAED: null,
          shippingAED: null,
        },
      })
    }
    const warning = neverSynced
      ? `${meta.label}: no Noon orders export has covered ${bounds.dateYmd} yet${
          lastRun ? ` (the last one covered ${lastRun.from_date} → ${lastRun.to_date})` : ''
        } — press Refresh to pull it from the Noon API`
      : `${meta.label}: the Noon orders export returned no ${countryCode} order for ${bounds.dateYmd} (export ${coveringRun.finished_at ? new Date(coveringRun.finished_at).toISOString() : 'n/a'} covered ${coveringRun.from_date} → ${coveringRun.to_date})`
    return buildChannelShell(meta, neverSynced ? 'pending' : 'available', {
      dataSource,
      lastSyncedAt: lastRun?.finished_at ? new Date(lastRun.finished_at).toISOString() : null,
      warnings: [warning],
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      reconciliation: {
        rawApiLines: 0,
        uniqueOrderIds: 0,
        includedOrders: 0,
        cancelledLines: 0,
        settledOrders: 0,
      },
      summary: {
        ...buildChannelShell(meta, neverSynced ? 'pending' : 'available').summary,
        ...adsSummary,
        quantity: neverSynced ? null : 0,
        commissionAED: neverSynced ? null : 0,
        shippingAED: neverSynced ? null : 0,
      },
    })
  }

  // Noon's live catalog: our own item code for each Noon psku, and the last-resort price.
  const { bySku: catalog, error: catalogError } = await loadCatalogPrices(
    countryCode,
    lines.map((l) => l.noon_sku),
  )

  let partnerSkus = new Map()
  try {
    partnerSkus = await loadPartnerSkus(lines.map((l) => l.noon_sku))
  } catch (err) {
    // A missing catalog mapping only changes the item code shown, never an amount.
    console.warn(
      `[dailyEcommerceReport] ${meta.label} Noon partner SKU lookup skipped:`,
      err && err.message ? err.message : err,
    )
  }

  // Noon settles days later, so without its own sales report a recent day would report only the
  // handful of orders that happen to have settled. Loaded before the order lines are grouped because
  // it also names items that have since left Noon's live catalog.
  const { priceBySku, error: salesPriceError } = await loadNoonSkuUnitPrices(countryCode, [
    bounds.dateYmd,
  ])

  /** @type {Map<string, { items: object[], statuses: Set<string>, placedAt: Date|null, cancelled: number }>} */
  const byOrder = new Map()
  let cancelledLines = 0
  for (const line of lines) {
    const orderNr = String(line.order_nr || '').trim()
    if (!orderNr) continue
    const status = String(line.item_status || '').trim().toLowerCase()
    if (CANCELLED_ITEM_STATUSES.has(status)) {
      cancelledLines += 1
      continue
    }
    if (!byOrder.has(orderNr)) {
      byOrder.set(orderNr, {
        items: [],
        statuses: new Set(),
        placedAt: line.order_placed_at ? new Date(line.order_placed_at) : null,
        cancelled: 0,
      })
    }
    const bucket = byOrder.get(orderNr)
    bucket.statuses.add(status || 'unknown')
    // Noon issues one item number per unit, so each cached line is one unit of one SKU.
    const noonSku = String(line.noon_sku || '').trim()
    // Noon's live catalog is the reliable psku-to-item-code map; the catalog image-path match is a
    // weaker fallback, and Noon's own opaque psku is only shown when nothing knows the item.
    const mappedSku =
      String(line.partner_sku || '').trim() ||
      catalog.get(noonSku)?.partnerSku ||
      priceBySku.get(noonSku)?.partnerSku ||
      partnerSkus.get(noonPskuOf(noonSku)) ||
      noonSku
    bucket.items.push({
      sku: mappedSku || '(no SKU in Noon export)',
      noonSku: noonSku || null,
      quantity: 1,
      itemOrderId: line.item_nr || null,
      status: status || null,
    })
  }

  const orderNumbers = [...byOrder.keys()]
  let settled = new Map()
  let settlementFailed = false
  try {
    settled = await loadSettledMoney(orderNumbers, meta.currency, fx)
  } catch (err) {
    settlementFailed = true
    console.error(`[dailyEcommerceReport] ${meta.label} Noon settlement lookup failed:`, err)
  }

  const warnings = []
  if (salesPriceError) {
    warnings.push(
      `${meta.label}: Noon per-SKU sales lookup failed (${salesPriceError}); unsettled orders will have no amount`,
    )
  }

  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let commissionKnown = 0
  let shippingKnown = 0
  let settledOrders = 0
  let pricedFromSalesReport = 0
  let pricedFromCatalog = 0
  let estimatedAmountAED = 0
  let unpricedOrders = 0

  for (const [orderNr, bucket] of byOrder.entries()) {
    // Collapse repeated units of one SKU into a single line with its real quantity. Noon's psku is
    // kept per line because the sales report is keyed by it, not by our own item code.
    const bySku = new Map()
    for (const item of bucket.items) {
      if (!bySku.has(item.sku)) {
        bySku.set(item.sku, {
          sku: item.sku,
          quantity: 0,
          status: item.status,
          noonSku: item.noonSku,
        })
      }
      bySku.get(item.sku).quantity += item.quantity
    }
    const items = [...bySku.values()]
    const orderQty = items.reduce((acc, i) => acc + i.quantity, 0)
    quantity += orderQty

    const settledMoney = settled.get(orderNr) || null

    // Noon's own price for this order's SKUs on this day. Only used when every line can be priced —
    // a partly priced order would be a smaller number pretending to be the order's value.
    let salesReportAmount = null
    let salesReportCurrency = null
    if (!settledMoney && priceBySku.size > 0) {
      let total = 0
      let allPriced = true
      for (const line of items) {
        const priced = line.noonSku ? priceBySku.get(String(line.noonSku).trim()) : null
        if (!priced) {
          allPriced = false
          break
        }
        total += priced.unitPrice * line.quantity
        if (!salesReportCurrency) salesReportCurrency = priced.currency
      }
      if (allPriced) salesReportAmount = total
    }

    // Last resort: the price Noon lists the item at today. Only used when Noon has published no money
    // for the order at all, which is the normal state of a day that is only hours old.
    let catalogAmount = null
    if (!settledMoney && salesReportAmount == null) {
      let total = 0
      let allPriced = true
      for (const line of items) {
        const priced = line.noonSku ? catalog.get(String(line.noonSku).trim()) : null
        if (!priced || priced.unitPrice == null) {
          allPriced = false
          break
        }
        total += priced.unitPrice * line.quantity
      }
      if (allPriced) catalogAmount = total
    }

    let money = settledMoney
    let isEstimate = false
    if (money) {
      settledOrders += 1
    } else if (salesReportAmount != null) {
      money = {
        amount: toAed(salesReportAmount, salesReportCurrency || meta.currency, fx),
        // Noon publishes fees only at settlement, so they stay unknown rather than becoming zero.
        commission: null,
        shipping: null,
        currency: salesReportCurrency || meta.currency,
        source: 'noon_sku_daily_sales_report',
      }
      pricedFromSalesReport += 1
    } else if (catalogAmount != null) {
      money = {
        amount: toAed(catalogAmount, meta.currency, fx),
        commission: null,
        shipping: null,
        currency: meta.currency,
        source: 'noon_catalog_active_price',
      }
      isEstimate = true
      pricedFromCatalog += 1
      estimatedAmountAED += money.amount
    } else {
      unpricedOrders += 1
    }

    if (money) {
      salesAmountAED += money.amount
      if (money.commission != null) commissionKnown += money.commission
      if (money.shipping != null) shippingKnown += money.shipping
    }

    orders.push({
      orderId: orderNr,
      orderNumber: orderNr,
      orderDate: bucket.placedAt ? bucket.placedAt.toISOString() : null,
      status: [...bucket.statuses].join(', '),
      items: items.map(({ sku, quantity: q, status }) => ({ sku, quantity: q, status })),
      amountAED: money ? round2(money.amount) : null,
      commissionAED: money && money.commission != null ? round2(money.commission) : null,
      shippingAED: money && money.shipping != null ? round2(money.shipping) : null,
      amountSource: money ? money.source : 'pending_noon_settlement',
      // The page must be able to tell a listed price apart from money Noon has actually reported.
      amountIsEstimate: isEstimate,
      feesSource: settledMoney ? settledMoney.source : null,
    })
  }

  orders.sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)))

  const unsettled = orders.length - settledOrders
  if (settlementFailed) {
    warnings.push(
      `${meta.label}: Noon settlement lookup failed, so amounts and fees are Pending for every order on this date`,
    )
  } else if (unsettled > 0) {
    warnings.push(
      `${meta.label}: Noon has not settled ${unsettled} of ${orders.length} order(s) for ${bounds.dateYmd}, so their commission and shipping are Pending — Noon publishes per-order fees only in its settlement report`,
    )
  }
  if (pricedFromSalesReport > 0) {
    warnings.push(
      `${meta.label}: ${pricedFromSalesReport} unsettled order(s) are valued from Noon's own per-SKU sales report for ${bounds.dateYmd} and are included in Noon Amount`,
    )
  }
  if (pricedFromCatalog > 0) {
    warnings.push(
      `${meta.label}: ${pricedFromCatalog} order(s) worth AED ${round2(estimatedAmountAED)} are estimated from Noon's current listed price, because Noon has published neither a settlement nor a sales figure for them yet — the amount will be replaced by Noon's own money once it does`,
    )
  }
  if (catalogError) {
    warnings.push(`${meta.label}: Noon catalog price lookup failed (${catalogError})`)
  }
  // The whole point of pulling the sales report: never show part of a day as if it were the day.
  if (unpricedOrders > 0) {
    warnings.push(
      `${meta.label}: ${unpricedOrders} of ${orders.length} order(s) have no Noon-reported money in either the settlement report or the per-SKU sales report for ${bounds.dateYmd}, so Noon Amount is lower than the real day — press Refresh once Noon publishes them`,
    )
  }
  if (cancelledLines > 0) {
    warnings.push(`${meta.label}: ${cancelledLines} cancelled Noon item line(s) excluded`)
  }

  const anyMoney =
    !settlementFailed && settledOrders + pricedFromSalesReport + pricedFromCatalog > 0
  const salesTotal = round2(salesAmountAED)
  // Fees exist only for settled orders, so they stay unknown while nothing has settled — reporting 0
  // would claim Noon charged no commission on the day.
  const feesKnown = !settlementFailed && settledOrders > 0
  const commissionAED = feesKnown ? round2(commissionKnown) : null
  const shippingAED = feesKnown ? round2(shippingKnown) : null

  const financials = computeChannelFinancials({
    salesAmountAED: salesTotal,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
  })

  const lastSyncedAt = lines.reduce((acc, l) => {
    const t = l.last_synced_at ? new Date(l.last_synced_at).getTime() : 0
    return t > acc ? t : acc
  }, 0)

  return buildChannelShell(meta, 'available', {
    dataSource,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings,
    reconciliation: {
      rawApiLines: lines.length,
      uniqueOrderIds: new Set(lines.map((l) => String(l.order_nr))).size,
      includedOrders: orders.length,
      cancelledLines,
      settledOrders,
      ordersFromSalesReport: pricedFromSalesReport,
      ordersEstimatedFromCatalogPrice: pricedFromCatalog,
      estimatedAmountAED: round2(estimatedAmountAED),
      ordersWithoutNoonAmount: unpricedOrders,
      skusPricedBySalesReport: priceBySku.size,
    },
    summary: {
      quantity,
      salesAmountAED: anyMoney ? salesTotal : null,
      // How much of the amount above is a listed-price estimate rather than money Noon has reported.
      estimatedAmountAED: pricedFromCatalog > 0 ? round2(estimatedAmountAED) : null,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED,
      shippingAED,
      // Cost % and Balance are both amount-minus-costs, so with no fee known they would read as a
      // cost-free day. They stay Pending until Noon publishes at least one settlement.
      costPercentage: anyMoney && feesKnown ? financials.costPercentage : null,
      balanceAED: anyMoney && feesKnown ? financials.balanceAED : null,
    },
  })
}

module.exports = {
  loadNoonChannel,
  loadSettledMoney,
  loadNoonSkuUnitPrices,
  loadCatalogPrices,
  loadPartnerSkus,
  noonPskuOf,
  countryCodeFor,
  CANCELLED_ITEM_STATUSES,
}
