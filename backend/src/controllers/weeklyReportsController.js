const { getInventoryByGroup } = require('../services/zohoService')
const { listGroupKeys }                               = require('../services/itemReportGroupsService')
const { sumReportGrandTotals }                        = require('../utils/weeklyReportTotals')
const { ZOHO_WEEKLY_REPORT_INTEGRATION }              = require('../services/weeklyReportZohoData')
const { mergeZohoWithVendorContext }                 = require('../services/weeklyReportVendorConfig')
const { getCachedReport }                             = require('../services/weeklyReportCache')
const { fetchWarehouses }                             = require('../integrations/zoho/zohoWarehouses')
const { fetchZohoItemImageBuffer }                    = require('../integrations/zoho/zohoInventoryClient')
const zohoItemImageCache                              = require('../services/zohoItemImageCache')
const {
  buildWeeklyReportXlsxBuffer,
  getExportSheetTitleForGroup,
  getExportDownloadFilename,
} = require('../services/weeklyReportXlsxService')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Family-details drawer: per-warehouse fetches, bounded for Zoho rate safety */
const FAMILY_WAREHOUSE_CONCURRENCY  = 1
const FAMILY_DETAILS_CACHE_TTL_MS  = 90_000
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
    return handleZohoError(res, err, 'getWarehouses')
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
  return o
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
    const zoho = attachReportMetaToZoho(
      mergeZohoWithVendorContext(ZOHO_WEEKLY_REPORT_INTEGRATION, group),
      reportMeta
    )
    return res.json({
      report_group:          group,
      from_date:             range.from_date,
      to_date:               range.to_date,
      warehouse_id:          warehouseId || null,
      exclude_warehouse_id:  excludeWarehouseId || null,
      items,
      totals,
      zoho,
    })
  } catch (err) {
    return handleZohoError(res, err, `getReportByGroup(${group})`)
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
  const familyKey   = String(family || '').trim().toLowerCase()
  const filterByFam = (itemDetails) => {
    if (!Array.isArray(itemDetails)) return []
    return itemDetails.filter(
      (r) => String(r.family_display || r.family || '').trim().toLowerCase() === familyKey
    )
  }

  const normEx = excludeWarehouseId && String(excludeWarehouseId).trim() !== ''
    ? String(excludeWarehouseId).trim()
    : null
  const normF  = filterWarehouseId && String(filterWarehouseId).trim() !== ''
    ? String(filterWarehouseId).trim()
    : null

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

  const warehouses = await mapWithConcurrency(targets, FAMILY_WAREHOUSE_CONCURRENCY, async (wh) => {
    const { itemDetails = [] } = await getInventoryByGroup(
      group,
      fromDate,
      toDate,
      wh.warehouse_id,
      null,
      { includeItemDetails: true }
    )
    return {
      warehouse_id:   wh.warehouse_id,
      warehouse_name: wh.warehouse_name,
      items:          filterByFam(itemDetails),
    }
  })

  return { warehouses }
}

/**
 * GET /api/weekly-reports/by-group/:group/family-details?from_date&to_date&family=...
 * Response always includes `warehouses[]`. `items` is the first warehouse’s rows (back-compat).
 */
async function getFamilyDetailsByGroupController(req, res) {
  const { group } = req.params
  const range = validateDateRange(req, res)
  if (!range) return
  const family = req.query.family && String(req.query.family).trim() !== ''
    ? String(req.query.family).trim()
    : null
  if (!family) {
    return res.status(400).json({ error: 'Missing required query parameter: family' })
  }
  const filterWarehouseId = req.query.warehouse_id && String(req.query.warehouse_id).trim() !== ''
    ? String(req.query.warehouse_id).trim()
    : null
  const excludeWarehouseId = req.query.exclude_warehouse_id && String(req.query.exclude_warehouse_id).trim() !== ''
    ? String(req.query.exclude_warehouse_id).trim()
    : null
  let validGroups
  try {
    validGroups = await listGroupKeys()
  } catch (err) {
    console.error('[weeklyReports] getFamilyDetailsByGroup listGroupKeys error:', err.message)
    return res.status(500).json({ error: 'Failed to validate report group' })
  }
  if (!validGroups.includes(group)) {
    return res.status(404).json({
      error: `Unknown report_group '${group}'. Available: ${validGroups.join(', ') || '(none)'}`,
    })
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
      return res.json(c.body)
    }
  }
  if (_familyDetailsFlight.has(cacheKey)) {
    try {
      const body = await _familyDetailsFlight.get(cacheKey)
      return res.json(body)
    } catch (err) {
      return handleZohoError(res, err, `getFamilyDetailsByGroup(${group})`)
    }
  }

  const p = (async () => {
    const { warehouses } = await buildFamilyDetailsWarehousesPayload(
      group,
      range.from_date,
      range.to_date,
      family,
      filterWarehouseId,
      excludeWarehouseId
    )
    const items = warehouses[0] && Array.isArray(warehouses[0].items) ? warehouses[0].items : []
    return {
      report_group:         group,
      family,
      from_date:            range.from_date,
      to_date:              range.to_date,
      warehouse_id:         filterWarehouseId || null,
      exclude_warehouse_id: excludeWarehouseId || null,
      warehouses,
      items, // back-compat: first block only; prefer `warehouses` in the UI
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

  try {
    const body = await p
    return res.json(body)
  } catch (err) {
    return handleZohoError(res, err, `getFamilyDetailsByGroup(${group})`)
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
    const visibleItems = Array.isArray(items) ? items.filter(weeklyReportRowHasVisibleValue) : []
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
    return handleZohoError(res, err, 'getZohoItemImage')
  }
}

module.exports = {
  listAvailableGroups,
  getWarehouses,
  getZohoItemImage,
  getReportByGroup,
  getFamilyDetailsByGroupController,
  getSlowMovingReport,
  exportReportByGroupXlsx,
  /** @internal debug route + tests — same payload path as public JSON/Excel */
  loadWeeklyReportPayload,
  validateDateRange,
  handleZohoError,
  clearFamilyDetailsWarehouseCache,
  /** @internal for unit tests */
  _internals: {
    buildFamilyDetailsWarehousesPayload,
  },
}
