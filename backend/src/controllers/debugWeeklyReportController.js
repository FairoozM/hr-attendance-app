/**
 * TEMPORARY — non-production only.
 * GET /api/debug/weekly-report/by-group/:group?from_date&to_date
 * Same data path as public weekly report + explicit row-level debug and report_debug.
 */
const { listGroupKeys } = require('../services/itemReportGroupsService')
const { ZOHO_WEEKLY_REPORT_INTEGRATION } = require('../services/weeklyReportZohoData')
const { mergeZohoWithVendorContext } = require('../services/weeklyReportVendorConfig')
const { loadWeeklyReportPayload, validateDateRange, handleZohoError } = require('./weeklyReportsController')

/**
 * @param {object} item
 * @returns {object} copy of the report row, with optional `row_debug` (per-row metadata)
 */
function attachRowDebug(item) {
  if (!item || typeof item !== 'object') return item
  const row = { ...item }
  if (item._zoho && typeof item._zoho === 'object') {
    row.row_debug = { _zoho: item._zoho }
  }
  return row
}

function attachReportMetaToZoho(zohoObj, reportMeta) {
  const o = { ...zohoObj }
  if (reportMeta && Array.isArray(reportMeta.warnings) && reportMeta.warnings.length) {
    o.warnings = reportMeta.warnings
  }
  if (reportMeta && reportMeta.transaction_debug) {
    o.transaction_debug = reportMeta.transaction_debug
  }
  return o
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getWeeklyReportDebugByGroup(req, res) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'This debug endpoint is disabled in production' })
  }

  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return

  let validGroups
  try {
    validGroups = await listGroupKeys()
  } catch (err) {
    console.error('[debugWeeklyReport] listGroupKeys error:', err.message)
    return res.status(500).json({ error: 'Failed to validate report group' })
  }
  if (!validGroups.includes(group)) {
    return res.status(404).json({
      error: `Unknown report_group '${group}'. Available: ${validGroups.join(', ') || '(none)'}`,
    })
  }

  try {
    const { items, totals, reportMeta } = await loadWeeklyReportPayload(group, range.from_date, range.to_date)
    const rows = (items || []).map(attachRowDebug)
    const zoho = attachReportMetaToZoho(
      mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, group),
      reportMeta
    )
    return res.json({
      report_group: group,
      from_date: range.from_date,
      to_date: range.to_date,
      rows,
      totals,
      zoho,
      report_debug: {
        warnings: (reportMeta && reportMeta.warnings) || [],
        transaction_debug: reportMeta && reportMeta.transaction_debug,
      },
    })
  } catch (err) {
    return handleZohoError(res, err, `getWeeklyReportDebugByGroup(${group})`)
  }
}

module.exports = { getWeeklyReportDebugByGroup }
