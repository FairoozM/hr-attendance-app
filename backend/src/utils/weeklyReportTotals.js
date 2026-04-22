/**
 * Grand Total for weekly Zoho-backed reports: sum only finite numeric fields.
 * If any row has `null` in a column (unavailable from the Zoho API integration),
 * the Grand Total for that field is `null` (UI / export show "—").
 */
function sumReportGrandTotals(items) {
  const fields = [
    'opening_stock',
    'purchases',
    'returned_to_wholesale',
    'closing_stock',
    'sold',
  ]
  const acc = {
    opening_stock: 0,
    purchases: 0,
    returned_to_wholesale: 0,
    closing_stock: 0,
    sold: 0,
  }
  const hasNull = {
    opening_stock: false,
    purchases: false,
    returned_to_wholesale: false,
    closing_stock: false,
    sold: false,
  }
  for (const it of items) {
    for (const f of fields) {
      const v = it[f]
      if (v == null) {
        hasNull[f] = true
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        acc[f] += v
      }
    }
  }
  for (const f of fields) {
    if (hasNull[f]) acc[f] = null
  }
  return acc
}

module.exports = { sumReportGrandTotals }
