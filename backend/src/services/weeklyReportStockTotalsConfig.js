/**
 * Family-level opening/closing alignment with warehouse matrix vs legacy global stock.
 * Cache keys include STOCK_REPORT_CACHE_VERSION so responses stay consistent after logic changes.
 */

const STOCK_REPORT_CACHE_VERSION = 'stock-report-v2-matrix-family-totals'

/**
 * Opt-in: set USE_MATRIX_TOTALS_FOR_FAMILY_ROWS=1 to replace family-row opening/closing
 * (qty + amount) with totals derived from the same warehouse matrix as the sidebar.
 * Default off to allow safe rollout.
 */
function useMatrixTotalsForFamilyRows() {
  return process.env.USE_MATRIX_TOTALS_FOR_FAMILY_ROWS === '1'
}

module.exports = {
  STOCK_REPORT_CACHE_VERSION,
  useMatrixTotalsForFamilyRows,
}
