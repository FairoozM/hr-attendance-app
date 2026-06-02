const {
  marketplaceIdForKey,
  createAmazonListingsReport,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  getAmazonFbaInventorySummaries,
  throwAmazonSpApiIfFailed,
} = require('./amazonSpApiService')
const { normalizeSku } = require('../utils/normalizeSku')

const REPORT_POLL_INTERVAL_MS = 10_000
const REPORT_TIMEOUT_MS = 8 * 60_000
const LISTINGS_REPORT_TYPE = process.env.AMAZON_LISTINGS_REPORT_TYPE || 'GET_MERCHANT_LISTINGS_DATA'
const INACTIVE_LISTINGS_REPORT_TYPE =
  process.env.AMAZON_INACTIVE_LISTINGS_REPORT_TYPE || 'GET_MERCHANT_LISTINGS_INACTIVE_DATA'
/** Manage FBA Inventory report — includes Seller Flex / FBA Onsite on-hand (afn-warehouse-quantity). */
const AFN_INVENTORY_REPORT_TYPE =
  process.env.AMAZON_AFN_INVENTORY_REPORT_TYPE || 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function marketplaceLabel(key) {
  return String(key).toLowerCase() === 'ksa' ? 'KSA' : 'UAE'
}

function defaultCurrency(key) {
  return String(key).toLowerCase() === 'ksa' ? 'SAR' : 'AED'
}

function parseDelimitedReport(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headers = splitReportLine(lines[0], delimiter).map((h) => clean(h).toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = splitReportLine(line, delimiter)
    const row = {}
    headers.forEach((header, idx) => {
      row[header] = cells[idx] != null ? cells[idx] : ''
    })
    return row
  })
}

