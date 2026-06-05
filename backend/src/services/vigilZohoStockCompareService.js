const {
  fetchAllLifeSmileWarehouseStock,
  lookupZohoEntry,
  normalizeSku,
} = require('./zohoLifeSmileWarehouseService')
const {
  expandMatchCandidates,
  vigilRowCodeSources,
} = require('../utils/purchasePlanningSkuMatcher')

const ZOHO_STOCK_CACHE_TTL_MS = 5 * 60 * 1000

/** @type {{ payload: object, expiresAt: number } | null} */
let _zohoStockCache = null

const VIGIL_ZOHO_FILTERS = new Set([
  'all',
  'matched',
  'unmatched',
  'vigilZero',
  'zohoZero',
  'bothZero',
])

function toQty(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function deriveStockAlert(vigilQty, zohoQty, zohoMatched) {
  if (!zohoMatched) return 'ZOHO_NOT_FOUND'
  if (vigilQty <= 0 && zohoQty <= 0) return 'BOTH_ZERO'
  if (vigilQty <= 0) return 'VIGIL_ZERO'
  if (zohoQty <= 0) return 'ZOHO_ZERO'
  return 'IN_STOCK'
}

function stockAlertLabel(alert) {
  switch (alert) {
    case 'VIGIL_ZERO':
      return 'Vigil zero'
    case 'ZOHO_ZERO':
      return 'Zoho zero'
    case 'BOTH_ZERO':
      return 'Both zero'
    case 'ZOHO_NOT_FOUND':
      return 'No Zoho match'
    default:
      return 'In stock'
  }
}

/**
 * @param {object} vigilRow
 * @param {Map<string, object>} zohoIndex
 */
function matchVigilRowToZoho(vigilRow, zohoIndex) {
  const sources = vigilRowCodeSources(vigilRow)
  for (const raw of sources) {
    for (const candidate of expandMatchCandidates(raw)) {
      const hit = lookupZohoEntry(zohoIndex, candidate.key)
      if (hit) {
        return {
          matched: true,
          matchType: candidate.matchKind,
          matchedKey: candidate.key,
          zoho: hit,
        }
      }
    }
  }
  return { matched: false, matchType: 'not_found', matchedKey: null, zoho: null }
}

function buildCompareRow(vigilRow, zohoIndex) {
  const vigilSku = String(vigilRow.itemCode || vigilRow.normalizedItemCode || '').trim()
  const vigilQty = toQty(vigilRow.availableStock)
  const match = matchVigilRowToZoho(vigilRow, zohoIndex)
  const zohoQty = match.matched ? toQty(match.zoho.availableQty) : null
  const stockAlert = deriveStockAlert(vigilQty, zohoQty ?? 0, match.matched)

  return {
    vigilSku,
    vigilItemName: String(vigilRow.itemName || '').trim(),
    vigilStockQty: vigilQty,
    zohoMatched: match.matched,
    zohoSku: match.matched ? match.zoho.sku || '' : null,
    zohoItemName: match.matched ? match.zoho.itemName || '' : null,
    zohoItemId: match.matched ? match.zoho.itemId || '' : null,
    zohoStockQty: match.matched ? zohoQty : null,
    zohoStockStatus: match.matched ? match.zoho.stockStatus || '' : null,
    matchType: match.matchType,
    matchedKey: match.matchedKey,
    stockAlert,
    notes: buildCompareNotes({ vigilQty, zohoQty, zohoMatched: match.matched, stockAlert }),
  }
}

function buildCompareNotes({ vigilQty, zohoQty, zohoMatched, stockAlert }) {
  const parts = []
  if (!zohoMatched) {
    parts.push('Vigil SKU not found in Zoho Life Smile warehouse')
  }
  if (stockAlert === 'VIGIL_ZERO') {
    parts.push('Wholesale (Vigil) stock is zero — supplier may be out of stock')
  } else if (stockAlert === 'BOTH_ZERO') {
    parts.push('Both Vigil and Zoho Life Smile warehouse show zero')
  } else if (stockAlert === 'ZOHO_ZERO') {
    parts.push('Zoho Life Smile warehouse is zero but Vigil still shows stock')
  }
  if (zohoMatched && vigilQty > 0 && zohoQty != null && Math.abs(vigilQty - zohoQty) > 0) {
    parts.push(`Qty difference: Vigil ${vigilQty} vs Zoho ${zohoQty}`)
  }
  return parts.length ? parts.join(' · ') : 'Quantities aligned'
}

function computeCompareSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    totalVigilRows: list.length,
    matchedZoho: list.filter((r) => r.zohoMatched).length,
    unmatchedZoho: list.filter((r) => !r.zohoMatched).length,
    vigilZero: list.filter((r) => r.stockAlert === 'VIGIL_ZERO' || r.stockAlert === 'BOTH_ZERO').length,
    zohoZero: list.filter((r) => r.stockAlert === 'ZOHO_ZERO' || r.stockAlert === 'BOTH_ZERO').length,
    bothZero: list.filter((r) => r.stockAlert === 'BOTH_ZERO').length,
    inStock: list.filter((r) => r.stockAlert === 'IN_STOCK').length,
  }
}

