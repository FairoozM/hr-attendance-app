/**
 * COGS API controller.
 *
 * GET /api/prices/cogs/sales-by-item?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&warehouse_id=]
 *   Returns the minimal sales-by-item rows (sku, qty, unit price) the All Prices
 *   COGS tab needs. Cost prices live client-side in the All Prices preferences, so
 *   this endpoint only exposes sales volume/value; the COGS join happens in the browser.
 *
 * Data source: Zoho Inventory salesbyitem report via getSales(), which already
 * applies quota limits, caching, and the invoice-detail fallback.
 */

const { getSales } = require('../integrations/zoho/zohoAdapter')
const { validateDateRange, handleZohoError } = require('./weeklyReportsController')

function toMinimalSalesRow(line) {
  const qty = Number(line && line.quantity)
  const salesAmount = Number(line && line.item_total)
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0
  const safeSales = Number.isFinite(salesAmount) && salesAmount > 0 ? salesAmount : 0
  const unitPrice = safeQty > 0 ? safeSales / safeQty : 0
  return {
    sku: line && line.sku != null ? String(line.sku).trim() : '',
    item_id: line && line.item_id != null ? String(line.item_id).trim() : '',
    item_name: line && line.name != null ? String(line.name).trim() : '',
    qty: safeQty,
    sales_amount: safeSales,
    unit_price: unitPrice,
  }
}

/**
 * GET /api/prices/cogs/sales-by-item
 */
async function getSalesByItem(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return undefined

  const warehouseId =
    req.query.warehouse_id != null ? String(req.query.warehouse_id).trim() : ''

  try {
    const sales = await getSales(range.from_date, range.to_date, {
      warehouseId: warehouseId || undefined,
    })
    const lines = Array.isArray(sales && sales.lines) ? sales.lines : []
    const rows = lines.map(toMinimalSalesRow).filter((r) => r.qty > 0)
    return res.json({
      rows,
      meta: {
        from_date: range.from_date,
        to_date: range.to_date,
        warehouse_id: warehouseId || null,
        source: sales && sales.source ? sales.source : null,
        truncated: !!(sales && sales.list_truncated),
        fallback_used: !!(sales && sales.fallback_used),
      },
    })
  } catch (err) {
    return await handleZohoError(res, err, 'getSalesByItem')
  }
}

module.exports = {
  getSalesByItem,
}
