const { getInventoryByGroup, getFamilyWarehouseMatrixByGroup } = require('../services/zohoService')
const { listGroupKeys }                               = require('../services/itemReportGroupsService')
const { sumReportGrandTotals }                        = require('../utils/weeklyReportTotals')
const { ZOHO_WEEKLY_REPORT_INTEGRATION }              = require('../services/weeklyReportZohoData')
const { mergeZohoWithVendorContext }                 = require('../services/weeklyReportVendorConfig')
const { getCachedReport, makeKey }                  = require('../services/weeklyReportCache')
const { peekWeeklyReportPrefetchBundle }            = require('../services/weeklyReportPrefetchStash')
const { coldBlockedFamilyDetailsMatrixPayload }    = require('../services/weeklyReportZohoData')
const { fetchWarehouses }                             = require('../integrations/zoho/zohoWarehouses')
const { fetchZohoItemImageBuffer }                    = require('../integrations/zoho/zohoInventoryClient')
const zohoItemImageCache                              = require('../services/zohoItemImageCache')
const {
  buildWeeklyReportXlsxBuffer,
  buildFamilyClosingStockXlsxBuffer,
  getExportSheetTitleForGroup,
  getExportDownloadFilename,
} = require('../services/weeklyReportXlsxService')
const { getDailySuccessCount, getZohoGuardStatus } = require('../services/zohoApiClient')
const { STOCK_REPORT_CACHE_VERSION } = require('../services/weeklyReportStockTotalsConfig')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Family-details drawer: per-warehouse fetches, bounded for Zoho rate safety */
const FAMILY_WAREHOUSE_CONCURRENCY  = 1
const FAMILY_DETAILS_CACHE_TTL_MS  = 15 * 60 * 1000
const _familyDetailsCache  = new Map()   // key → { result, expiresAt }
const _familyDetailsFlight = new Map()   // key → Promise<result>

function makeFamilyDetailsCacheKey(group, from, to, family, warehouseId, excludeWarehouseId) {
  return [
    'fd',
    group,
    from,
    to,
    String(family || '').trim().toLowerCase(),
    normalizeQueryWhId(warehouseId),
    normalizeQueryWhId(excludeWarehouseId),
    `sv:${STOCK_REPORT_CACHE_VERSION}`,
  ].join(':')
}

function normalizeQueryWhId(v) {
  if (v == null || String(v).trim() === '') return 'none'
  return String(v).trim()
}

/**
 * Run up to `limit` async jobs in parallel, queueing the rest.
 * @template T
 * @param {T[]} list
 * @param {number} limit
 * @param {(x: T, i: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 * @template R
 */
async function mapWithConcurrency(list, limit, fn) {
  if (list.length === 0) return []
  const n   = list.length
  const out = new Array(n)
  const lim = Math.max(1, Math.min(Math.floor(Number(limit) || 1) || 1, n))
  const lock = { i: 0 }
  const worker = async () => {
    for (;;) {
      const taskIndex = lock.i++
      if (taskIndex >= n) return
      out[taskIndex] = await fn(list[taskIndex], taskIndex)
    }
  }
  await Promise.all(Array.from({ length: lim }, () => worker()))
  return out
}

function clearFamilyDetailsWarehouseCache() {
  _familyDetailsCache.clear()
  _familyDetailsFlight.clear()
}

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
    return await handleZohoError(res, err, 'getWarehouses')
  }
}

async function loadWeeklyReportPayload(group, fromDate, toDate, warehouseId = null, excludeWarehouseId = null) {
  return getCachedReport(group, fromDate, toDate, async () => {
    const { items, reportMeta, itemDetails } = await getInventoryByGroup(
      group,
      fromDate,
      toDate,
      warehouseId,
      excludeWarehouseId,
      { includeItemDetails: true }
    )
    const totals = sumReportGrandTotals(items)
    return { items, totals, reportMeta: reportMeta || { warnings: [] }, itemDetails: itemDetails || [] }
  }, warehouseId, excludeWarehouseId)
}