function filterCompareRows(rows, options = {}) {
  const filter = VIGIL_ZOHO_FILTERS.has(String(options.filter || 'all'))
    ? String(options.filter || 'all')
    : 'all'
  const search = normalizeSku(options.search) || ''
  let filtered = Array.isArray(rows) ? rows.slice() : []

  if (filter === 'matched') filtered = filtered.filter((r) => r.zohoMatched)
  else if (filter === 'unmatched') filtered = filtered.filter((r) => !r.zohoMatched)
  else if (filter === 'vigilZero') {
    filtered = filtered.filter((r) => r.stockAlert === 'VIGIL_ZERO' || r.stockAlert === 'BOTH_ZERO')
  } else if (filter === 'zohoZero') {
    filtered = filtered.filter((r) => r.stockAlert === 'ZOHO_ZERO' || r.stockAlert === 'BOTH_ZERO')
  } else if (filter === 'bothZero') filtered = filtered.filter((r) => r.stockAlert === 'BOTH_ZERO')

  if (search) {
    filtered = filtered.filter((r) => {
      const keys = [
        normalizeSku(r.vigilSku),
        normalizeSku(r.vigilItemName),
        normalizeSku(r.zohoSku),
        normalizeSku(r.zohoItemName),
      ].filter(Boolean)
      return keys.some((key) => key.includes(search))
    })
  }

  return filtered
}

async function getLifeSmileWarehouseSnapshot({ forceRefresh = false } = {}) {
  if (!forceRefresh && _zohoStockCache && Date.now() < _zohoStockCache.expiresAt) {
    return _zohoStockCache.payload
  }
  const payload = await fetchAllLifeSmileWarehouseStock()
  _zohoStockCache = {
    payload,
    expiresAt: Date.now() + ZOHO_STOCK_CACHE_TTL_MS,
  }
  return payload
}

function clearVigilZohoStockCache() {
  _zohoStockCache = null
}

async function buildVigilZohoCompare({ vigilRows = [], filter = 'all', search = '', refresh = false } = {}) {
  if (!Array.isArray(vigilRows) || vigilRows.length === 0) {
    const err = new Error('Upload and confirm a Vigil stock file first.')
    err.code = 'VIGIL_ROWS_REQUIRED'
    throw err
  }

  const zohoSnapshot = await getLifeSmileWarehouseSnapshot({ forceRefresh: refresh })
  const allRows = vigilRows.map((row) => buildCompareRow(row, zohoSnapshot.index))
  const filteredRows = filterCompareRows(allRows, { filter, search })

  return {
    success: true,
    rows: filteredRows,
    summary: computeCompareSummary(allRows),
    meta: {
      generatedAt: new Date().toISOString(),
      vigilRowCount: vigilRows.length,
      zohoWarehouseName: zohoSnapshot.warehouse?.warehouseName || 'Life Smile Warehouse',
      zohoWarehouseId: zohoSnapshot.warehouse?.warehouseId || '',
      zohoItemCount: zohoSnapshot.itemCount,
      zohoFetchedAt: zohoSnapshot.fetchedAt,
      filteredCount: filteredRows.length,
      totalCount: allRows.length,
      fromCache: !refresh && _zohoStockCache && Date.now() <= _zohoStockCache.expiresAt,
    },
  }
}

module.exports = {
  VIGIL_ZOHO_FILTERS,
  deriveStockAlert,
  stockAlertLabel,
  matchVigilRowToZoho,
  buildCompareRow,
  computeCompareSummary,
  filterCompareRows,
  buildVigilZohoCompare,
  clearVigilZohoStockCache,
}
