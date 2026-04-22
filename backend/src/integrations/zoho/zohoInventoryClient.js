/**
 * Low-level Zoho Inventory REST v1 client (data transport only).
 * No report semantics — that lives in weeklyReportZohoData.js.
 */

const { getZohoAccessToken } = require('./zohoOAuth')
const { readZohoInventoryConfig, INVENTORY_V1 } = require('./zohoConfig')
const { httpsRequestJson } = require('./zohoHttp')

const DEFAULT_PER_PAGE = 200

/**
 * @param {string} path - must start with / e.g. /inventory/v1/items
 * @param {URLSearchParams} [searchParams]
 * @param {string} [method]
 * @param {string} [body]
 */
async function zohoApiRequest(path, searchParams, method, body) {
  const c = readZohoInventoryConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const token = await getZohoAccessToken()
  if (!searchParams) searchParams = new URLSearchParams()
  if (!searchParams.get('organization_id')) {
    searchParams.set('organization_id', c.organizationId)
  }
  const u = new URL(c.apiBase + path)
  u.search = searchParams.toString()
  const { status, body: resBody } = await httpsRequestJson(u.toString(), {
    method: method || 'GET',
    body: body || undefined,
    timeoutMs: c.timeoutMs,
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
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
  const c = readZohoInventoryConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const per = DEFAULT_PER_PAGE
  const all = []
  for (let page = 1; page < 10_000; page += 1) {
    const p = new URLSearchParams()
    p.set('organization_id', c.organizationId)
    p.set('page', String(page))
    p.set('per_page', String(per))
    const json = await zohoApiRequest(`${INVENTORY_V1}/items`, p, 'GET')
    const list = (json && json.items) || (json && json.item) || []
    const pageItems = Array.isArray(list) ? list : []
    for (const it of pageItems) all.push(it)
    if (pageItems.length < per) break
  }
  return all
}

module.exports = { zohoApiRequest, listAllItems }