function attachReportMetaToZoho(zohoObj, reportMeta) {
  const o = { ...zohoObj }
  if (reportMeta && Array.isArray(reportMeta.warnings) && reportMeta.warnings.length) {
    o.warnings = reportMeta.warnings
  }
  if (reportMeta && reportMeta.transaction_debug) {
    o.transaction_debug = reportMeta.transaction_debug
  }
  if (reportMeta && typeof reportMeta === 'object') {
    for (const k of [
      'calculation_version',
      'generated_at',
      'stock_totals_family_row_mode',
      'weekly_report_prefetch_bundle_stashed',
      'family_matrix_family_builds_used_prefetch_source',
    ]) {
      if (reportMeta[k] != null && reportMeta[k] !== '') o[k] = reportMeta[k]
    }
  }
  return o
}

function utcDayString() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Adds Zoho guard snapshot + successful outbound API call count (UTC day) for weekly report JSON.
 * Always sets `api_usage_today` + `per_minute_limit` so the SPA can show limits even if the
 * usage table query fails; `successful_calls` stays null when the count cannot be read.
 */
async function attachZohoApiUsageToday(zohoObj) {
  const base = zohoObj && typeof zohoObj === 'object' ? zohoObj : {}
  const guard = getZohoGuardStatus()
  const out = {
    ...base,
    per_minute_limit: guard.perMinuteLimit,
    api_usage_today: {
      utc_day: utcDayString(),
      daily_limit: guard.dailyLimit,
      successful_calls: null,
    },
  }
  try {
    out.api_usage_today.successful_calls = await getDailySuccessCount()
  } catch (err) {
    console.warn('[weeklyReports] attachZohoApiUsageToday:', err.message)
    out.api_usage_today.count_unavailable = true
  }
  return out
}

/** Minimal `{ zoho }` shape for rate-limit / quota error JSON bodies. */
async function zohoQuotaSnapshotForErrors() {
  return attachZohoApiUsageToday({})
}

/**
 * GET /api/weekly-reports/zoho-api-usage — lightweight quota snapshot for the filters bar
 * (no Zoho catalog/report fetch).
 */
async function getZohoApiUsageSnapshot(_req, res) {
  try {
    const zoho = await attachZohoApiUsageToday({})
    return res.json({ zoho })
  } catch (err) {
    console.error('[weeklyReports] getZohoApiUsageSnapshot:', err.message)
    return res.status(500).json({ error: 'Failed to load Zoho API usage' })
  }
}

const WEEKLY_VISIBLE_VALUE_KEYS = [
  'opening_stock',
  'closing_stock',
  'purchase_amount',
  'returned_to_wholesale',
  'sales_amount',
]

function weeklyReportRowHasVisibleValue(row) {
  if (!row || typeof row !== 'object') return false
  return WEEKLY_VISIBLE_VALUE_KEYS.some((key) => {
    const v = row[key]
    if (v == null) return false
    const n = Number(v)
    return Number.isFinite(n) && n !== 0
  })
}

function shouldSuppressSalesAmount(req) {
  const raw = req && req.query ? req.query.suppress_sales_amount : null
  return raw === '1' || raw === 'true' || raw === true
}

function withoutSalesAmounts(items) {
  return Array.isArray(items)
    ? items.map((item) => ({ ...item, sales_amount: null }))
    : []
}

function safeExportSlug(value) {
  return String(value || 'family')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'family'
}

function isZohoDailyRateLimit(err) {
  if (!err) return false
  const msg = String(err.message || '')
  if (err.httpStatus === 429 && /maximum call rate limit of \d/.test(msg)) return true
  if (/"code":45/.test(msg)) return true
  return false
}

