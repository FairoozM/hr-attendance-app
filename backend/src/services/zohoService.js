/**
 * Zoho-source weekly inventory data, fetched from a custom Deluge webhook
 * deployed inside the user's Zoho organization.
 *
 * Why a webhook and not the REST API:
 *   Zoho Inventory's "Inventory Summary" report (which contains Opening Stock,
 *   Purchases, Returned to Wholesale, Closing Stock, SOLD per item per date
 *   range) is NOT exposed through the public REST API. The supported way to
 *   obtain those pre-aggregated values without re-deriving business numbers
 *   in our backend is to compute them inside Zoho via a Deluge function and
 *   expose the result as a webhook.
 *
 * Full integration contract:        docs/weekly-reports-zoho-webhook.md
 * Sample Deluge implementation:     docs/weekly-reports-zoho-webhook.deluge
 *
 * Required environment variables:
 *   ZOHO_REPORT_WEBHOOK_URL          – HTTPS URL the Deluge function is
 *                                      published at.
 *   ZOHO_REPORT_WEBHOOK_AUTH_HEADER  – full header value, e.g.
 *                                      "Zoho-oauthtoken 1000.xxx" or
 *                                      "Bearer xxx".
 *
 * Optional environment variables:
 *   ZOHO_REPORT_WEBHOOK_HEADER_NAME  – defaults to "Authorization"
 *   ZOHO_REPORT_WEBHOOK_FROM_PARAM   – query-param name for the start date,
 *                                      defaults to "from_date"
 *   ZOHO_REPORT_WEBHOOK_TO_PARAM     – query-param name for the end date,
 *                                      defaults to "to_date"
 *   ZOHO_REPORT_WEBHOOK_TIMEOUT_MS   – defaults to 20000
 *
 * Strict response contract (see contract doc for the full version):
 *
 *   {
 *     "items": [
 *       {
 *         "sku": "FL-SHINE-001",                  // REQUIRED, non-empty string
 *         "item_name": "FL SHINE",                // optional but recommended
 *         "item_id":   "12345",                   // optional
 *         "family":    "ZDS",                    // REQUIRED string — Zoho *Family* custom
 *                                                //   field, metadata only (NOT used
 *                                                //   for report_group membership). Use
 *                                                //   "" if the item has no Family in Zoho.
 *         "opening_stock":         12980,         // number | null | absent
 *         "purchases":                 0,         // number | null | absent
 *         "returned_to_wholesale":     0,         // number | null | absent
 *         "closing_stock":         11828,         // number | null | absent
 *         "sold":                  1152           // number | null | absent
 *       },
 *       ...
 *     ]
 *   }
 *
 * Business report groups (`slow_moving`, `other_family`, …) are defined only
 * in the DB table `item_report_groups`. The Zoho `family` field is item
 * metadata for display and future export — it is never a membership key.
 *
 * Strictness:
 *   - sku is the primary match key. Rows without a non-empty sku are rejected.
 *   - Numeric fields MUST be JSON numbers. Strings (even numeric strings),
 *     booleans, NaN, and Infinity are rejected as invalid.
 *   - A field that is absent OR explicitly null defaults to 0 (Zoho is
 *     stating "no movement"). Anything else surfaces a validation error.
 *
 * Error contract:
 *   - ZOHO_NOT_CONFIGURED         (env vars missing)             → controller maps to 503
 *   - ZOHO_WEBHOOK_TIMEOUT        (request did not return in time) → 504
 *   - ZOHO_WEBHOOK_HTTP_ERROR     (non-2xx status from Zoho)      → 502
 *   - WEBHOOK_INVALID_RESPONSE    (malformed JSON / shape / row)  → 502
 *
 * No business derivation happens here — every numeric field is taken verbatim
 * from the webhook response. Membership filtering by report group is performed
 * against the DB (see itemReportGroupsService.js).
 */

const https = require('https')
const http  = require('http')
const { listMembersOfGroup } = require('./itemReportGroupsService')

