const { getInventoryByGroup, getSlowMovingInventory } = require('../services/zohoService')
const { listGroupKeys }                               = require('../services/itemReportGroupsService')
const { sumReportGrandTotals }                        = require('../utils/weeklyReportTotals')
const { ZOHO_WEEKLY_REPORT_INTEGRATION }              = require('../services/weeklyReportZohoData')
const {
  buildWeeklyReportXlsxBuffer,
  getExportSheetTitleForGroup,
  getExportDownloadFilename,
} = require('../services/weeklyReportXlsxService')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validateDateRange(req, res) {
  const { from_date, to_date } = req.query
  if (!from_date || !to_date) {
    res.status(400).json({
      error: 'Missing required query parameters: from_date and to_date (YYYY-MM-DD)',
    })
    return null
  }
  if (!DATE_RE.test(from_date) || !DATE_RE.test(to_date)) {
    res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' })
    return null
  }
  if (from_date > to_date) {
    res.status(400).json({ error: 'from_date must be before or equal to to_date' })
    return null
  }
  return { from_date, to_date }
}

function handleZohoError(res, err, ctx) {
  console.error(`[weeklyReports] ${ctx} error:`, err.message)
  switch (err.code) {
    case 'ZOHO_NOT_CONFIGURED':
      return res.status(503).json({ error: err.message, code: err.code })
    case 'ZOHO_OAUTH_ERROR':
    case 'ZOHO_API_ERROR':
    case 'ZOHO_API_NETWORK_ERROR':
      return res.status(502).json({ error: err.message, code: err.code })
    case 'ZOHO_API_TIMEOUT':
    case 'ZOHO_WEBHOOK_TIMEOUT':
      return res.status(504).json({ error: err.message, code: err.code })
    case 'WEBHOOK_INVALID_RESPONSE':
      return res.status(502).json({
        error: err.message,
        code: err.code,
        validation_errors: err.validation_errors || [],
      })
    case 'ZOHO_WEBHOOK_HTTP_ERROR':
    case 'ZOHO_WEBHOOK_NETWORK_ERROR':
      return res.status(502).json({ error: err.message, code: err.code })
    default:
      return res.status(502).json({
        error: err.message || 'Failed to fetch report from Zoho',
      })
  }
}

/**
 * GET /api/weekly-reports/groups
 * Lists all distinct active report_group keys defined in item_report_groups.
 */
async function listAvailableGroups(_req, res) {
  try {
    const groups = await listGroupKeys()
    return res.json({ groups })
  } catch (err) {
    console.error('[weeklyReports] listAvailableGroups error:', err.message)
    return res.status(500).json({ error: 'Failed to list report groups' })
  }
}

/**
 * GET /api/weekly-reports/by-group/:group?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Generic Zoho-sourced weekly report for any report_group present in
 * item_report_groups. Numeric values are returned verbatim from the Zoho
 * webhook; the only computation here is summing those values into a Grand
 * Total row for display.
 *
 * Each item in `items` has string `family` (Zoho Family custom field) and may
 * include `_zoho: { from_date, to_date, family }` (Family duplicated for
 * metadata). Business report groups are never inferred from `family` — membership
 * is solely from `item_report_groups` vs `sku` (and legacy `item_name` fallback
 * when the member row has no SKU).
 */
async function getReportByGroup(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return

  let validGroups
  try {
    validGroups = await listGroupKeys()
  } catch (err) {
    console.error('[weeklyReports] getReportByGroup listGroupKeys error:', err.message)
    return res.status(500).json({ error: 'Failed to validate report group' })
  }
  if (!validGroups.includes(group)) {
    return res.status(404).json({
      error: `Unknown report_group '${group}'. Available: ${validGroups.join(', ') || '(none)'}`,
    })
  }

  try {
    // Same `items` / `totals` source as `exportReportByGroupXlsx` (Zoho adapter + item_report_groups).
    const items  = await getInventoryByGroup(group, range.from_date, range.to_date)
    const totals = sumReportGrandTotals(items)
    return res.json({
      report_group: group,
      from_date:    range.from_date,
      to_date:      range.to_date,
      items,
      totals,
      zoho: ZOHO_WEEKLY_REPORT_INTEGRATION,
    })
  } catch (err) {
    return handleZohoError(res, err, `getReportByGroup(${group})`)
  }
}

/**
 * GET /api/weekly-reports/slow-moving?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Legacy route — kept for backward compatibility. Delegates to the generic
 * implementation with report_group='slow_moving'. Response shape is unchanged.
 */
async function getSlowMovingReport(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return

  try {
    const items  = await getSlowMovingInventory(range.from_date, range.to_date)
    const totals = sumReportGrandTotals(items)
    return res.json({
      from_date: range.from_date,
      to_date:   range.to_date,
      items,
      totals,
      zoho: ZOHO_WEEKLY_REPORT_INTEGRATION,
    })
  } catch (err) {
    return handleZohoError(res, err, 'getSlowMovingReport')
  }
}

/**
 * GET /api/weekly-reports/by-group/:group/export.xlsx?from_date&to_date
 * Same `getInventoryByGroup` + `sumReportGrandTotals` as JSON `getReportByGroup` — only
 * the response format differs (.xlsx vs JSON).
 */
async function exportReportByGroupXlsx(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return

  let validGroups
  try {
    validGroups = await listGroupKeys()
  } catch (err) {
    console.error('[weeklyReports] exportReportByGroupXlsx listGroupKeys error:', err.message)
    return res.status(500).json({ error: 'Failed to validate report group' })
  }
  if (!validGroups.includes(group)) {
    return res.status(404).json({
      error: `Unknown report_group '${group}'. Available: ${validGroups.join(', ') || '(none)'}`,
    })
  }

  try {
    const items = await getInventoryByGroup(group, range.from_date, range.to_date)
    const totals = sumReportGrandTotals(items)
    const buffer = await buildWeeklyReportXlsxBuffer({
      sheetTitle: getExportSheetTitleForGroup(group),
      fromDate:   range.from_date,
      toDate:     range.to_date,
      items,
      totals,
    })
    const filename = getExportDownloadFilename(group, range.from_date, range.to_date)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buffer)
  } catch (err) {
    return handleZohoError(res, err, `exportReportByGroupXlsx(${group})`)
  }
}

module.exports = {
  listAvailableGroups,
  getReportByGroup,
  getSlowMovingReport,
  exportReportByGroupXlsx,
}