async function handleZohoError(res, err, ctx) {
  const isDev = process.env.NODE_ENV !== 'production'
  console.error(
    `[weeklyReports] ${ctx} error:`,
    err.message,
    err.code ? `code=${err.code}` : '',
    err.missing && err.missing.length ? `missing=${err.missing.join(',')}` : ''
  )
  if (isZohoDailyRateLimit(err)) {
    return res.status(429).json({
      error: 'Zoho API daily quota exceeded (10,000 calls/day). This resets at midnight UTC. The app will resume automatically once the quota renews.',
      code: 'ZOHO_DAILY_RATE_LIMIT',
      user_action: 'Please wait until the daily Zoho quota resets, then retry.',
    })
  }
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
    case 'ZOHO_DAILY_BUDGET_EXCEEDED':
    case 'ZOHO_DAILY_LIMIT': {
      const zoho = await zohoQuotaSnapshotForErrors()
      return res.status(429).json({
        error:
          err.message ||
          'This server reached its configured Zoho API call budget for today (UTC).',
        code: err.code || 'ZOHO_DAILY_LIMIT',
        user_action:
          'Wait until UTC midnight or tune ZOHO_DAILY_CALL_LIMIT / Zoho plan.',
        zoho,
      })
    }
    case 'ZOHO_SAFE_STOP':
    case 'ZOHO_RATE_MINUTE_LIMIT': {
      const zoho = await zohoQuotaSnapshotForErrors()
      return res.status(429).json({
        error: err.message || 'Zoho API rate or safe-stop limit.',
        code: err.code,
        user_action:
          err.code === 'ZOHO_RATE_MINUTE_LIMIT'
            ? 'Wait about one minute for the per-minute window to reset. The combined Weekly Sales page loads Slow Moving first, then Other Family.'
            : undefined,
        zoho,
      })
    }
    case 'ZOHO_SYNC_PAUSED': {
      const zoho = await zohoQuotaSnapshotForErrors()
      return res.status(503).json({
        error: err.message || 'Zoho sync paused after HTTP 429.',
        code: 'ZOHO_SYNC_PAUSED',
        zoho,
      })
    }
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
  const excludeWarehouseId = req.query.exclude_warehouse_id && String(req.query.exclude_warehouse_id).trim() !== ''
    ? String(req.query.exclude_warehouse_id).trim()
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
      warehouseId,
      excludeWarehouseId
    )
    let zoho = attachReportMetaToZoho(
      mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, group),
      reportMeta
    )
    zoho = await attachZohoApiUsageToday(zoho)
    return res.json({
      report_group:          group,
      from_date:             range.from_date,
      to_date:               range.to_date,
      warehouse_id:          warehouseId || null,
      exclude_warehouse_id:  excludeWarehouseId || null,
      items,
      totals,
      calculation_version:   (reportMeta && reportMeta.calculation_version) || STOCK_REPORT_CACHE_VERSION,
      generated_at:          reportMeta && reportMeta.generated_at ? reportMeta.generated_at : null,
      stock_totals_family_row_mode:
        reportMeta && reportMeta.stock_totals_family_row_mode ? reportMeta.stock_totals_family_row_mode : null,
      weekly_report_prefetch_bundle_stashed:
        reportMeta && typeof reportMeta.weekly_report_prefetch_bundle_stashed === 'boolean'
          ? reportMeta.weekly_report_prefetch_bundle_stashed
          : null,
      family_matrix_family_builds_used_prefetch_source:
        reportMeta && reportMeta.family_matrix_family_builds_used_prefetch_source != null
          ? reportMeta.family_matrix_family_builds_used_prefetch_source
          : null,
      zoho,
    })
  } catch (err) {
    return await handleZohoError(res, err, `getReportByGroup(${group})`)
  }
}

/**
 * For each target warehouse, runs getInventoryByGroup(…, wh, null) — true
 * per-warehouse stock + transactions, not the global "exclude" scope.
 *
 * @param {string} group
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string} family
 * @param {string|null} filterWarehouseId  - main filter: only this warehouse, or all when null
 * @param {string|null} excludeWarehouseId - from Zoho list, omit this id when not filtering to one WH
 * @returns {Promise<{ warehouses: Array<{ warehouse_id: string, warehouse_name: string, items: object[] }> }>}
 */