const DEFAULT_TIMEOUT_MS = 20000
const NUMERIC_FIELDS = [
  'opening_stock',
  'purchases',
  'returned_to_wholesale',
  'closing_stock',
  'sold',
]
const MAX_REPORTED_ERRORS = 10

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib    = parsed.protocol === 'https:' ? https : http
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    }
    const req = lib.request(reqOpts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', (err) => {
      err.code = err.code || 'ZOHO_WEBHOOK_NETWORK_ERROR'
      reject(err)
    })
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      const err = new Error(`Zoho webhook request timed out after ${timeoutMs}ms`)
      err.code = 'ZOHO_WEBHOOK_TIMEOUT'
      reject(err)
    })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readWebhookConfig() {
  const url        = process.env.ZOHO_REPORT_WEBHOOK_URL
  const authHeader = process.env.ZOHO_REPORT_WEBHOOK_AUTH_HEADER
  if (!url || !authHeader) {
    const err = new Error(
      'Zoho source not configured. Set ZOHO_REPORT_WEBHOOK_URL and ' +
      'ZOHO_REPORT_WEBHOOK_AUTH_HEADER in the backend environment to enable ' +
      'weekly Zoho-sourced reports.'
    )
    err.code = 'ZOHO_NOT_CONFIGURED'
    throw err
  }
  return {
    url,
    headerName: process.env.ZOHO_REPORT_WEBHOOK_HEADER_NAME || 'Authorization',
    authHeader,
    fromParam:  process.env.ZOHO_REPORT_WEBHOOK_FROM_PARAM  || 'from_date',
    toParam:    process.env.ZOHO_REPORT_WEBHOOK_TO_PARAM    || 'to_date',
    timeoutMs:  Number(process.env.ZOHO_REPORT_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function makeError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

function makeInvalidResponseError(errors) {
  const visible = errors.slice(0, MAX_REPORTED_ERRORS)
  const overflow = errors.length - visible.length
  const lines = visible.map((m, i) => `  ${i + 1}. ${m}`).join('\n')
  const tail  = overflow > 0 ? `\n  …and ${overflow} more validation error(s).` : ''
  const e = new Error(
    `Zoho webhook returned an invalid response (${errors.length} validation ` +
    `error${errors.length === 1 ? '' : 's'}):\n${lines}${tail}`
  )
  e.code = 'WEBHOOK_INVALID_RESPONSE'
  e.validation_errors = errors
  return e
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Call the Deluge webhook for a date range and return the raw `items` array.
 * Throws ZOHO_NOT_CONFIGURED, ZOHO_WEBHOOK_TIMEOUT, ZOHO_WEBHOOK_HTTP_ERROR,
 * or WEBHOOK_INVALID_RESPONSE depending on what went wrong.
 */
async function fetchInventorySnapshot(fromDate, toDate) {
  const cfg = readWebhookConfig()

  const u = new URL(cfg.url)
  u.searchParams.set(cfg.fromParam, fromDate)
  u.searchParams.set(cfg.toParam,   toDate)

  const { status, body } = await httpRequest(u.toString(), {
    method:    'GET',
    timeoutMs: cfg.timeoutMs,
    headers: {
      Accept:           'application/json',
      [cfg.headerName]: cfg.authHeader,
    },
  })

  let json
  try {
    json = JSON.parse(body)
  } catch {
    throw makeInvalidResponseError([
      `Response body is not valid JSON (HTTP ${status}). First 200 chars: ` +
      JSON.stringify(String(body).slice(0, 200)),
    ])
  }

  if (status < 200 || status >= 300) {
    const msg = (json && (json.error || json.message)) || body || `HTTP ${status}`
    throw makeError(
      'ZOHO_WEBHOOK_HTTP_ERROR',
      `Zoho webhook responded with HTTP ${status}: ${msg}`
    )
  }

  // Accept either { items: [...] } or a bare array.
  let items
  if (Array.isArray(json)) {
    items = json
  } else if (json && Array.isArray(json.items)) {
    items = json.items
  } else if (json && Array.isArray(json.data)) {
    items = json.data
  } else {
    throw makeInvalidResponseError([
      `Response is missing an "items" array. Top-level keys: ` +
      `${json && typeof json === 'object' ? Object.keys(json).join(', ') || '(none)' : `(not an object: ${typeof json})`}`,
    ])
  }

  return items
}

// ---------------------------------------------------------------------------
// Strict per-row validation + normalisation
// ---------------------------------------------------------------------------

/** True only for genuine, finite JSON numbers. Strings are rejected. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Validate a single numeric business field. Returns { value, error }. */
function validateNumericField(raw, field, rowLabel) {
  const v = raw[field]
  // Absent OR explicit null => Zoho is saying "no movement" => default to 0.
  if (v === undefined || v === null) return { value: 0, error: null }
  if (isFiniteNumber(v)) return { value: v, error: null }
  return {
    value: 0,
    error:
      `${rowLabel}: field "${field}" must be a JSON number (or null/absent for 0). ` +
      `Got ${typeof v}: ${JSON.stringify(v)}.`,
  }
}

/**
 * Validate + normalise a single row from the webhook response.
 * Returns { item, errors }. `errors` is empty on success.
 */
function validateAndNormaliseItem(raw, index) {
  const errors = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      item: null,
      errors: [`items[${index}]: row must be a JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`],
    }
  }

  const skuRaw = raw.sku
  let sku = ''
  if (skuRaw === undefined || skuRaw === null || skuRaw === '') {
    errors.push(`items[${index}]: "sku" is required and must be a non-empty string.`)
  } else if (typeof skuRaw !== 'string') {
    errors.push(`items[${index}]: "sku" must be a string. Got ${typeof skuRaw}.`)
  } else {
    sku = skuRaw.trim()
    if (!sku) {
      errors.push(`items[${index}]: "sku" must be a non-empty string after trimming.`)
    }
  }

  const itemName =
    typeof raw.item_name === 'string' ? raw.item_name.trim() :
    typeof raw.item      === 'string' ? raw.item.trim()      :
    ''

  const itemId =
    typeof raw.item_id === 'string' ? raw.item_id.trim() :
    typeof raw.id      === 'string' ? raw.id.trim()      :
    ''

  const rowLabel = `items[${index}] (sku="${sku || '?'}")`

  // Zoho Inventory "Family" custom field — required on every row (string).
  // Use "" when the item has no Family. Metadata only: report membership
  // stays on item_report_groups, never on `family`.
  let family = ''
  if (raw.family === undefined) {
    errors.push(
      `items[${index}]: "family" is required (Zoho Family metadata as a JSON ` +
        `string; use "" if the item has no Family in Zoho).`
    )
  } else if (raw.family === null) {
    errors.push(
      `items[${index}]: "family" must be a JSON string, not null (use "" if no Family).`
    )
  } else if (typeof raw.family !== 'string') {
    errors.push(
      `${rowLabel}: "family" must be a string (Zoho Family metadata). Got ${typeof raw.family}.`
    )
  } else {
    family = raw.family.trim()
  }
  const numeric = {}
  for (const field of NUMERIC_FIELDS) {
    const { value, error } = validateNumericField(raw, field, rowLabel)
    if (error) errors.push(error)
    numeric[field] = value
  }

  if (errors.length > 0) return { item: null, errors }

  return {
    item: {
      sku,
      item_name: itemName,
      item_id:   itemId,
      family, // Zoho Family metadata; not used for report_group matching
      ...numeric,
    },
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Membership filter — sku-primary, item_name fallback for legacy seeds only.
// ---------------------------------------------------------------------------

function buildMatcher(members) {
  const skus  = new Set()
  const names = new Set() // legacy fallback for DB rows that have no SKU yet
  for (const m of members) {
    if (m.sku) {
      skus.add(String(m.sku).trim().toLowerCase())
    } else if (m.item_name) {
      names.add(String(m.item_name).trim().toLowerCase())
    }
  }
  return (item) => {
    if (item.sku && skus.has(item.sku.toLowerCase())) return true
    if (item.item_name && names.has(item.item_name.toLowerCase())) return true
    return false
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Zoho-sourced rows for the given date range, validate them strictly,
 * then keep only those whose sku (or item_name as a legacy fallback) appears
 * in `item_report_groups` for the requested group. Each kept row includes
 * Zoho `family` metadata when the webhook provided it; matching never uses
 * `family`.
 *
 * Behaviour intentionally driven by the Zoho response, not the seed list:
 *   - If Zoho returns no row for an item that's in the group, it is NOT
 *     force-displayed with zeros.
 *   - If the group has no DB members, the report is empty (never the entire
 *     Zoho dump).
 *
 * Throws WEBHOOK_INVALID_RESPONSE if any row in the webhook response fails
 * validation. The error is fail-loud on purpose — we will not silently
 * coerce or default business numbers from a malformed source.
 */
async function getInventoryByGroup(group, fromDate, toDate) {
  const members = await listMembersOfGroup(group)
  if (members.length === 0) return []

  const raw = await fetchInventorySnapshot(fromDate, toDate)

  const items   = []
  const errors  = []
  for (let i = 0; i < raw.length; i++) {
    const { item, errors: rowErrors } = validateAndNormaliseItem(raw[i], i)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      if (errors.length >= MAX_REPORTED_ERRORS) break
    } else {
      items.push(item)
    }
  }

  if (errors.length > 0) throw makeInvalidResponseError(errors)

  const match = buildMatcher(members)
  return items.filter(match)
}

/**
 * Back-compat wrapper for the original /api/weekly-reports/slow-moving route.
 * New consumers should use getInventoryByGroup(group, ...) directly.
 */
async function getSlowMovingInventory(fromDate, toDate) {
  return getInventoryByGroup('slow_moving', fromDate, toDate)
}

module.exports = {
  getInventoryByGroup,
  getSlowMovingInventory,
  // Exported for unit testing.
  _internals: {
    validateAndNormaliseItem,
    buildMatcher,
  },
}
