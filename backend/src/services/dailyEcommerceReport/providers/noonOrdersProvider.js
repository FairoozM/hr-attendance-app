'use strict'

/**
 * Noon UAE / KSA orders for the Daily Ecommerce Report.
 *
 * Source chain: Noon partner settlement statements → `noon_payment_clearing_*`
 * (Noon-issued statement rows, parsed by `noonStatementParserService`) → report.
 *
 * The Noon Partner API in this application exposes catalog, pricing and stock
 * only — it has no order feed — so per-order data comes from Noon's own
 * settlement statements. Statements are published per period, so a date that
 * Noon has not settled yet is reported as `pending`, never as zero orders.
 *
 * UAE vs KSA uses `noon_payment_clearing_batches.marketplace`, which is set
 * from the Noon contract on the statement.
 */

const { query } = require('../../../db')
const { computeChannelFinancials } = require('../formulas')
const { round2, toAed, toFiniteNumber } = require('../money')
const { buildChannelShell, channelMeta } = require('../channels')

const ORDER_TRANSACTION_TYPES = ['order', 'order_update']

function marketplaceCodesFor(channelKey) {
  return channelKey === 'noon_ksa' ? ['SA', 'KSA'] : ['AE', 'UAE']
}

/**
 * Noon statements print order dates as M/D/YY (e.g. 7/27/26).
 * @param {string} raw
 * @returns {string|null} YYYY-MM-DD
 */