async function buildFamilyDetailsWarehousesPayload(
  group,
  fromDate,
  toDate,
  family,
  filterWarehouseId,
  excludeWarehouseId
) {
  const normEx = excludeWarehouseId && String(excludeWarehouseId).trim() !== ''
    ? String(excludeWarehouseId).trim()
    : null
  const normF  = filterWarehouseId && String(filterWarehouseId).trim() !== ''
    ? String(filterWarehouseId).trim()
    : null

  const prefetchBundle = peekWeeklyReportPrefetchBundle(group, fromDate, toDate, normF, normEx)
  const cacheKey = makeKey(group, fromDate, toDate, normF, normEx)
  if (!prefetchBundle && process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS === '1') {
    console.warn(
      JSON.stringify({
        msg: 'family_details_blocked_no_prefetch',
        family,
        cacheKey,
      })
    )
    const coldTargets = normF
      ? [{ warehouse_id: normF, warehouse_name: normF }]
      : []
    return coldBlockedFamilyDetailsMatrixPayload({ family, warehouses: coldTargets })
  }

  /** @type {Array<{ warehouse_id: string, warehouse_name: string }>} */
  let targets = []
  if (normF) {
    const allW  = await fetchWarehouses()
    const found = Array.isArray(allW)
      ? allW.find((w) => w && String(w.warehouse_id) === normF)
      : null
    targets = [
      { warehouse_id: normF, warehouse_name: (found && found.warehouse_name) || normF },
    ]
  } else {
    const allW = await fetchWarehouses()
    if (!Array.isArray(allW) || allW.length === 0) {
      return { warehouses: [] }
    }
    targets = allW
      .filter((w) => w && String(w.warehouse_id) !== (normEx || '___never___'))
      .map((w) => ({
        warehouse_id:   String(w.warehouse_id),
        warehouse_name: String(w.warehouse_name || w.warehouse_id),
      }))
  }

  return getFamilyWarehouseMatrixByGroup(
    group,
    family,
    fromDate,
    toDate,
    targets,
    normF,
    normEx
  )
}

async function loadFamilyDetailsBody(group, range, family, filterWarehouseId, excludeWarehouseId) {
  let validGroups
  validGroups = await listGroupKeys()
  if (!validGroups.includes(group)) {
    const err = new Error(`Unknown report_group '${group}'. Available: ${validGroups.join(', ') || '(none)'}`)
    err.httpStatus = 404
    throw err
  }

  const cacheKey = makeFamilyDetailsCacheKey(
    group,
    range.from_date,
    range.to_date,
    family,
    filterWarehouseId,
    excludeWarehouseId
  )
  if (_familyDetailsCache.has(cacheKey)) {
    const c = _familyDetailsCache.get(cacheKey)
    if (c && Date.now() < c.expiresAt) {
      return c.body
    }
  }
  if (_familyDetailsFlight.has(cacheKey)) {
    return _familyDetailsFlight.get(cacheKey)
  }

  const p = (async () => {
    const matrix = await buildFamilyDetailsWarehousesPayload(
      group,
      range.from_date,
      range.to_date,
      family,
      filterWarehouseId,
      excludeWarehouseId
    )
    const warehouses = Array.isArray(matrix.warehouses) ? matrix.warehouses : []
    const items = Array.isArray(matrix.items) ? matrix.items : []
    return {
      report_group:         group,
      family,
      from_date:            range.from_date,
      to_date:              range.to_date,
      warehouse_id:         filterWarehouseId || null,
      exclude_warehouse_id: excludeWarehouseId || null,
      warehouses,
      sections:             matrix.sections || {},
      items, // back-compat-ish: flattened section rows; prefer `sections` in the UI
      calculation_version: STOCK_REPORT_CACHE_VERSION,
      generated_at:        new Date().toISOString(),
      totals:               matrix.totals || null,
      meta:                 matrix.meta || null,
      zoho:                 await attachZohoApiUsageToday(
        attachReportMetaToZoho(
          mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, group),
          matrix.reportMeta || { warnings: [] }
        )
      ),
    }
  })()

  _familyDetailsFlight.set(cacheKey, p)
  p.then(
    (body) => {
      _familyDetailsFlight.delete(cacheKey)
      _familyDetailsCache.set(cacheKey, { body, expiresAt: Date.now() + FAMILY_DETAILS_CACHE_TTL_MS })
    },
    () => { _familyDetailsFlight.delete(cacheKey) }
  )

  return p
}

