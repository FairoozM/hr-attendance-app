const { getInventoryByGroup } = require('../services/zohoService')
const { listGroupKeys }                               = require('../services/itemReportGroupsService')
const { sumReportGrandTotals }                        = require('../utils/weeklyReportTotals')
const { ZOHO_WEEKLY_REPORT_INTEGRATION }              = require('../services/weeklyReportZohoData')
const { mergeZohoWithVendorContext }                 = require('../services/weeklyReportVendorConfig')
const { getCachedReport }                             = require('../services/weeklyReportCache')
const { fetchWarehouses }                             = require('../integrations/zoho/zohoWarehouses')
const { fetchZohoItemImageBuffer }                    = require('../integrations/zoho/zohoInventoryClient')
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

/**
 * Single data path for JSON and Excel: Zoho adapter + `item_report_groups` via
 * `getInventoryByGroup`, then the same `sumReportGrandTotals` the UI and export use.
 * No separate export-only fetch.
 *
 * Wrapped by `getCachedReport` so that:
 *  - Concurrent calls with the same key (group+dates) share one Promise (in-flight dedup).
 *  - Repeated calls within WEEKLY_REPORT_CACHE_TTL_MS (default 2 min) return cached data
 *    immediately, no Zoho round-trip. This covers StrictMode double-fire, Export + View
 *    fired together, and rapid Refresh clicks.
 */
/**
 * GET /api/weekly-reports/warehouses
 * Returns all Zoho Inventory warehouses for the org (cached 5 min on the backend).
 */
async function getWarehouses(_req, res) {
  try {
    const warehouses = await fetchWarehouses()
    return res.json({ warehouses })
  } catch (err) {
    return handleZohoError(res, err, 'getWarehouses')
  }
}

async function loadWeeklyReportPayload(group, fromDate, toDate, warehouseId = null) {
  return getCachedReport(group, fromDate, toDate, async () => {
    const { items, reportMeta } = await getInventoryByGroup(group, fromDate, toDate, warehouseId)
    const totals = sumReportGrandTotals(items)
    return { items, totals, reportMeta: reportMeta || { warnings: [] } }
  }, warehouseId)
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

function handleZohoError(res, err, ctx) {
  const isDev = process.env.NODE_ENV !== 'production'
  console.error(
    `[weeklyReports] ${ctx} error:`,
    err.message,
    err.code ? `code=${err.code}` : '',
    err.missing && err.missing.length ? `missing=${err.missing.join(',')}` : ''
  )
  switch (err.code) {
    case 'ZOHO_NOT_CONFIGURED': {
      const body = { error: err.message, code: err.code }
      if (isDev) {
        body.dev_detail = {
          missing: err.missing || [],
          hint:
            'Set the missing variables in backend/.env, save the file, then restart the backend. node --watch does not pick up .env changes.',
        }
      }
      return res.status(503).json(body)
    }
    case 'ZOHO_OAUTH_ERROR':
    case 'ZOHO_API_ERROR':
    case 'ZOHO_API_NETWORK_ERROR': {
      const body = { error: err.message, code: err.code }
      if (isDev) {
        body.dev_detail = {
          httpStatus: err.httpStatus,
          oauth: err.oauth,
          upstreamBodyPreview:
            typeof err.body === 'string' ? err.body.slice(0, 500) : undefined,
        }
      }
      return res.status(502).json(body)
    }
    case 'ZOHO_API_TIMEOUT':
    case 'ZOHO_WEBHOOK_TIMEOUT':
      return res.status(504).json({ error: err.message, code: err.code })
    case 'WEBHOOK_INVALID_RESPONSE':
      return res.status(502).json({
        error: err.message,
        code: err.code,
        validation_errors: err.validation_errors || [],
      })
    case 'REPORT_VENDOR_NOT_CONFIGURED': {
      const body = { error: err.message, code: err.code }
      if (isDev) {
        body.dev_detail = {
          tried: err.tried || [],
          optionalFlag: err.optionalFlag || null,
          hint:
            'Set WEEKLY_REPORT_VENDOR_OPTIONAL=1 in backend/.env (and restart the backend) to allow the report to run without a vendor in local development.',
        }
      }
      return res.status(400).json(body)
    }
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
 * metadata). **Family-level rows** also include `zoho_representative_item_id`
 * (string): one Zoho catalog `item_id` in that family, used to load a product
 * image via `GET /api/weekly-reports/zoho-item-images/:itemId`.
 * Business report groups are never inferred from `family` — membership
 * is solely from `item_report_groups` vs `sku` (and legacy `item_name` fallback
 * when the member row has no SKU).
 */
async function getReportByGroup(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return

  const warehouseId = req.query.warehouse_id && String(req.query.warehouse_id).trim() !== ''
    ? String(req.query.warehouse_id).trim()
    : null

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
    const { items, totals, reportMeta } = await loadWeeklyReportPayload(
      group,
      range.from_date,
      range.to_date,
      warehouseId
    )
    const zoho = attachReportMetaToZoho(
      mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, group),
      reportMeta
    )
    return res.json({
      report_group:  group,
      from_date:     range.from_date,
      to_date:       range.to_date,
      warehouse_id:  warehouseId || null,
      items,
      totals,
      zoho,
    })
  } catch (err) {
    return handleZohoError(res, err, `getReportByGroup(${group})`)
  }
}

