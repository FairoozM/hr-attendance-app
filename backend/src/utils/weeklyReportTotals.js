/**
 * Grand Total for weekly Zoho-backed reports: sum **finite** values per column.
 * Rows with `null` in a field (e.g. no Zoho `rate` for that family) do not contribute
 * and do not zero out the column; the total is the sum of families that have a number.
 * A column is `null` only when no row had a numeric value (all N/A for that field).
 * An **empty** `items` list returns all zeros (no family rows → zero grand total).
 */
function sumReportGrandTotals(items) {
  const fields = [
    'opening_stock',
    'closing_stock',
    'purchase_amount',
    'returned_to_wholesale',
    'sales_amount',
  ]
  const emptyGrandTotals = () => ({
    opening_stock: 0,
    closing_stock: 0,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    sales_amount: 0,
  })
  if (!Array.isArray(items) || items.length === 0) {
    return emptyGrandTotals()
  }
  const acc = {
    opening_stock: 0,
    closing_stock: 0,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    sales_amount: 0,
  }
  const hasNumeric = {
    opening_stock: false,
    closing_stock: false,
    purchase_amount: false,
    returned_to_wholesale: false,
    sales_amount: false,
  }
  for (const it of items) {
    for (const f of fields) {
      const v = it[f]
      if (typeof v === 'number' && Number.isFinite(v)) {
        hasNumeric[f] = true
        acc[f] += v
      }
    }
  }
  for (const f of fields) {
    if (!hasNumeric[f]) acc[f] = null
  }
  return acc
}

module.exports = { sumReportGrandTotals }