function parseFamilyDetailsRequest(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return null
  const family = req.query.family && String(req.query.family).trim() !== ''
    ? String(req.query.family).trim()
    : null
  if (!family) {
    res.status(400).json({ error: 'Missing required query parameter: family' })
    return null
  }
  const filterWarehouseId = req.query.warehouse_id && String(req.query.warehouse_id).trim() !== ''
    ? String(req.query.warehouse_id).trim()
    : null
  const excludeWarehouseId = req.query.exclude_warehouse_id && String(req.query.exclude_warehouse_id).trim() !== ''
    ? String(req.query.exclude_warehouse_id).trim()
    : null
  return { group, range, family, filterWarehouseId, excludeWarehouseId }
}

/**
 * GET /api/weekly-reports/by-group/:group/family-details?from_date&to_date&family=...
 * Response always includes `warehouses[]`. `items` is the first warehouse’s rows (back-compat).
 */
async function getFamilyDetailsByGroupController(req, res) {
  const parsed = parseFamilyDetailsRequest(req, res)
  if (!parsed) return
  const { group, range, family, filterWarehouseId, excludeWarehouseId } = parsed
  try {
    const body = await loadFamilyDetailsBody(group, range, family, filterWarehouseId, excludeWarehouseId)
    return res.json(body)
  } catch (err) {
    if (err && err.httpStatus === 404) {
      return res.status(404).json({ error: err.message })
    }
    if (/Failed to validate report group/.test(err && err.message)) {
      console.error('[weeklyReports] getFamilyDetailsByGroup listGroupKeys error:', err.message)
      return res.status(500).json({ error: 'Failed to validate report group' })
    }
    return await handleZohoError(res, err, `getFamilyDetailsByGroup(${group})`)
  }
}