function parseStatementDate(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (!month || !day || month > 12 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function loadStatementRows(marketplaceCodes) {
  const res = await query(
    `SELECT
       r.order_nr,
       r.item_nr,
       r.parent_order_id,
       r.item_order_id,
       r.sku,
       r.partner_sku,
       r.transaction_type,
       r.net_proceed,
       r.referral_fee,
       r.fulfillment_fee,
       r.shipping_charges,
       r.total,
       r.currency,
       r.raw_row,
       b.marketplace,
       b.created_at AS batch_created_at
     FROM noon_payment_clearing_rows r
     INNER JOIN noon_payment_clearing_batches b ON b.id = r.batch_id
     WHERE UPPER(COALESCE(b.marketplace, '')) = ANY($1::text[])
       AND r.transaction_type = ANY($2::text[])`,
    [marketplaceCodes, ORDER_TRANSACTION_TYPES],
  )
  return res.rows || []
}

/**
 * @param {'noon_uae'|'noon_ksa'} channelKey
 * @param {{ dateYmd: string }} bounds
 * @param {{ rate: number }} fx
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null }} ads
 */
async function loadNoonChannel(channelKey, bounds, fx, ads) {
  const meta = channelMeta(channelKey)
  const adsSummary = { adSpendAED: ads.adSpendAED, clicks: ads.clicks }

  let rows
  try {
    rows = await loadStatementRows(marketplaceCodesFor(channelKey))
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    console.error(`[dailyEcommerceReport] ${meta.label} Noon statement query failed:`, err)
    return buildChannelShell(meta, 'unavailable', {
      dataSource: 'noon_partner_settlement_statements',
      warnings: [`${meta.label}: Data Error — ${message}`],
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

  if (!rows.length) {
    return buildChannelShell(meta, 'not_configured', {
      dataSource: 'noon_partner_settlement_statements',
      warnings: [
        `${meta.label}: no Noon settlement statement has been imported for this Noon account, and the Noon Partner API in this application has no order feed (catalog, pricing and stock only)`,
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

  const dated = []
  let coverageStart = null
  let coverageEnd = null
  for (const row of rows) {
    const ymd = parseStatementDate(row.raw_row?.['order-date'] || row.raw_row?.orderDate)
    if (!ymd) continue
    if (!coverageStart || ymd < coverageStart) coverageStart = ymd
    if (!coverageEnd || ymd > coverageEnd) coverageEnd = ymd
    dated.push({ ...row, orderYmd: ymd })
  }

  const dayRows = dated.filter((r) => r.orderYmd === bounds.dateYmd)

  if (!dayRows.length && (!coverageEnd || bounds.dateYmd > coverageEnd)) {
    return buildChannelShell(meta, 'pending', {
      dataSource: 'noon_partner_settlement_statements',
      warnings: [
        `${meta.label}: Noon has not published a settlement statement covering ${bounds.dateYmd} yet (latest Noon statement covers order dates up to ${coverageEnd || 'n/a'}). Noon has no order API in this application, so this date is Pending rather than zero.`,
      ],
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      statementCoverage: { start: coverageStart, end: coverageEnd },
      summary: {
        ...buildChannelShell(meta, 'pending').summary,
        ...adsSummary,
        quantity: null,
        commissionAED: null,
        shippingAED: null,
      },
    })
  }

  /** @type {Map<string, { items: object[], amount: number, commission: number, shipping: number }>} */
  const byOrder = new Map()
  const warnings = []
  let missingSku = 0

  for (const row of dayRows) {
    const orderNumber =
      String(row.parent_order_id || row.order_nr || '').trim() || String(row.item_order_id || '').trim()
    if (!orderNumber) continue
    if (!byOrder.has(orderNumber)) {
      byOrder.set(orderNumber, { items: [], amount: 0, commission: 0, shipping: 0 })
    }
    const bucket = byOrder.get(orderNumber)
    const currency = String(row.currency || meta.currency)
    const sku = String(row.partner_sku || row.sku || '').trim()
    if (!sku) missingSku += 1
    bucket.items.push({
      sku: sku || '(not in Noon statement)',
      quantity: null,
      itemOrderId: row.item_order_id || row.item_nr || null,
    })
    bucket.amount += toAed(Math.abs(toFiniteNumber(row.net_proceed, 0)), currency, fx)
    bucket.commission += toAed(Math.abs(toFiniteNumber(row.referral_fee, 0)), currency, fx)
    bucket.shipping += toAed(
      Math.abs(toFiniteNumber(row.shipping_charges, 0)) + Math.abs(toFiniteNumber(row.fulfillment_fee, 0)),
      currency,
      fx,
    )
  }

  const orders = []
  let salesAmountAED = 0
  let commissionAED = 0
  let shippingAED = 0
  for (const [orderNumber, bucket] of byOrder.entries()) {
    salesAmountAED += bucket.amount
    commissionAED += bucket.commission
    shippingAED += bucket.shipping
    orders.push({
      orderId: orderNumber,
      orderNumber,
      orderDate: `${bounds.dateYmd}T00:00:00.000+04:00`,
      items: bucket.items,
      amountAED: round2(bucket.amount),
      commissionAED: round2(bucket.commission),
      shippingAED: round2(bucket.shipping),
      feesSource: 'noon_partner_settlement_statements',
    })
  }

  if (missingSku > 0) {
    warnings.push(`${meta.label}: ${missingSku} settled line(s) carry no SKU in the Noon statement`)
  }
  warnings.push(
    `${meta.label}: Noon settlement statements do not include a unit quantity column, so Qty is shown as N/A`,
  )

  salesAmountAED = round2(salesAmountAED)
  commissionAED = round2(commissionAED)
  shippingAED = round2(shippingAED)

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
  })

  return buildChannelShell(meta, 'available', {
    dataSource: 'noon_partner_settlement_statements',
    lastSyncedAt: dayRows[0]?.batch_created_at
      ? new Date(dayRows[0].batch_created_at).toISOString()
      : null,
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    statementCoverage: { start: coverageStart, end: coverageEnd },
    warnings,
    summary: {
      quantity: null,
      salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED,
      shippingAED,
      costPercentage: financials.costPercentage,
      balanceAED: financials.balanceAED,
    },
  })
}

module.exports = {
  loadNoonChannel,
  parseStatementDate,
  ORDER_TRANSACTION_TYPES,
}
