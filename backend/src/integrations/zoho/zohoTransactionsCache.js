/**
 * TTL + in-flight-dedup cache for Zoho Inventory transaction lists that have
 * no server-side date-filter support (bills) or are cheaper to cache unfiltered
 * (vendor credits).  Import here instead of zohoAdapter to avoid a circular
 * dependency (zohoAdapter → weeklyReportZohoTransactions → zohoAdapter).
 */

const { fetchListPaginated } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')

const CACHE_TTL_MS =
  process.env.ZOHO_ITEMS_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.ZOHO_ITEMS_CACHE_TTL_MS, 10) || 0)
    : 5 * 60 * 1000

// ─── Bills ────────────────────────────────────────────────────────────────────

/** @type {{ bills: object[], expiresAt: number } | null} */
let _billsCache = null
/** @type {Promise<object[]> | null} */
let _billsInFlight = null

async function fetchAllBillsRaw() {
  if (_billsCache && Date.now() < _billsCache.expiresAt) {
    if (process.env.DEBUG_ZOHO === '1') console.log('[zoho-bills] cache hit')
    return _billsCache.bills
  }
  if (_billsInFlight) return _billsInFlight
  _billsInFlight = fetchListPaginated(`${INVENTORY_V1}/bills`, 'bills', 50, null)
    .then(({ rows }) => {
      if (CACHE_TTL_MS > 0) {
        _billsCache = { bills: rows, expiresAt: Date.now() + CACHE_TTL_MS }
      }
      console.log(`[zoho-bills] cached ${rows.length} bills for ${Math.round(CACHE_TTL_MS / 1000)}s`)
      return rows
    })
    .finally(() => { _billsInFlight = null })
  return _billsInFlight
}

function clearBillsCache() { _billsCache = null }

// ─── Vendor credits ───────────────────────────────────────────────────────────

/** @type {{ vcs: object[], expiresAt: number } | null} */
let _vcCache = null
/** @type {Promise<object[]> | null} */
let _vcInFlight = null

async function fetchAllVendorCreditsRaw() {
  if (_vcCache && Date.now() < _vcCache.expiresAt) {
    if (process.env.DEBUG_ZOHO === '1') console.log('[zoho-vc] cache hit')
    return _vcCache.vcs
  }
  if (_vcInFlight) return _vcInFlight
  _vcInFlight = fetchListPaginated(`${INVENTORY_V1}/vendorcredits`, 'vendor_credits', 50, null)
    .then(({ rows }) => {
      if (CACHE_TTL_MS > 0) {
        _vcCache = { vcs: rows, expiresAt: Date.now() + CACHE_TTL_MS }
      }
      console.log(`[zoho-vc] cached ${rows.length} vendor credits for ${Math.round(CACHE_TTL_MS / 1000)}s`)
      return rows
    })
    .finally(() => { _vcInFlight = null })
  return _vcInFlight
}

function clearVendorCreditsCache() { _vcCache = null }

module.exports = {
  fetchAllBillsRaw,
  clearBillsCache,
  fetchAllVendorCreditsRaw,
  clearVendorCreditsCache,
}
