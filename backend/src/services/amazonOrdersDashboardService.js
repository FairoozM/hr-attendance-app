/**
 * Amazon orders BI — reads cached orders/items; optional catalog images (Search Catalog Items, rate-limited).
 */

const { query } = require('../db')
const { getAmazonConfig } = require('./amazonSpApiService')
const cacheStore = require('./amazonOrdersCacheStore')
const {
  resolveCatalogPrimaryImagesByAsinWithCache,
  catalogImageLookupKey,
  isSafeAmazonImageUrl,
} = require('./amazonSkuImageService')
const { batchResolveSkuImageOverrides, normalizeAsin } = require('./amazonSkuImageOverrideStore')
const { getZohoImagesBySkus, zohoNormalizeSkuKey } = require('./zohoItemImageLookupService')

const MS_BEFORE_NOW = 130_000
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DASHBOARD_RANGE_MS = 366 * 24 * 60 * 60 * 1000

function roundMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 100) / 100
}

function defaultDateRange() {
  const now = Date.now()
  return {
    createdAfter: new Date(now - DEFAULT_RANGE_MS),
    createdBefore: new Date(now - MS_BEFORE_NOW),
  }
}

function parseDateInput(v) {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * @param {string|undefined} raw
 * @returns {'all'|'uae'|'ksa'}
 */
function normalizeDashboardMarketplaceKey(raw) {
  const k = String(raw == null ? 'all' : raw)
    .trim()
    .toLowerCase()
  if (k === 'all') return 'all'
  if (k === 'ksa') return 'ksa'
  return 'uae'
}

function validateRange(createdAfter, createdBefore) {
  if (!createdAfter || !createdBefore) {
    const err = new Error('createdAfter and createdBefore are required')
    err.code = 'AMAZON_DASHBOARD_VALIDATION'
    throw err
  }
  if (createdBefore.getTime() <= createdAfter.getTime()) {
    const err = new Error('createdBefore must be after createdAfter')
    err.code = 'AMAZON_DASHBOARD_VALIDATION'
    throw err
  }
  const span = createdBefore.getTime() - createdAfter.getTime()
  if (span > MAX_DASHBOARD_RANGE_MS) {
    const err = new Error('Date range cannot exceed 366 days')
    err.code = 'AMAZON_DASHBOARD_RANGE'
    throw err
  }
}

function resolveMarketplaceId(mk) {
  const cfg = getAmazonConfig(mk)
  const id = cfg.defaultMarketplaceId ? String(cfg.defaultMarketplaceId).trim() : ''
  if (id) return id
  return mk === 'ksa' ? 'A17E79C6D8DWNP' : 'A2VIGQ35RCS4UG'
}

/**
 * @param {object} opts
 * @param {'all'|'uae'|'ksa'} opts.marketplaceKey
 * @param {Date|null} [opts.createdAfter]
 * @param {Date|null} [opts.createdBefore]
 * @param {boolean} [opts.includeSkuImages=true] — optional catalog by ASIN (cached; up to 20 live API ASINs per catalog region per request).
 */
async function getAmazonOrdersDashboard(opts = {}) {
  const marketplaceKey = normalizeDashboardMarketplaceKey(opts.marketplaceKey)
  const useAll = marketplaceKey === 'all'
  const includeSkuImages = opts.includeSkuImages !== false

  let createdAfter = opts.createdAfter instanceof Date ? opts.createdAfter : parseDateInput(opts.createdAfter)
  let createdBefore =
    opts.createdBefore instanceof Date ? opts.createdBefore : parseDateInput(opts.createdBefore)
  if (!createdAfter || !createdBefore) {
    const d = defaultDateRange()
    createdAfter = d.createdAfter
    createdBefore = d.createdBefore
  }
  validateRange(createdAfter, createdBefore)

  const ca = createdAfter
  const cb = createdBefore
  const baseParams = useAll ? [ca, cb] : [marketplaceKey, ca, cb]

  const mkWhere = useAll
    ? `o.marketplace_key IN ('uae', 'ksa') AND o.purchase_date >= $1 AND o.purchase_date < $2`
    : `o.marketplace_key = $1 AND o.purchase_date >= $2 AND o.purchase_date < $3`

  /** Orders-by-day bucket: KSA local calendar; UAE and "all" use Dubai (documented in API). */
  const ordersByDayTimeZone = marketplaceKey === 'ksa' ? 'Asia/Riyadh' : 'Asia/Dubai'

  const summaryRes = await query(
    `SELECT
       COUNT(*)::int AS total_orders,
       COUNT(*) FILTER (WHERE COALESCE(o.number_of_items_shipped, 0) > 0)::int AS shipped_orders,
       COUNT(*) FILTER (WHERE COALESCE(o.number_of_items_unshipped, 0) > 0)::int AS pending_orders,
       COALESCE(SUM(COALESCE(o.number_of_items_unshipped, 0)), 0)::bigint AS unshipped_items
     FROM amazon_orders o
     WHERE ${mkWhere}`,
    baseParams
  )
  const srow = summaryRes.rows[0] || {}
  const totalOrders = srow.total_orders ?? 0
  const shippedOrders = srow.shipped_orders ?? 0
  const pendingOrders = srow.pending_orders ?? 0
  const unshippedItems = Number(srow.unshipped_items ?? 0)

  const salesRes = await query(
    `SELECT o.currency_code AS currency_code,
            SUM(o.order_amount)::numeric AS amount
     FROM amazon_orders o
     WHERE ${mkWhere}
       AND o.currency_code IS NOT NULL AND TRIM(o.currency_code) <> ''
       AND o.order_amount IS NOT NULL
     GROUP BY o.currency_code
     ORDER BY o.currency_code ASC`,
    baseParams
  )
  const totalSalesByCurrency = salesRes.rows.map((r) => ({
    currencyCode: String(r.currency_code).trim(),
    amount: roundMoney(r.amount),
  }))

  const byDayRes = await query(
    `SELECT to_char(((o.purchase_date AT TIME ZONE '${ordersByDayTimeZone}'))::date, 'YYYY-MM-DD') AS dt,
            o.currency_code AS currency_code,
            COUNT(*)::int AS order_count,
            SUM(o.order_amount)::numeric AS total_amount
     FROM amazon_orders o
     WHERE ${mkWhere}
       AND o.purchase_date IS NOT NULL
     GROUP BY 1, o.currency_code
     HAVING o.currency_code IS NOT NULL AND TRIM(o.currency_code) <> ''
     ORDER BY 1 ASC, o.currency_code ASC`,
    baseParams
  )
  const ordersByDay = byDayRes.rows.map((r) => ({
    date: r.dt,
    orderCount: r.order_count,
    totalAmount: roundMoney(r.total_amount),
    currencyCode: String(r.currency_code).trim(),
  }))

  const topSkuWhere = useAll
    ? `oi.marketplace_key IN ('uae', 'ksa')
       AND o.purchase_date >= $1 AND o.purchase_date < $2`
    : `oi.marketplace_key = $1
       AND o.purchase_date >= $2 AND o.purchase_date < $3`

  const topSkuRes = await query(
    `WITH line_dim AS (
       SELECT
         oi.marketplace_key AS order_marketplace_key,
         COALESCE(NULLIF(TRIM(oi.seller_sku), ''), '(no sku)') AS seller_sku,
         COALESCE(NULLIF(TRIM(oi.item_currency_code), ''), NULLIF(TRIM(o.currency_code), ''), '?') AS currency_code,
         NULLIF(TRIM(oi.asin), '') AS asin,
         LEFT(COALESCE(oi.title, ''), 240) AS title_trim,
         COALESCE(oi.quantity_ordered, 0) AS quantity_ordered,
         COALESCE(oi.quantity_shipped, 0) AS quantity_shipped,
         COALESCE(oi.item_amount, 0)::numeric AS item_amount,
         (o.marketplace_key || '|' || o.amazon_order_id) AS order_key
       FROM amazon_order_items oi
       INNER JOIN amazon_orders o
         ON o.marketplace_key = oi.marketplace_key AND o.amazon_order_id = oi.amazon_order_id
       WHERE ${topSkuWhere}
     ),
     asin_votes AS (
       SELECT seller_sku, currency_code, order_marketplace_key, asin, COUNT(*)::bigint AS vote
       FROM line_dim
       WHERE asin IS NOT NULL
       GROUP BY seller_sku, currency_code, order_marketplace_key, asin
     ),
     dominant AS (
       SELECT DISTINCT ON (seller_sku, currency_code, order_marketplace_key)
         seller_sku, currency_code, order_marketplace_key, asin AS dominant_asin
       FROM asin_votes
       ORDER BY seller_sku, currency_code, order_marketplace_key, vote DESC, asin ASC
     )
     SELECT l.seller_sku,
            MAX(l.title_trim) AS title,
            MAX(d.dominant_asin) AS asin,
            l.order_marketplace_key,
            SUM(l.quantity_ordered)::bigint AS quantity_ordered,
            SUM(l.quantity_shipped)::bigint AS quantity_shipped,
            SUM(l.item_amount)::numeric AS total_sales,
            l.currency_code,
            COUNT(DISTINCT l.order_key)::int AS order_count
     FROM line_dim l
     LEFT JOIN dominant d
       ON d.seller_sku = l.seller_sku
      AND d.currency_code = l.currency_code
      AND d.order_marketplace_key = l.order_marketplace_key
     GROUP BY l.seller_sku, l.currency_code, l.order_marketplace_key
     ORDER BY total_sales DESC NULLS LAST
     LIMIT 30`,
    baseParams
  )
  let topSkus = topSkuRes.rows.map((r) => ({
    sellerSku: r.seller_sku,
    title: r.title || null,
    asin: r.asin ? String(r.asin).trim().toUpperCase() : null,
    orderMarketplaceKey: r.order_marketplace_key ? String(r.order_marketplace_key).trim().toLowerCase() : null,
    imageUrl: null,
    imageSource: 'none',
    zohoItemId: null,
    quantityOrdered: Number(r.quantity_ordered) || 0,
    quantityShipped: Number(r.quantity_shipped) || 0,
    totalSales: roundMoney(r.total_sales),
    currencyCode: String(r.currency_code).trim(),
    orderCount: r.order_count ?? 0,
  }))

  let imageFetchStatus = includeSkuImages ? 'cache' : 'skipped'
  let imageFetchMessage = null

  if (includeSkuImages && topSkus.length) {
    try {
      const {
        urlByAsin,
        imageFetchStatus: imgStatus,
        imageFetchMessage: imgMsg,
      } = await resolveCatalogPrimaryImagesByAsinWithCache(
        marketplaceKey,
        topSkus.map((r) => ({
          asin: r.asin,
          sellerSku: r.sellerSku,
          catalogMarketplaceKey: r.orderMarketplaceKey === 'ksa' ? 'ksa' : 'uae',
        }))
      )
      imageFetchStatus = imgStatus
      imageFetchMessage = imgMsg || null

      const byMk = new Map()
      for (const row of topSkus) {
        const cmk = row.orderMarketplaceKey === 'ksa' ? 'ksa' : 'uae'
        if (!byMk.has(cmk)) byMk.set(cmk, [])
        byMk.get(cmk).push({ sellerSku: row.sellerSku, asin: row.asin })
      }
      const ovByMk = new Map()
      for (const [cmk, prs] of byMk) {
        try {
          ovByMk.set(cmk, await batchResolveSkuImageOverrides(cmk, prs))
        } catch {
          ovByMk.set(cmk, new Map())
        }
      }

      const zohoSkuList = topSkus
        .map((r) => (r.sellerSku != null ? String(r.sellerSku).trim() : ''))
        .filter((s) => s && s !== '(no sku)')
      let zohoBySku = new Map()
      try {
        zohoBySku = await getZohoImagesBySkus({ skus: [...new Set(zohoSkuList)] })
      } catch {
        zohoBySku = new Map()
      }

      topSkus = topSkus.map((row) => {
        const asin = row.asin ? String(row.asin).trim().toUpperCase() : null
        const cmk = row.orderMarketplaceKey === 'ksa' ? 'ksa' : 'uae'
        const lookupKey = catalogImageLookupKey(cmk, asin)
        const imageUrlRaw =
          lookupKey && Object.prototype.hasOwnProperty.call(urlByAsin, lookupKey)
            ? urlByAsin[lookupKey]
            : null
        const catalogCandidate =
          typeof imageUrlRaw === 'string' && imageUrlRaw.trim().startsWith('http') ? imageUrlRaw.trim() : null
        const fromCatalog = catalogCandidate && isSafeAmazonImageUrl(catalogCandidate)
        let imageUrl = fromCatalog ? catalogCandidate : null
        let imageSource = fromCatalog ? 'amazon_catalog' : 'none'
        let zohoItemId = null
        if (!imageUrl) {
          const skuZ = row.sellerSku != null ? String(row.sellerSku).trim() : ''
          if (skuZ && skuZ !== '(no sku)') {
            const z = zohoBySku.get(zohoNormalizeSkuKey(skuZ))
            if (z && z.imageUrl) {
              imageUrl = z.imageUrl
              imageSource = 'zoho_item'
              zohoItemId = z.itemId
            }
          }
        }
        if (!imageUrl) {
          const skuN = row.sellerSku != null ? String(row.sellerSku).trim() : ''
          const asinKey = normalizeAsin(row.asin || '')
          const m = ovByMk.get(cmk) || new Map()
          const hit = m.get(`${skuN}\t${asinKey}`)
          if (hit && hit.imageUrl) {
            imageUrl = hit.imageUrl
            imageSource = hit.imageSource === 'asin_override' ? 'asin_override' : 'sku_override'
          }
        }
        let rowImageStatus = 'no_image'
        if (!asin) rowImageStatus = 'no_asin'
        else if (imageUrl) rowImageStatus = 'ok'
        else if (!includeSkuImages) rowImageStatus = 'skipped'
        return {
          ...row,
          asin,
          orderMarketplaceKey: cmk,
          imageUrl,
          imageSource,
          zohoItemId,
          imageFetchStatus: rowImageStatus,
        }
      })
    } catch (e) {
      console.warn('[amazon dashboard catalog images]', e?.message || e)
      imageFetchStatus = 'failed'
      imageFetchMessage = 'Catalog image lookup failed or returned no image'
      topSkus = topSkus.map((row) => ({
        ...row,
        imageFetchStatus: !row.asin ? 'no_asin' : 'no_image',
        imageSource: 'none',
        zohoItemId: null,
      }))
    }
  } else if (!includeSkuImages && topSkus.length) {
    topSkus = topSkus.map((row) => ({
      ...row,
      imageFetchStatus: 'skipped',
      imageSource: 'none',
      zohoItemId: null,
    }))
  }

  const breakdownRes = await query(
    `SELECT o.marketplace_key AS marketplace_key,
            MAX(o.marketplace_id) AS marketplace_id,
            o.currency_code AS currency_code,
            COUNT(*)::int AS order_count,
            SUM(o.order_amount)::numeric AS total_sales
     FROM amazon_orders o
     WHERE ${mkWhere}
       AND o.currency_code IS NOT NULL AND TRIM(o.currency_code) <> ''
       AND o.order_amount IS NOT NULL
     GROUP BY o.marketplace_key, o.currency_code
     ORDER BY o.marketplace_key ASC, o.currency_code ASC`,
    baseParams
  )

  const marketplaceBreakdown = []
  for (const r of breakdownRes.rows) {
    const mk = String(r.marketplace_key)
    const mid = r.marketplace_id ? String(r.marketplace_id).trim() : resolveMarketplaceId(mk)
    marketplaceBreakdown.push({
      marketplaceKey: mk,
      marketplaceId: mid,
      orderCount: r.order_count ?? 0,
      totalSales: roundMoney(r.total_sales),
      currencyCode: String(r.currency_code).trim(),
    })
  }

  if (marketplaceBreakdown.length === 0 && totalOrders > 0) {
    const mkKeys = useAll ? ['uae', 'ksa'] : [marketplaceKey]
    for (const mk of mkKeys) {
      const cnt = await query(
        `SELECT COUNT(*)::int AS c FROM amazon_orders o
         WHERE o.marketplace_key = $1 AND o.purchase_date >= $2 AND o.purchase_date < $3`,
        [mk, ca, cb]
      )
      const c = cnt.rows[0]?.c ?? 0
      if (c > 0) {
        marketplaceBreakdown.push({
          marketplaceKey: mk,
          marketplaceId: resolveMarketplaceId(mk),
          orderCount: c,
          totalSales: 0,
          currencyCode: '—',
        })
      }
    }
  }

  const cacheCoverage = await cacheStore.getOrdersCacheCoverage(marketplaceKey, ca, cb)

  return {
    source: 'cache',
    marketplaceKey,
    createdAfter: ca.toISOString(),
    createdBefore: cb.toISOString(),
    ordersByDayTimeZone,
    cacheCoverage,
    totalOrders,
    totalSalesByCurrency,
    shippedOrders,
    pendingOrders,
    unshippedItems,
    ordersByDay,
    topSkus,
    marketplaceBreakdown,
    includeSkuImages,
    imageFetchStatus,
    imageFetchMessage,
  }
}

module.exports = {
  getAmazonOrdersDashboard,
  normalizeDashboardMarketplaceKey,
}
