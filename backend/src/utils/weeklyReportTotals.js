/**
 * Grand Total for weekly Zoho-backed reports: sum only the numeric fields
 * returned on each row. No other business logic.
 */
function sumReportGrandTotals(items) {
  return items.reduce(
    (acc, it) => {
      acc.opening_stock += it.opening_stock
      acc.purchases += it.purchases
      acc.returned_to_wholesale += it.returned_to_wholesale
      acc.closing_stock += it.closing_stock
      acc.sold += it.sold
      return acc
    },
    { opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 }
  )
}

module.exports = { sumReportGrandTotals }
