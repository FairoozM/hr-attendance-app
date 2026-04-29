/**
 * Low-level Zoho Inventory REST v1 client (data transport only).
 * All HTTP traffic goes through services/zohoApiClient.js (limits, cache, logs).
 */

const { readZohoConfig, INVENTORY_V1 } = require('./zohoConfig')
const {
  zohoInventoryJsonRequest,
  zohoInventoryBufferRequest,
  zohoBooksJsonRequest,
} = require('../../services/zohoApiClient')

const DEFAULT_PER_PAGE = 200
const MAX_ITEMS_PAGES = 50

/** When false (default), list requests use filter_by=Status.Active — fewer rows/pages vs fetching all SKUs. */
function itemsIncludeInactive() {
  return String(process.env.ZOHO_ITEMS_INCLUDE_INACTIVE || '').trim() === '1'
}
const ITEMS_PAGE_BATCH_SIZE =
  process.env.ZOHO_ITEMS_PAGE_BATCH_SIZE !== undefined
    ? Math.max(1, parseInt(process.env.ZOHO_ITEMS_PAGE_BATCH_SIZE, 10) || 1)
    : 2

/**
 * @param {string} path - must start with / e.g. /inventory/v1/items
 * @param {URLSearchParams} [searchParams]
 * @param {string} [method]
 * @param {string} [body]
 * @param {object} [meta] - forwarded to zohoApiClient (critical, skipCache, cacheKey, …)
 */
async function zohoApiRequest(path, searchParams, method, body, meta) {
  const m = meta || {}
  if (String(path).startsWith('/books/')) {
    return zohoBooksJsonRequest(path, searchParams, method, body, m)
  }
  return zohoInventoryJsonRequest(path, searchParams, method, body, m)
}

function makeItemsPageParams(page, per, warehouseId = null) {
  const c = readZohoConfig()
  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  p.set('page', String(page))
  p.set('per_page', String(per))
  if (!itemsIncludeInactive()) {
    p.set('filter_by', 'Status.Active')
  }
  if (warehouseId) {
    const id = String(warehouseId).trim()
    p.set('warehouse_id', id)
    p.set('location_id', id)
  }
  return p
}

async function fetchItemsPage(page, per, warehouseId = null) {
  const scope = itemsIncludeInactive() ? 'all' : 'active'
  const meta = {
    cacheCategory: 'items_list',
    cacheKey: `zoho:items_list:p${page}:per${per}:wh${warehouseId || 'all'}:${scope}`,
    source: 'inventory_items_page',
  }
  const json = await zohoInventoryJsonRequest(
    `${INVENTORY_V1}/items`,
    makeItemsPageParams(page, per, warehouseId),
    'GET',
    undefined,
    meta
  )
  const list = (json && json.items) || (json && json.item) || []
  const pageItems = Array.isArray(list) ? list : []
  const hasMore =
    json &&
    json.page_context &&
    json.page_context.has_more_page === true
  const total = Number(json && json.page_context && json.page_context.total)
  return {
    page,
    items: pageItems,
    hasMore,
    total: Number.isFinite(total) && total > 0 ? total : 0,
  }
}

async function listItemsPaged(warehouseId = null) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const per = DEFAULT_PER_PAGE
  const all = []
  const t0 = Date.now()
  const label = warehouseId ? `[zoho-items-wh] wh=${warehouseId}` : '[zoho-items]'

  console.log(`${label} fetching page 1/${MAX_ITEMS_PAGES}…`)
  const first = await fetchItemsPage(1, per, warehouseId)
  all.push(...first.items)

  if (!first.hasMore || first.items.length === 0 || first.items.length < per) {
    console.log(`${label}: ${all.length} items in 1 page(s) — ${Date.now() - t0}ms`)
    return all
  }

  const estimatedPages = first.total > 0
    ? Math.min(Math.ceil(first.total / per), MAX_ITEMS_PAGES)
    : MAX_ITEMS_PAGES

  let fetchedPages = 1
  let hitPaginationLimit = false
  for (let start = 2; start <= estimatedPages; start += ITEMS_PAGE_BATCH_SIZE) {
    const pages = []
    for (let p = start; p < start + ITEMS_PAGE_BATCH_SIZE && p <= estimatedPages; p += 1) {
      pages.push(p)
    }
    console.log(`${label} fetching pages ${pages[0]}-${pages[pages.length - 1]}/${estimatedPages}…`)
    const results = await Promise.all(pages.map((p) => fetchItemsPage(p, per, warehouseId)))

    let stop = false
    for (const result of results) {
      fetchedPages += 1
      all.push(...result.items)
      hitPaginationLimit = result.page >= MAX_ITEMS_PAGES && result.hasMore
      if (!result.hasMore || result.items.length === 0 || result.items.length < per) {
        stop = true
        break
      }
    }
    if (stop) break
  }

  if (hitPaginationLimit) {
    const e = new Error(
      `[zoho-items] safety limit reached: items pagination exceeded ${MAX_ITEMS_PAGES} pages. ` +
      `Fetched ${all.length} items so far. Narrow your item catalog or raise MAX_ITEMS_PAGES.`
    )
    e.code = 'ZOHO_PAGINATION_LIMIT'
    throw e
  }

  console.log(`${label}: ${all.length} items in ${fetchedPages} page(s) — ${Date.now() - t0}ms`)
  return all
}

async function listAllItems() {
  return listItemsPaged(null)
}

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
    const reqFn = endpoint.startsWith('/books/') ? zohoBooksJsonRequest : zohoInventoryJsonRequest
    const json = await reqFn(path, p, 'GET', undefined, {
      source: endpoint.startsWith('/books/') ? 'books_fetch_list' : 'inventory_fetch_list',
      cacheCategory: 'sales_orders',
      cacheKey: `zoho:list:${endpoint}:p${page}:${extraParams ? extraParams.toString() : ''}`,
    })
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
  const imagePath = `${INVENTORY_V1}/items/${encodeURIComponent(id)}/image`
  const { status, body, contentType } = await zohoInventoryBufferRequest(imagePath, p, {
    source: 'inventory_image',
  })
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
  return { buffer: body, contentType: contentType || 'image/jpeg' }
}

async function listItemsForWarehouse(warehouseId) {
  const wid = String(warehouseId).trim()
  return listItemsPaged(wid)
}

module.exports = { zohoApiRequest, listAllItems, listItemsForWarehouse, fetchListPaginated, fetchZohoItemImageBuffer }