async function exportFamilyClosingStockXlsx(req, res) {
  const parsed = parseFamilyDetailsRequest(req, res)
  if (!parsed) return
  const { group, range, family, filterWarehouseId, excludeWarehouseId } = parsed
  try {
    const body = await loadFamilyDetailsBody(group, range, family, filterWarehouseId, excludeWarehouseId)
    const buffer = await buildFamilyClosingStockXlsxBuffer({
      family,
      fromDate: range.from_date,
      toDate: range.to_date,
      warehouses: Array.isArray(body?.warehouses) ? body.warehouses : [],
      closingSection: body?.sections?.closing || {},
    })
    const filename = `weekly-${safeExportSlug(group)}-${safeExportSlug(family)}-closing-stock-${range.from_date}-to-${range.to_date}.xlsx`
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buffer)
  } catch (err) {
    if (err && err.httpStatus === 404) {
      return res.status(404).json({ error: err.message })
    }
    return await handleZohoError(res, err, `exportFamilyClosingStockXlsx(${group})`)
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
    let zohoSm = attachReportMetaToZoho(
      mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, 'slow_moving'),
      reportMeta
    )
    zohoSm = await attachZohoApiUsageToday(zohoSm)
    return res.json({
      from_date: range.from_date,
      to_date:   range.to_date,
      items,
      totals,
      calculation_version: (reportMeta && reportMeta.calculation_version) || STOCK_REPORT_CACHE_VERSION,
      generated_at: reportMeta && reportMeta.generated_at ? reportMeta.generated_at : null,
      stock_totals_family_row_mode:
        reportMeta && reportMeta.stock_totals_family_row_mode ? reportMeta.stock_totals_family_row_mode : null,
      weekly_report_prefetch_bundle_stashed:
        reportMeta && typeof reportMeta.weekly_report_prefetch_bundle_stashed === 'boolean'
          ? reportMeta.weekly_report_prefetch_bundle_stashed
          : null,
      family_matrix_family_builds_used_prefetch_source:
        reportMeta && reportMeta.family_matrix_family_builds_used_prefetch_source != null
          ? reportMeta.family_matrix_family_builds_used_prefetch_source
          : null,
      zoho: zohoSm,
    })
  } catch (err) {
    return await handleZohoError(res, err, 'getSlowMovingReport')
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
  const excludeWarehouseId = req.query.exclude_warehouse_id && String(req.query.exclude_warehouse_id).trim() !== ''
    ? String(req.query.exclude_warehouse_id).trim()
    : null
  const salesSort = String(req.query.sales_sort || '').trim().toLowerCase() === 'asc'
    ? 'asc'
    : String(req.query.sales_sort || '').trim().toLowerCase() === 'desc'
      ? 'desc'
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
    const { items } = await loadWeeklyReportPayload(
      group,
      range.from_date,
      range.to_date,
      warehouseId,
      excludeWarehouseId
    )
    const exportSourceItems = shouldSuppressSalesAmount(req) ? withoutSalesAmounts(items) : items
    const visibleItems = Array.isArray(exportSourceItems) ? exportSourceItems.filter(weeklyReportRowHasVisibleValue) : []
    const exportItems = salesSort
      ? [...visibleItems].sort((a, b) => {
          const av = Number(a && a.sales_amount) || 0
          const bv = Number(b && b.sales_amount) || 0
          return salesSort === 'asc' ? av - bv : bv - av
        })
      : visibleItems
    const exportTotals = sumReportGrandTotals(exportItems)
    const buffer = await buildWeeklyReportXlsxBuffer({
      sheetTitle: getExportSheetTitleForGroup(group),
      fromDate:   range.from_date,
      toDate:     range.to_date,
      items: exportItems,
      totals: exportTotals,
      fetchImageForItem: async (row) => {
        const raw = row && row.zoho_representative_item_id
        if (raw == null || String(raw).trim() === '') return null
        const id = String(raw).trim()

        // Reuse in-process image cache populated by thumbnail proxy requests.
        // This makes repeated exports and post-UI-load exports nearly instant.
        const cached = zohoItemImageCache.get(id)
        const source = cached && cached.buffer && cached.buffer.length > 0 ? cached : null
        const out = source ?? await fetchZohoItemImageBuffer(id)
        if (!out || !out.buffer || out.buffer.length === 0) return null

        const ct = String(out.contentType || '').toLowerCase()
        let ext = 'jpeg'
        if (ct.includes('png')) ext = 'png'
        else if (ct.includes('gif')) ext = 'gif'
        else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpeg'
        else {
          // ExcelJS embeds only png / jpeg / gif; skip e.g. image/webp
          return null
        }

        // Write back to cache so subsequent thumbnail requests and exports are fast.
        if (!source) zohoItemImageCache.set(id, out)
        return { buffer: out.buffer, extension: ext }
      },
    })
    const filename = getExportDownloadFilename(group, range.from_date, range.to_date)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buffer)
  } catch (err) {
    return await handleZohoError(res, err, `exportReportByGroupXlsx(${group})`)
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
  const noCache = req.query && (String(req.query.bust) === '1' || String(req.query.nocache) === '1')
  try {
    const cached = noCache ? null : zohoItemImageCache.get(itemId)
    if (cached) {
      res.setHeader('Content-Type', cached.contentType)
      res.setHeader('Cache-Control', `private, max-age=${zohoItemImageCache.MAX_AGE_SEC}`)
      return res.status(200).send(cached.buffer)
    }
    const out = await fetchZohoItemImageBuffer(itemId)
    if (!out) {
      return res.status(404).end()
    }
    if (!noCache) zohoItemImageCache.set(itemId, out)
    res.setHeader('Content-Type', out.contentType)
    if (noCache) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    } else if (zohoItemImageCache.IMAGE_CACHE_ENABLED) {
      res.setHeader('Cache-Control', `private, max-age=${zohoItemImageCache.MAX_AGE_SEC}`)
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    }
    return res.status(200).send(out.buffer)
  } catch (err) {
    if (err.code === 'ZOHO_INVALID_ITEM_ID') {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    return await handleZohoError(res, err, 'getZohoItemImage')
  }
}

module.exports = {
  listAvailableGroups,
  getWarehouses,
  getZohoApiUsageSnapshot,
  getZohoItemImage,
  getReportByGroup,
  getFamilyDetailsByGroupController,
  getSlowMovingReport,
  exportReportByGroupXlsx,
  exportFamilyClosingStockXlsx,
  /** @internal debug route + tests — same payload path as public JSON/Excel */
  loadWeeklyReportPayload,
  validateDateRange,
  handleZohoError,
  clearFamilyDetailsWarehouseCache,
  attachZohoApiUsageToday,
  /** @internal for unit tests */
  _internals: {
    buildFamilyDetailsWarehousesPayload,
  },
}