function splitReportLine(line, delimiter) {
  if (delimiter === '\t') return String(line).split('\t')
  const out = []
  let cur = ''
  let quoted = false
  const raw = String(line)
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '"') {
      if (quoted && raw[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function first(row, keys) {
  for (const key of keys) {
    const value = row[String(key).toLowerCase()]
    if (value != null && clean(value)) return clean(value)
  }
  return ''
}

function isActiveListingRow(row) {
  const status = first(row, ['status', 'item-is-marketplace', 'listing-status', 'open-date'])
  const lowerStatus = status.toLowerCase()
  const inactiveHints = [
    'inactive',
    'closed',
    'deleted',
    'blocked',
    'suppressed',
    'missing',
    'removed',
    'detail page removed',
  ]
  const raw = Object.values(row || {}).join(' ').toLowerCase()
  if (inactiveHints.some((hint) => raw.includes(hint))) return false
  if (lowerStatus && ['n', 'no', 'false', '0'].includes(lowerStatus)) return false
  return true
}

/** Seller Central: Inactive → Out of stock (excludes blocked, suppressed, closed). */
function classifyInactiveListingRow(row) {
  const raw = Object.values(row || {}).join(' ').toLowerCase()
  const status = first(row, ['status', 'listing-status', 'item-status', 'item-is-marketplace']).toLowerCase()
  const qtyRaw = first(row, ['quantity', 'afn-warehouse-quantity', 'warehouse-quantity', 'pending-quantity'])
  const qty = toNumber(qtyRaw, NaN)

  if (raw.includes('blocked')) return 'blocked'
  if (raw.includes('suppressed') || raw.includes('search suppressed')) return 'suppressed'
  if (raw.includes('detail page removed')) return 'detail_page_removed'
  if (raw.includes('closed') || raw.includes('ended') || raw.includes('deleted')) return 'closed'
  if (status.includes('out of stock') || status.includes('out-of-stock')) return 'out_of_stock'
  if (Number.isFinite(qty) && qty <= 0) return 'out_of_stock'
  return 'other_inactive'
}

function mapListingRow(row, marketplaceKey, marketplaceId) {
  const sellerSku = first(row, ['seller-sku', 'seller sku', 'sku', 'SellerSKU'])
  if (!sellerSku) return null
  if (!isActiveListingRow(row)) return null
  const amount = first(row, ['price', 'standard-price', 'your-price', 'listing-price'])
  const quantity = first(row, ['quantity', 'fulfillment-channel'])
  const image = first(row, ['image-url', 'main-image-url', 'image'])
  return {
    marketplaceKey,
    marketplace: marketplaceLabel(marketplaceKey),
    marketplaceId,
    sellerSku,
    normalizedSku: normalizeSku(sellerSku),
    asin: first(row, ['asin1', 'asin', 'ASIN']),
    title: first(row, ['item-name', 'title', 'product-name']),
    image,
    listingStatus: 'ACTIVE',
    fulfillmentChannel: String(quantity).toLowerCase().includes('amazon') ? 'AMAZON' : 'AMAZON',
    price: {
      amount: amount ? toNumber(amount, null) : null,
      currencyCode: defaultCurrency(marketplaceKey),
    },
  }
}

function mapInactiveListingRow(row, marketplaceKey, marketplaceId) {
  const sellerSku = first(row, ['seller-sku', 'seller sku', 'sku', 'SellerSKU'])
  if (!sellerSku) return null
  const inactiveClass = classifyInactiveListingRow(row)
  if (inactiveClass !== 'out_of_stock') return null
  const amount = first(row, ['price', 'standard-price', 'your-price', 'listing-price'])
  const quantity = first(row, ['quantity', 'fulfillment-channel'])
  const image = first(row, ['image-url', 'main-image-url', 'image'])
  return {
    marketplaceKey,
    marketplace: marketplaceLabel(marketplaceKey),
    marketplaceId,
    sellerSku,
    normalizedSku: normalizeSku(sellerSku),
    asin: first(row, ['asin1', 'asin', 'ASIN']),
    title: first(row, ['item-name', 'title', 'product-name']),
    image,
    listingStatus: 'INACTIVE_OOS',
    inactiveClass,
    fulfillmentChannel: String(quantity).toLowerCase().includes('amazon') ? 'AMAZON' : 'AMAZON',
    price: {
      amount: amount ? toNumber(amount, null) : null,
      currencyCode: defaultCurrency(marketplaceKey),
    },
  }
}

function dedupeListings(listings) {
  const deduped = []
  const seen = new Set()
  for (const row of listings) {
    const key = `${row.marketplaceKey}:${row.normalizedSku}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  return deduped
}

async function downloadAmazonMerchantListingsReport({ marketplaceKey, marketplaceId, reportType, progressLabel, progress }) {
  progress?.({ step: `Requesting Amazon ${marketplaceLabel(marketplaceKey)} ${progressLabel}`, current: 0, total: 0 })
  const create = await createAmazonListingsReport({
    marketplaceKey,
    marketplaceId,
    reportType,
  })
  throwAmazonSpApiIfFailed(create, 'createListingsReport', marketplaceKey)
  const reportId = create.data?.reportId
  if (!reportId) {
    const err = new Error('Amazon did not return a listings report id')
    err.code = 'AMAZON_LISTINGS_REPORT_ID_MISSING'
    throw err
  }

  const started = Date.now()
  let report = null
  while (Date.now() - started < REPORT_TIMEOUT_MS) {
    await sleep(REPORT_POLL_INTERVAL_MS)
    const status = await getAmazonReport(reportId, { marketplaceKey })
    throwAmazonSpApiIfFailed(status, 'getListingsReport', marketplaceKey)
    report = status.data
    const processingStatus = String(report?.processingStatus || '').toUpperCase()
    progress?.({
      step: `Waiting for ${progressLabel} (${processingStatus || 'PENDING'})`,
      current: 0,
      total: 0,
    })
    if (processingStatus === 'DONE') break
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      const err = new Error(`Amazon listings report ${processingStatus.toLowerCase()}`)
      err.code = 'AMAZON_LISTINGS_REPORT_FAILED'
      throw err
    }
  }
  if (!report || String(report.processingStatus || '').toUpperCase() !== 'DONE') {
    const err = new Error('Amazon listings report timed out')
    err.code = 'AMAZON_LISTINGS_REPORT_TIMEOUT'
    throw err
  }
  const reportDocumentId = report.reportDocumentId
  if (!reportDocumentId) {
    const err = new Error('Amazon listings report document id missing')
    err.code = 'AMAZON_LISTINGS_REPORT_DOCUMENT_MISSING'
    throw err
  }
  const doc = await getAmazonReportDocument(reportDocumentId, { marketplaceKey })
  throwAmazonSpApiIfFailed(doc, 'getListingsReportDocument', marketplaceKey)
  const download = await downloadAmazonReportDocument(doc.data?.url, {
    marketplaceKey,
    compressionAlgorithm: doc.data?.compressionAlgorithm,
  })
  if (download.status < 200 || download.status >= 300) {
    throwAmazonSpApiIfFailed(download, 'downloadListingsReportDocument', marketplaceKey)
  }
  return parseDelimitedReport(download.data)
}

async function fetchActiveAmazonListings({ marketplaceKey, progress }) {
  const marketplaceId = marketplaceIdForKey(marketplaceKey)
  const rawRows = await downloadAmazonMerchantListingsReport({
    marketplaceKey,
    marketplaceId,
    reportType: LISTINGS_REPORT_TYPE,
    progressLabel: 'active listings report',
    progress,
  })
  const listings = dedupeListings(
    rawRows
      .map((row) => mapListingRow(row, marketplaceKey, marketplaceId))
      .filter((row) => row && row.normalizedSku)
  )
  return {
    listings,
    fetchedAt: new Date().toISOString(),
  }
}

/** Seller Central Manage Inventory → Inactive → Out of stock (GET_MERCHANT_LISTINGS_INACTIVE_DATA). */
async function fetchInactiveAmazonListings({ marketplaceKey, progress }) {
  const marketplaceId = marketplaceIdForKey(marketplaceKey)
  const rawRows = await downloadAmazonMerchantListingsReport({
    marketplaceKey,
    marketplaceId,
    reportType: INACTIVE_LISTINGS_REPORT_TYPE,
    progressLabel: 'inactive listings report (Seller Central OOS)',
    progress,
  })
  const listings = dedupeListings(
    rawRows
      .map((row) => mapInactiveListingRow(row, marketplaceKey, marketplaceId))
      .filter((row) => row && row.normalizedSku)
  )
  return {
    listings,
    fetchedAt: new Date().toISOString(),
  }
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function inventorySummaryList(data) {
  const payload = data?.payload || data
  const list = payload?.inventorySummaries || data?.inventorySummaries || []
  return Array.isArray(list) ? list : []
}

function nextTokenFromInventory(data) {
  const payload = data?.payload || data
  return payload?.pagination?.nextToken || payload?.nextToken || data?.nextToken || null
}

/** Seller Central "On-hand (FBA)" aligns with totalQuantity; buyable units are fulfillableQuantity. */
function amazonOnHandQty(inv) {
  if (!inv) return 0
  const total = toNumber(inv.totalQty, NaN)
  const fulfillable = toNumber(inv.availableQty, 0)
  if (Number.isFinite(total) && total > 0) return total
  return fulfillable
}

function isAmazonFbaOutOfStock(inv) {
  if (!inv) return true
  return amazonOnHandQty(inv) <= 0 && toNumber(inv.availableQty, 0) <= 0
}

function mapAfnManageInventoryRow(row) {
  const sellerSku = first(row, ['sku', 'seller-sku', 'seller sku', 'SellerSKU'])
  if (!sellerSku) return null
  const afnWarehouse = toNumber(
    first(row, ['afn-warehouse-quantity', 'afn-total-quantity', 'afn-total-supply-quantity']),
    NaN
  )
  const afnFulfillable = toNumber(first(row, ['afn-fulfillable-quantity']), 0)
  const afnReserved = toNumber(first(row, ['afn-reserved-quantity']), 0)
  const onHand = Number.isFinite(afnWarehouse) && afnWarehouse >= 0 ? afnWarehouse : afnFulfillable + afnReserved
  return {
    sellerSku,
    availableQty: afnFulfillable,
    inboundQty: 0,
    reservedQty: afnReserved,
    unfulfillableQty: toNumber(first(row, ['afn-unsellable-quantity', 'afn-unfulfillable-quantity']), 0),
    totalQty: onHand,
    stockStatus: onHand > 0 || afnFulfillable > 0 ? 'In Stock' : 'Out of Stock',
    stockSource: 'afn_manage_inventory_report',
  }
}

/**
 * Seller Flex / FBA Onsite on-hand often appears in the AFN manage inventory report but not in
 * GET /fba/inventory/v1/summaries. Merge both sources and keep the higher quantities.
 */
function mergeAmazonInventoryRecords(fbaApiInv, afnReportInv) {
  const empty = {
    availableQty: 0,
    inboundQty: 0,
    reservedQty: 0,
    unfulfillableQty: 0,
    totalQty: 0,
    stockStatus: 'Out of Stock',
    stockSource: 'none',
  }
  const api = fbaApiInv || empty
  if (!afnReportInv) return { ...api, stockSource: api.stockSource || 'fba_api' }

  const apiOnHand = amazonOnHandQty(api)
  const apiFulfillable = toNumber(api.availableQty, 0)
  const reportOnHand = amazonOnHandQty(afnReportInv)
  const reportFulfillable = toNumber(afnReportInv.availableQty, 0)
  const onHand = Math.max(apiOnHand, reportOnHand)
  const fulfillable = Math.max(apiFulfillable, reportFulfillable)
  const stockStatus = onHand > 0 || fulfillable > 0 ? 'In Stock' : 'Out of Stock'
  const stockSource =
    reportOnHand > apiOnHand || (apiOnHand <= 0 && reportOnHand > 0)
      ? 'afn_manage_inventory_report'
      : api.stockSource || 'fba_api'

  return {
    availableQty: fulfillable,
    inboundQty: toNumber(api.inboundQty, 0),
    reservedQty: Math.max(toNumber(api.reservedQty, 0), toNumber(afnReportInv.reservedQty, 0)),
    unfulfillableQty: Math.max(
      toNumber(api.unfulfillableQty, 0),
      toNumber(afnReportInv.unfulfillableQty, 0)
    ),
    totalQty: onHand,
    stockStatus,
    stockSource,
  }
}

function mergeInventoryMaps(fbaApiMap, afnReportMap) {
  const keys = new Set([...fbaApiMap.keys(), ...afnReportMap.keys()])
  const merged = new Map()
  for (const key of keys) {
    merged.set(key, mergeAmazonInventoryRecords(fbaApiMap.get(key), afnReportMap.get(key)))
  }
  return merged
}

async function fetchAfnManageInventoryBySku({ marketplaceKey, progress }) {
  const marketplaceId = marketplaceIdForKey(marketplaceKey)
  const rawRows = await downloadAmazonMerchantListingsReport({
    marketplaceKey,
    marketplaceId,
    reportType: AFN_INVENTORY_REPORT_TYPE,
    progressLabel: 'AFN manage inventory report (Seller Flex on-hand)',
    progress,
  })
  const inventoryBySku = new Map()
  for (const row of rawRows) {
    const mapped = mapAfnManageInventoryRow(row)
    if (!mapped) continue
    const key = normalizeSku(mapped.sellerSku)
    if (key) inventoryBySku.set(key, mapped)
  }
  return {
    inventoryBySku,
    fetchedAt: new Date().toISOString(),
  }
}

function mapInventorySummary(row) {
  const details = row?.inventoryDetails || {}
  const reserved = details.reservedQuantity || {}
  const inbound =
    toNumber(details.inboundWorkingQuantity) +
    toNumber(details.inboundShippedQuantity) +
    toNumber(details.inboundReceivingQuantity)
  const reservedQty =
    toNumber(reserved.totalReservedQuantity) ||
    toNumber(details.reservedQuantity) ||
    toNumber(row.reservedQuantity)
  const totalFromApi = toNumber(row?.totalQuantity, NaN)
  const fulfillable = toNumber(details.fulfillableQuantity, 0)
  const unfulfillable = toNumber(details.unfulfillableQuantity)
  const onHand = Number.isFinite(totalFromApi)
    ? totalFromApi
    : fulfillable + inbound + reservedQty
  const stockStatus = onHand > 0 || fulfillable > 0 ? 'In Stock' : 'Out of Stock'
  return {
    sellerSku: clean(row?.sellerSku || row?.SellerSKU || row?.sku),
    availableQty: fulfillable,
    inboundQty: inbound,
    reservedQty,
    unfulfillableQty: unfulfillable,
    totalQty: onHand,
    stockStatus,
    stockSource: 'fba_api',
  }
}

async function fetchAmazonInventoryForListings({ marketplaceKey, marketplaceId, listings, progress }) {
  const skus = listings.map((row) => row.sellerSku).filter(Boolean)
  const fbaApiBySku = new Map()
  const batches = chunk(skus, 50)
  let current = 0
  for (const batch of batches) {
    current += batch.length
    progress?.({
      step: `Fetching Amazon ${marketplaceLabel(marketplaceKey)} FBA inventory API`,
      current,
      total: skus.length,
    })
    let nextToken = null
    do {
      const res = await getAmazonFbaInventorySummaries({
        marketplaceKey,
        marketplaceId,
        sellerSkus: batch,
        nextToken,
      })
      throwAmazonSpApiIfFailed(res, 'getFbaInventorySummaries', marketplaceKey)
      for (const summary of inventorySummaryList(res.data)) {
        const mapped = mapInventorySummary(summary)
        const key = normalizeSku(mapped.sellerSku)
        if (key) fbaApiBySku.set(key, mapped)
      }
      nextToken = nextTokenFromInventory(res.data)
    } while (nextToken)
  }

  let afnReportBySku = new Map()
  let afnReportWarning = null
  try {
    progress?.({
      step: `Fetching Amazon ${marketplaceLabel(marketplaceKey)} AFN manage inventory report`,
      current: skus.length,
      total: skus.length,
    })
    const afnResult = await fetchAfnManageInventoryBySku({ marketplaceKey, progress })
    afnReportBySku = afnResult.inventoryBySku
  } catch (e) {
    afnReportWarning =
      'AFN manage inventory report failed; Seller Flex on-hand may show as 0 until this report succeeds.'
    console.warn('[amazon-inventory] AFN manage inventory report failed:', marketplaceKey, e?.message || e)
  }

  return {
    inventoryBySku: mergeInventoryMaps(fbaApiBySku, afnReportBySku),
    fetchedAt: new Date().toISOString(),
    afnReportWarning,
  }
}

function normalizeMarketplaceKey(raw) {
  const mk = String(raw || '').trim().toLowerCase()
  if (mk === 'ksa') return 'ksa'
  if (mk === 'uae') return 'uae'
  return null
}

function buildOutOfStockRow(listing, inv, marketplaceId, mk) {
  const onHand = amazonOnHandQty(inv)
  const fulfillable = inv ? toNumber(inv.availableQty) : 0
  return {
    marketplaceKey: mk,
    marketplace: marketplaceLabel(mk),
    marketplaceId,
    amazonSku: listing.sellerSku,
    normalizedSku: listing.normalizedSku,
    title: listing.title,
    asin: listing.asin,
    amazonCurrentQty: onHand,
    amazonFulfillableQty: fulfillable,
    amazonStockStatus: inv?.stockStatus || 'Out of Stock',
    fulfillmentChannel: listing.fulfillmentChannel,
    image: listing.image,
  }
}

function filterOutOfStockRows(listings, inventoryBySku, marketplaceId, mk) {
  const outOfStock = []
  for (const listing of listings) {
    const inv = inventoryBySku.get(listing.normalizedSku)
    if (!isAmazonFbaOutOfStock(inv)) continue
    outOfStock.push(buildOutOfStockRow(listing, inv, marketplaceId, mk))
  }
  return outOfStock
}

function listingFromCachedComparisonRow(row, mk, marketplaceId) {
  return {
    marketplaceKey: mk,
    marketplace: row.marketplace || marketplaceLabel(mk),
    marketplaceId,
    sellerSku: row.sellerSku,
    normalizedSku: row.normalizedSku,
    title: row.title || '',
    asin: row.asin || '',
    fulfillmentChannel: row.fulfillmentChannel || '',
    image: row.image || '',
    listingStatus: row.listingStatus || 'ACTIVE',
  }
}

/**
 * Fast path: re-query FBA inventory only for SKUs already in amazon_zoho_stock_comparison cache.
 * Typical runtime: seconds to ~2 min (batched by 50 SKUs), not a full listings report.
 */
async function fetchOutOfStockFromCachedComparisonRows({ marketplaceKey, cachedRows, progress }) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    throw err
  }
  const rows = Array.isArray(cachedRows) ? cachedRows : []
  if (rows.length === 0) {
    const err = new Error(
      'No cached Amazon listings for this marketplace. Run Amazon + Zoho Stock → Refresh first, or use a full catalog scan.'
    )
    err.code = 'AMAZON_OOS_CACHE_EMPTY'
    throw err
  }
  const marketplaceId = marketplaceIdForKey(mk)
  const listings = rows.map((row) => listingFromCachedComparisonRow(row, mk, marketplaceId))
  progress?.({
    step: `Refreshing Amazon FBA inventory for ${listings.length} cached SKU(s)`,
    current: 0,
    total: listings.length,
  })
  const invResult = await fetchAmazonInventoryForListings({
    marketplaceKey: mk,
    marketplaceId,
    listings,
    progress,
  })
  const outOfStock = filterOutOfStockRows(listings, invResult.inventoryBySku, marketplaceId, mk)
  return {
    marketplace: marketplaceLabel(mk),
    marketplaceKey: mk,
    rows: outOfStock,
    totalListings: listings.length,
    scannedSkuCount: listings.length,
    fetchMode: 'fast',
    fetchedAt: invResult.fetchedAt,
  }
}

function inventorySummaryToOosRow(row, mk, marketplaceId) {
  const mapped = mapInventorySummary(row)
  const sellerSku = mapped.sellerSku
  if (!sellerSku) return null
  if (!isAmazonFbaOutOfStock(mapped)) return null
  const normalizedSku = normalizeSku(sellerSku)
  return {
    marketplaceKey: mk,
    marketplace: marketplaceLabel(mk),
    marketplaceId,
    amazonSku: sellerSku,
    normalizedSku,
    title: clean(row?.productName || row?.itemName || ''),
    asin: clean(row?.asin || ''),
    amazonCurrentQty: amazonOnHandQty(mapped),
    amazonFulfillableQty: toNumber(mapped.availableQty, 0),
    amazonStockStatus: mapped.stockStatus || 'Out of Stock',
    fulfillmentChannel: 'AMAZON',
    image: '',
  }
}

/**
 * Discover OOS SKUs via Amazon's only practical bulk inventory API:
 * GET /fba/inventory/v1/summaries (paginated). Amazon does not offer a server-side
 * "out of stock only" filter — we page all FBA summaries and keep fulfillableQuantity === 0.
 * No listings report (avoids multi-minute report generation).
 */
async function fetchOutOfStockViaFbaInventorySummaries({ marketplaceKey, progress }) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    throw err
  }
  const marketplaceId = marketplaceIdForKey(mk)
  const outOfStock = []
  const seen = new Set()
  let nextToken = null
  let page = 0
  let scanned = 0
  const startedAt = Date.now()
  do {
    page += 1
    progress?.({
      step: `Reading FBA inventory from Amazon (page ${page})`,
      current: scanned,
      total: 0,
    })
    const res = await getAmazonFbaInventorySummaries({
      marketplaceKey: mk,
      marketplaceId,
      nextToken,
    })
    throwAmazonSpApiIfFailed(res, 'getFbaInventorySummaries', marketplaceKey)
    for (const summary of inventorySummaryList(res.data)) {
      scanned += 1
      const row = inventorySummaryToOosRow(summary, mk, marketplaceId)
      if (!row || seen.has(row.normalizedSku)) continue
      seen.add(row.normalizedSku)
      outOfStock.push(row)
    }
    nextToken = nextTokenFromInventory(res.data)
    progress?.({
      step: `FBA inventory page ${page}: ${outOfStock.length} out of stock (${scanned} SKUs scanned)`,
      current: scanned,
      total: 0,
    })
  } while (nextToken)

  return {
    marketplace: marketplaceLabel(mk),
    marketplaceKey: mk,
    rows: outOfStock,
    totalListings: scanned,
    scannedSkuCount: scanned,
    fetchMode: 'fba',
    fetchedAt: new Date(startedAt).toISOString(),
  }
}

/** Legacy: listings report + FBA (slow). Prefer fetchOutOfStockViaFbaInventorySummaries. */
async function fetchOutOfStockAmazonSkus({ marketplaceKey, progress }) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  if (!mk) {
    const err = new Error('Invalid marketplace. Use UAE or KSA.')
    err.code = 'INVALID_MARKETPLACE'
    throw err
  }
  const listingResult = await fetchActiveAmazonListings({ marketplaceKey: mk, progress })
  const marketplaceId = marketplaceIdForKey(mk)
  const invResult = await fetchAmazonInventoryForListings({
    marketplaceKey: mk,
    marketplaceId,
    listings: listingResult.listings,
    progress,
  })
  const outOfStock = filterOutOfStockRows(
    listingResult.listings,
    invResult.inventoryBySku,
    marketplaceId,
    mk
  )
  return {
    marketplace: marketplaceLabel(mk),
    marketplaceKey: mk,
    rows: outOfStock,
    totalListings: listingResult.listings.length,
    scannedSkuCount: listingResult.listings.length,
    fetchMode: 'listings-report',
    fetchedAt: new Date(
      Math.max(new Date(listingResult.fetchedAt).getTime(), new Date(invResult.fetchedAt).getTime())
    ).toISOString(),
  }
}

module.exports = {
  marketplaceLabel,
  parseDelimitedReport,
  mapListingRow,
  mapInactiveListingRow,
  classifyInactiveListingRow,
  mapInventorySummary,
  amazonOnHandQty,
  isAmazonFbaOutOfStock,
  mergeAmazonInventoryRecords,
  mapAfnManageInventoryRow,
  fetchActiveAmazonListings,
  fetchInactiveAmazonListings,
  fetchAmazonInventoryForListings,
  fetchOutOfStockAmazonSkus,
  fetchOutOfStockViaFbaInventorySummaries,
  fetchOutOfStockFromCachedComparisonRows,
  normalizeMarketplaceKey,
}
