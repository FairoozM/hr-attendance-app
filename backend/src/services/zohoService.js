/**
 * Zoho Inventory integration service.
 *
 * Required environment variables:
 *   ZOHO_CLIENT_ID        – OAuth2 client ID
 *   ZOHO_CLIENT_SECRET    – OAuth2 client secret
 *   ZOHO_REFRESH_TOKEN    – long-lived refresh token (generate once via OAuth2 code flow)
 *   ZOHO_ORGANIZATION_ID  – Zoho Inventory organization ID
 *   ZOHO_ACCOUNTS_URL     – (optional) defaults to https://accounts.zoho.com
 *   ZOHO_INVENTORY_URL    – (optional) defaults to https://inventory.zoho.com
 *
 * The service caches the access token in memory and refreshes it automatically
 * when it expires (1-hour TTL with a 60-second safety margin).
 */

const https = require('https')
const http  = require('http')

const ACCOUNTS_URL  = (process.env.ZOHO_ACCOUNTS_URL  || 'https://accounts.zoho.com').replace(/\/$/, '')
const INVENTORY_URL = (process.env.ZOHO_INVENTORY_URL || 'https://inventory.zoho.com').replace(/\/$/, '')

let _tokenCache = {
  accessToken: null,
  expiresAt: 0,        // epoch ms
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function httpsRequest(url, options = {}, body = null) {
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
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Zoho request timed out')) })
    if (body) req.write(body)
    req.end()
  })
}

async function refreshAccessToken() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error(
      'Zoho credentials are not configured. ' +
      'Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN in your environment.'
    )
  }

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  })

  const { status, body } = await httpsRequest(
    `${ACCOUNTS_URL}/oauth/v2/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    params.toString()
  )

  let json
  try { json = JSON.parse(body) } catch {
    throw new Error(`Zoho token endpoint returned non-JSON (HTTP ${status})`)
  }

  if (status !== 200 || !json.access_token) {
    throw new Error(
      `Zoho token refresh failed (HTTP ${status}): ${json.error || json.message || body}`
    )
  }

  // expires_in is in seconds; apply a 60-second safety margin
  const ttlMs = ((json.expires_in || 3600) - 60) * 1000
  _tokenCache = { accessToken: json.access_token, expiresAt: Date.now() + ttlMs }
  return json.access_token
}

async function getAccessToken() {
  if (_tokenCache.accessToken && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.accessToken
  }
  return refreshAccessToken()
}

async function zohoGet(path, queryParams = {}) {
  const token  = await getAccessToken()
  const orgId  = process.env.ZOHO_ORGANIZATION_ID
  if (!orgId) throw new Error('ZOHO_ORGANIZATION_ID is not set.')

  const qs = new URLSearchParams({ organization_id: orgId, ...queryParams })
  const url = `${INVENTORY_URL}/api/v1${path}?${qs.toString()}`

  const { status, body } = await httpsRequest(url, {
    method:  'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept:        'application/json',
    },
  })

  let json
  try { json = JSON.parse(body) } catch {
    throw new Error(`Zoho API returned non-JSON (HTTP ${status}) for ${path}`)
  }

  if (status !== 200 || (json.code !== undefined && json.code !== 0)) {
    throw new Error(
      `Zoho API error (HTTP ${status}, code ${json.code}): ${json.message || body}`
    )
  }

  return json
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Zoho Inventory Summary report for a given date range.
 *
 * Zoho endpoint: GET /api/v1/reports/inventorysummary
 *
 * Each item in the returned array contains:
 *   item_id, item_name, sku,
 *   opening_stock,
 *   quantity_purchased         → Purchases
 *   quantity_purchased_returned→ Returned to Wholesale
 *   quantity_sold              → SOLD
 *   quantity_adjusted          → manual adjustments
 *   closing_stock
 *
 * @param {string} fromDate – YYYY-MM-DD
 * @param {string} toDate   – YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function fetchInventorySummary(fromDate, toDate) {
  const data = await zohoGet('/reports/inventorysummary', {
    from_date: fromDate,
    to_date:   toDate,
  })

  // Zoho may return the list under different top-level keys depending on the API version
  return (
    data.inventory_summary ||
    data.inventorysummary  ||
    data.items             ||
    []
  )
}

/**
 * Normalise a single Zoho inventory summary row into the shape our
 * weekly report controller expects.
 *
 * Zoho field names can vary slightly between API versions / regions.
 * We try every known alias so the service is robust to minor variations.
 */
function normaliseItem(raw) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return Number(raw[k]) || 0
    }
    return 0
  }

  return {
    item_id:              raw.item_id   || raw.item_name || '',
    item_name:            raw.item_name || raw.name      || '',
    sku:                  raw.sku       || raw.item_sku  || '',
    opening_stock:        pick('opening_stock', 'opening_quantity'),
    purchases:            pick('quantity_purchased',         'quantity_in',     'purchased_quantity'),
    returned_to_wholesale:pick('quantity_purchased_returned','purchase_returns', 'quantity_returned'),
    sold:                 pick('quantity_sold',  'sales_quantity',  'quantity_out'),
    closing_stock:        pick('closing_stock', 'closing_quantity'),
    // preserve all raw fields for debugging
    _raw: raw,
  }
}

/**
 * Filter and return only items that are tagged as "slow_moving".
 *
 * Detection order:
 *  1. Zoho custom field  `cf_report_group` === 'slow_moving'
 *  2. Zoho custom field  `cf_category`      === 'slow_moving'
 *  3. Item tags array    contains            'slow_moving'
 *  4. Env var            ZOHO_SLOW_MOVING_ITEMS (comma-separated SKUs / item names)
 *
 * If none of the above applies to any item the full list is returned so the
 * report is never silently empty on first deploy.
 */
function filterSlowMovingItems(items) {
  const envList = (process.env.ZOHO_SLOW_MOVING_ITEMS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  function isSlowMoving(item) {
    const raw = item._raw || {}

    // 1. Custom field cf_report_group
    if (raw.cf_report_group && String(raw.cf_report_group).toLowerCase() === 'slow_moving') return true

    // 2. Custom field cf_category
    if (raw.cf_category && String(raw.cf_category).toLowerCase() === 'slow_moving') return true

    // 3. Tags array
    const tags = raw.tags || raw.item_tags || []
    if (Array.isArray(tags) && tags.some(t => {
      const tv = typeof t === 'object' ? (t.tag_name || t.name || '') : String(t)
      return tv.toLowerCase() === 'slow_moving'
    })) return true

    // 4. Env-var allowlist (by SKU or name)
    if (envList.length) {
      const sku  = (item.sku        || '').toLowerCase()
      const name = (item.item_name  || '').toLowerCase()
      if (envList.includes(sku) || envList.includes(name)) return true
    }

    return false
  }

  const filtered = items.filter(isSlowMoving)

  // Fallback: return all items when no classification exists yet
  return filtered.length > 0 ? filtered : items
}

/**
 * Main entry point used by the weekly reports controller.
 *
 * Returns an array of normalised items filtered to the slow-moving group.
 */
async function getSlowMovingInventory(fromDate, toDate) {
  const raw       = await fetchInventorySummary(fromDate, toDate)
  const normalised = raw.map(normaliseItem)
  return filterSlowMovingItems(normalised)
}

module.exports = { getSlowMovingInventory }
