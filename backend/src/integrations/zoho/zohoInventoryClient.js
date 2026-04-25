/**
 * Low-level Zoho Inventory REST v1 client (data transport only).
 * No report semantics — that lives in weeklyReportZohoData.js.
 */

const { getZohoAccessToken, isInvalidAccessTokenResponse } = require('./zohoOAuth')
const { readZohoConfig, INVENTORY_V1 } = require('./zohoConfig')
const { httpsRequestJson, httpsRequestBuffer } = require('./zohoHttp')

const DEFAULT_PER_PAGE = 200
const MAX_ITEMS_PAGES = 50

/**
 * @param {string} path - must start with / e.g. /inventory/v1/items
 * @param {URLSearchParams} [searchParams]
 * @param {string} [method]
 * @param {string} [body]
 */
async function zohoApiRequest(path, searchParams, method, body) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  if (!searchParams) searchParams = new URLSearchParams()
  if (!searchParams.get('organization_id')) {
    searchParams.set('organization_id', c.organizationId)
  }
  const u = new URL(c.apiBase + path)
  u.search = searchParams.toString()

  // One-shot 401 retry guard: if Zoho rejects the cached access token with
  // INVALID_OAUTHTOKEN, force a single refresh and retry once. Other 401s
  // (e.g. missing scope / Zoho code 57) are NOT retried — refreshing won't
  // fix scope problems and we'd just burn an extra token call per request.
  let token = await getZohoAccessToken()
  let { status, body: resBody } = await httpsRequestJson(u.toString(), {
    method: method || 'GET',
    body: body || undefined,
    timeoutMs: c.timeoutMs,
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (isInvalidAccessTokenResponse(status, resBody)) {
    console.warn(
      `[zoho-auth] retrying after invalid access token — ${path.split('?')[0]}`
    )
    token = await getZohoAccessToken({ force: true })
    ;({ status, body: resBody } = await httpsRequestJson(u.toString(), {
      method: method || 'GET',
      body: body || undefined,
      timeoutMs: c.timeoutMs,
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    }))
  }

  if (status < 200 || status >= 300) {
    const e = new Error(
      `Zoho Inventory API HTTP ${status} for ${path.split('?')[0]}: ${(resBody || '').slice(0, 500)}`
    )
    e.code = 'ZOHO_API_ERROR'
    e.httpStatus = status
    e.zohoPath = path
    throw e
  }
  let json
  try {
    json = JSON.parse(resBody)
  } catch (err) {
    const e = new Error('Zoho response is not valid JSON')
    e.code = 'ZOHO_API_ERROR'
    e.cause = err
    throw e
  }
  if (json && typeof json === 'object' && 'code' in json && String(json.code) !== '0') {
    const e = new Error(
      `Zoho API application error: code ${json.code} — ${json.message || resBody?.slice(0, 200)}`
    )
    e.code = 'ZOHO_API_ERROR'
    e.zohoResponse = json
    throw e
  }
  return json
}

/**
 * Fetch all items with pagination. Raw Zoho `items` objects only.
 * @returns {Promise<object[]>}
 */
async function listAllItems() {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const per = DEFAULT_PER_PAGE
  const all = []
  const t0 = Date.now()
  for (let page = 1; page <= MAX_ITEMS_PAGES; page += 1) {
    console.log(`[zoho-items] fetching page ${page}/${MAX_ITEMS_PAGES}…`)
    const p = new URLSearchParams()
    p.set('organization_id', c.organizationId)
    p.set('page', String(page))
    p.set('per_page', String(per))
    const json = await zohoApiRequest(`${INVENTORY_V1}/items`, p, 'GET')
    const list = (json && json.items) || (json && json.item) || []
    const pageItems = Array.isArray(list) ? list : []
    for (const it of pageItems) all.push(it)

    const hasMore =
      json &&
      json.page_context &&
      json.page_context.has_more_page === true
    if (!hasMore || pageItems.length === 0 || pageItems.length < per) {
      console.log(
        `[zoho-items] fetched ${all.length} items in ${page} page(s) — ${Date.now() - t0}ms`
      )
      break
    }

    if (page === MAX_ITEMS_PAGES) {
      const e = new Error(
        `[zoho-items] safety limit reached: items pagination exceeded ${MAX_ITEMS_PAGES} pages. ` +
        `Fetched ${all.length} items so far. Narrow your item catalog or raise MAX_ITEMS_PAGES.`
      )
      e.code = 'ZOHO_PAGINATION_LIMIT'
      throw e
    }
  }
  return all
}

/**
 * Paginate a list endpoint that returns a JSON object with an array at `listKey`.
 * **Assumption:** `page` / `per_page` (default 200) per Zoho Inventory v1.
 * Large orgs may have many pages — see `docs/weekly-report-zoho-transactions.md`.
 *
 * Pagination stops when ANY of these are true:
 *  - `page_context.has_more_page` is false or absent
 *  - the page returned fewer items than `per_page`
 *  - the page returned an empty array
 *  - `maxPages` is reached (sets `truncated: true`)
 *
 * @param {string} path - e.g. `${INVENTORY_V1}/invoices`
 * @param {string} listKey - response array key, e.g. `invoices`, `bills`, `vendor_credits`
 * @param {number} [maxPages=50] - hard safety cap; if reached, `truncated: true` in result
 * @param {URLSearchParams | null} [extraParams] - additional Zoho filter params merged into every page request (e.g. date range)
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchListPaginated(path, listKey, maxPages = 50, extraParams = null) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const all = []
  const per = DEFAULT_PER_PAGE
  const endpoint = path.split('?')[0]
  const t0 = Date.now()
  for (let page = 1; page <= maxPages; page += 1) {
    const p = new URLSearchParams()
    p.set('organization_id', c.organizationId)
    p.set('page', String(page))
    p.set('per_page', String(per))
    if (extraParams) {
      for (const [k, v] of extraParams.entries()) {
        p.set(k, v)
      }
    }
    const json = await zohoApiRequest(path, p, 'GET')
    const list = json && json[listKey]
    const pageItems = Array.isArray(list) ? list : []
    for (const it of pageItems) all.push(it)

    const hasMore =
      json &&
      json.page_context &&
      json.page_context.has_more_page === true

    if (!hasMore || pageItems.length === 0 || pageItems.length < per) {
      console.log(
        `[zoho-fetch] ${endpoint}: ${all.length} rows in ${page} page(s) — ${Date.now() - t0}ms`
      )
      return { rows: all, truncated: false, pages: page }
    }

    if (page === maxPages) {
      console.warn(
        `[zoho-fetch] ${endpoint}: safety limit of ${maxPages} pages reached — ` +
        `${all.length} rows fetched, result is TRUNCATED. Narrow the date range or raise maxPages.`
      )
      return { rows: all, truncated: true, pages: maxPages }
    }
  }
  return { rows: all, truncated: true, pages: maxPages }
}

/**
 * Raw bytes for a Zoho product image (GET /items/{id}/image).
 * @param {string} itemId - Zoho item_id
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>} null if Zoho has no image (404)
 */
async function fetchZohoItemImageBuffer(itemId) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const id = String(itemId || '').trim()
  if (!id || !/^[0-9A-Za-z._-]{1,64}$/.test(id)) {
    const e = new Error('Invalid Zoho item id for image request')
    e.code = 'ZOHO_INVALID_ITEM_ID'
    throw e
  }
  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  const path = `${INVENTORY_V1}/items/${encodeURIComponent(id)}/image`
  const u = new URL(c.apiBase + path)
  u.search = p.toString()
  const doReq = (token) =>
    httpsRequestBuffer(u.toString(), {
      timeoutMs: c.timeoutMs,
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })
  let token = await getZohoAccessToken()
  let { status, body, headers: resHeaders } = await doReq(token)
  if (isInvalidAccessTokenResponse(status, body.toString('utf8'))) {
    token = await getZohoAccessToken({ force: true })
    ;({ status, body, headers: resHeaders } = await doReq(token))
  }
  if (status === 404) return null
  if (status < 200 || status >= 300) {
    const e = new Error(
      `Zoho Inventory item image HTTP ${status}: ${(body && body.toString('utf8').slice(0, 200)) || ''}`
    )
    e.code = 'ZOHO_API_ERROR'
    e.httpStatus = status
    throw e
  }
  if (!body || body.length === 0) {
    return null
  }
  const raw = resHeaders && resHeaders['content-type']
  const contentType = raw
    ? String(raw).split(';')[0].trim() || 'image/jpeg'
    : 'image/jpeg'
  return { buffer: body, contentType }
}

module.exports = { zohoApiRequest, listAllItems, fetchListPaginated, fetchZohoItemImageBuffer }