/**
 * GET /api/weekly-reports/slow-moving?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Legacy route — kept for backward compatibility. Uses the same
 * `loadWeeklyReportPayload('slow_moving', …)` as the generic by-group path;
 * response shape is unchanged (no `report_group` field).
 */
async function getSlowMovingReport(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return

  try {
    const { items, totals, reportMeta } = await loadWeeklyReportPayload(
      'slow_moving',
      range.from_date,
      range.to_date
    )
    return res.json({
      from_date: range.from_date,
      to_date:   range.to_date,
      items,
      totals,
      zoho: attachReportMetaToZoho(
        mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, 'slow_moving'),
        reportMeta
      ),
    })
  } catch (err) {
    return handleZohoError(res, err, 'getSlowMovingReport')
  }
}

/**
 * GET /api/weekly-reports/by-group/:group/export.xlsx?from_date&to_date
 * Same `loadWeeklyReportPayload` as JSON `getReportByGroup` — only the response format
 * differs (.xlsx vs JSON).
 */
async function exportReportByGroupXlsx(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return

  const warehouseId = req.query.warehouse_id && String(req.query.warehouse_id).trim() !== ''
    ? String(req.query.warehouse_id).trim()
    : null

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
    const { items, totals } = await loadWeeklyReportPayload(
      group,
      range.from_date,
      range.to_date,
      warehouseId
    )
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

/**
 * GET /api/weekly-reports/zoho-item-images/:itemId
 * Proxies Zoho `GET /inventory/v1/items/{id}/image` (Bearer auth in SPA cannot load Zoho
 * directly). Each family row includes `zoho_representative_item_id` for one catalog item
 * in that Zoho family (prefer an item with an image in Zoho when available).
 */
async function getZohoItemImage(req, res) {
  const { itemId } = req.params
  try {
    const out = await fetchZohoItemImageBuffer(itemId)
    if (!out) {
      return res.status(404).end()
    }
    res.setHeader('Content-Type', out.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.status(200).send(out.buffer)
  } catch (err) {
    if (err.code === 'ZOHO_INVALID_ITEM_ID') {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    return handleZohoError(res, err, 'getZohoItemImage')
  }
}

module.exports = {
  listAvailableGroups,
  getWarehouses,
  getZohoItemImage,
  getReportByGroup,
  getSlowMovingReport,
  exportReportByGroupXlsx,
  /** @internal debug route + tests — same payload path as public JSON/Excel */
  loadWeeklyReportPayload,
  validateDateRange,
  handleZohoError,
}
