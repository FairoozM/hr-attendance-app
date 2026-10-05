'use strict'

/**
 * `amazon_order_report_lines` → one row per (marketplace, local sales date, SKU).
 *
 * Day boundaries are the marketplace's own calendar (KSA: Asia/Riyadh), taken from the line's
 * purchase date. The rollup is a pure function of the lines, so rebuilding a date range always
 * produces the same rows.
 *
 * Money (from the flat-file order report):
 *   gross_item_sales = Σ item-price as reported
 *   item_tax         = Σ item-tax as reported (often blank on amazon.sa / amazon.ae)
 *   promotions       = Σ |item-promotion-discount|
 *   net_sales_ex_vat = Σ per line:
 *     - item-tax ≈ vatRate × (price − promotion)  → price is VAT-exclusive: price − promotion
 *     - otherwise (tax blank / 0 / VAT portion)   → price is VAT-inclusive (Gulf marketplaces
 *       display VAT-inclusive prices): (price − promotion) / (1 + vatRate)
 * Shipping and gift wrap are excluded (product sales only). Cancelled lines (item or order status
 * starting with "cancel") add to units_cancelled only. A line without item-price counts units but
 * leaves money unknown; if no line of a SKU-day has a price, the money columns are NULL.
 */

const { normalizeSku } = require('../../utils/normalizeSku')
const { zonedDateString } = require('./controlTowerTime.ts')

type OrderReportLine = {
  amazon_order_id?: string | null
  order_item_id?: string | null
  purchase_date?: string | Date | null
  order_status?: string | null
  item_status?: string | null
  seller_sku?: string | null
  asin?: string | null
  quantity?: number | string | null
  currency?: string | null
  item_price?: number | string | null
  item_tax?: number | string | null
  item_promotion_discount?: number | string | null
}

type DailySalesRow = {
  marketplaceKey: string
  salesDate: string
  sellerSku: string
  asin: string | null
  unitsOrdered: number
  unitsCancelled: number
  orderCount: number
  cancelledOrderCount: number
  grossItemSales: number | null
  itemTax: number | null
  promotions: number | null
  netSalesExVat: number | null
  linesWithoutPrice: number
  currency: string | null
}

type Accumulator = DailySalesRow & {
  _orders: Set<string>
  _cancelledOrders: Set<string>
  _priced: number
}

function num(value: unknown): number | null {
  if (value == null) return null
  const text = String(value).replace(/,/g, '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function isCancelled(line: OrderReportLine): boolean {
  return /^cancel/i.test(String(line.item_status || '').trim()) || /^cancel/i.test(String(line.order_status || '').trim())
}

/** True when item-tax is VAT charged on top of item-price (price excludes VAT). */
function taxIsOnTop(taxable: number, tax: number | null, vatRate: number): boolean {
  if (tax == null || tax <= 0 || vatRate <= 0 || taxable <= 0) return false
  const expected = taxable * vatRate
  return Math.abs(tax - expected) <= Math.max(0.05, expected * 0.02)
}

function netExVat(price: number, promotion: number, tax: number | null, vatRate: number): { net: number; exclusive: boolean } {
  const taxable = price - promotion
  if (taxIsOnTop(taxable, tax, vatRate)) return { net: taxable, exclusive: true }
  return { net: vatRate > 0 ? taxable / (1 + vatRate) : taxable, exclusive: false }
}

function rollupDailySales(
  lines: OrderReportLine[],
  { marketplaceKey, timeZone, vatRate }: { marketplaceKey: string; timeZone: string; vatRate: number }
): { rows: DailySalesRow[]; skippedNoSku: number; skippedNoDate: number; vatExclusiveLines: number; vatInclusiveLines: number } {
  const byKey = new Map<string, Accumulator>()
  let skippedNoSku = 0
  let skippedNoDate = 0
  let vatExclusiveLines = 0
  let vatInclusiveLines = 0
  const rate = Number.isFinite(vatRate) && vatRate >= 0 ? vatRate : 0

  for (const line of lines || []) {
    const sku = normalizeSku(line.seller_sku)
    if (!sku) {
      skippedNoSku += 1
      continue
    }
    const purchased = line.purchase_date instanceof Date ? line.purchase_date : new Date(String(line.purchase_date || ''))
    if (!line.purchase_date || Number.isNaN(purchased.getTime())) {
      skippedNoDate += 1
      continue
    }
    const salesDate = zonedDateString(purchased, timeZone)
    const key = `${salesDate}\u0001${sku}`
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        marketplaceKey,
        salesDate,
        sellerSku: sku,
        asin: null,
        unitsOrdered: 0,
        unitsCancelled: 0,
        orderCount: 0,
        cancelledOrderCount: 0,
        grossItemSales: null,
        itemTax: null,
        promotions: null,
        netSalesExVat: null,
        linesWithoutPrice: 0,
        currency: null,
        _orders: new Set(),
        _cancelledOrders: new Set(),
        _priced: 0,
      }
      byKey.set(key, acc)
    }
    if (!acc.asin && line.asin) acc.asin = String(line.asin).trim() || null
    if (!acc.currency && line.currency) acc.currency = String(line.currency).trim() || null

    const qty = Math.max(0, Math.trunc(num(line.quantity) ?? 0))
    const orderId = String(line.amazon_order_id || '').trim()

    if (isCancelled(line)) {
      acc.unitsCancelled += qty
      if (orderId) acc._cancelledOrders.add(orderId)
      continue
    }

    acc.unitsOrdered += qty
    if (orderId) acc._orders.add(orderId)

    const price = num(line.item_price)
    if (price == null) {
      acc.linesWithoutPrice += 1
      continue
    }
    const tax = num(line.item_tax)
    const promotion = Math.abs(num(line.item_promotion_discount) ?? 0)
    const { net, exclusive } = netExVat(price, promotion, tax, rate)
    if (exclusive) vatExclusiveLines += 1
    else vatInclusiveLines += 1
    acc._priced += 1
    acc.grossItemSales = (acc.grossItemSales ?? 0) + price
    acc.itemTax = (acc.itemTax ?? 0) + (tax ?? 0)
    acc.promotions = (acc.promotions ?? 0) + promotion
    acc.netSalesExVat = (acc.netSalesExVat ?? 0) + net
  }

  const rows: DailySalesRow[] = []
  for (const acc of byKey.values()) {
    const { _orders, _cancelledOrders, _priced, ...row } = acc
    row.orderCount = _orders.size
    row.cancelledOrderCount = [..._cancelledOrders].filter((id) => !_orders.has(id)).length
    if (_priced > 0) {
      row.grossItemSales = round4(row.grossItemSales as number)
      row.itemTax = round4(row.itemTax as number)
      row.promotions = round4(row.promotions as number)
      row.netSalesExVat = round4(row.netSalesExVat as number)
    }
    rows.push(row)
  }
  rows.sort((a, b) => a.salesDate.localeCompare(b.salesDate) || a.sellerSku.localeCompare(b.sellerSku))
  return { rows, skippedNoSku, skippedNoDate, vatExclusiveLines, vatInclusiveLines }
}

module.exports = { rollupDailySales, _internals: { isCancelled, num, taxIsOnTop, netExVat } }
