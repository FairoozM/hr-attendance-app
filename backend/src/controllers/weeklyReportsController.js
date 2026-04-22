const { getSlowMovingInventory } = require('../services/zohoService')

/**
 * GET /api/weekly-reports/slow-moving?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Returns the Weekly Slow Moving Sales Report sourced directly from Zoho
 * Inventory. All numeric values (opening stock, purchases, returned to
 * wholesale, closing stock, sold) come verbatim from Zoho — nothing is
 * derived or calculated here except for the Grand Total row which aggregates
 * the Zoho-provided values for display purposes only.
 */
async function getSlowMovingReport(req, res) {
  const { from_date, to_date } = req.query

  if (!from_date || !to_date) {
    return res.status(400).json({
      error: 'Missing required query parameters: from_date and to_date (YYYY-MM-DD)',
    })
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRe.test(from_date) || !dateRe.test(to_date)) {
    return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' })
  }

  if (from_date > to_date) {
    return res.status(400).json({ error: 'from_date must be before or equal to to_date' })
  }

  try {
    const items = await getSlowMovingInventory(from_date, to_date)

    // Build Grand Total by summing Zoho-sourced values
    const totals = items.reduce(
      (acc, item) => {
        acc.opening_stock         += item.opening_stock
        acc.purchases             += item.purchases
        acc.returned_to_wholesale += item.returned_to_wholesale
        acc.closing_stock         += item.closing_stock
        acc.sold                  += item.sold
        return acc
      },
      { opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 }
    )

    return res.json({
      from_date,
      to_date,
      items,
      totals,
    })
  } catch (err) {
    console.error('[weeklyReports] getSlowMovingReport error:', err.message)
    return res.status(502).json({
      error: err.message || 'Failed to fetch report from Zoho',
    })
  }
}

module.exports = { getSlowMovingReport }
