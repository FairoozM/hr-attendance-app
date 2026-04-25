/**
 * Backend in-flight deduplication + short TTL result cache for weekly reports.
 *
 * Two layers:
 *  1. In-flight dedup  — if the same (group, fromDate, toDate) is already running,
 *     subsequent callers share the same Promise instead of starting a new Zoho fetch.
 *  2. TTL result cache — once a request completes, its result is kept for
 *     WEEKLY_REPORT_CACHE_TTL_MS (default 2 minutes) so repeated calls within that
 *     window are answered instantly without touching Zoho at all.
 *
 * Only errors are NOT cached. A failed request clears itself from inFlight and
 * lets the next caller retry.
 *
 * Cache key  : "v<repSelVer>::<group>::<fromDate>::<toDate>..." (busts on representative rule changes)
 * Disable    : set WEEKLY_REPORT_CACHE_TTL_MS=0
 */

const { REPRESENTATIVE_IMAGE_SELECTION_VERSION } = require('./zohoRepresentativeItem')
const CACHE_TTL_MS =
  process.env.WEEKLY_REPORT_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.WEEKLY_REPORT_CACHE_TTL_MS, 10) || 0)
    : 2 * 60 * 1000 // 2 minutes

/** @type {Map<string, Promise<any>>} */
const inFlight = new Map()

/** @type {Map<string, { result: any, expiresAt: number }>} */
const resultCache = new Map()

function makeKey(group, fromDate, toDate, warehouseId = null) {
  const v = `v${String(REPRESENTATIVE_IMAGE_SELECTION_VERSION || 0)}`
  return warehouseId
    ? `${v}::${group}::${fromDate}::${toDate}::wh:${warehouseId}`
    : `${v}::${group}::${fromDate}::${toDate}`
}

/**
 * Wrap a report-generating async function with caching and in-flight dedup.
 *
 * @param {string} group
 * @param {string} fromDate
 * @param {string} toDate
 * @param {() => Promise<any>} generateFn - called at most once per cache miss
 * @param {string|null} [warehouseId]
 * @returns {Promise<any>}
 */
async function getCachedReport(group, fromDate, toDate, generateFn, warehouseId = null) {
  const key = makeKey(group, fromDate, toDate, warehouseId)
  const now = Date.now()

  // 1. Warm cache hit
  const cached = resultCache.get(key)
  if (cached && now < cached.expiresAt) {
    console.log(`[weekly-report] cache hit key=${key}`)
    return cached.result
  }

  // 2. In-flight dedup: join an already-running Promise for the same key
  if (inFlight.has(key)) {
    console.log(`[weekly-report] awaiting in-flight key=${key}`)
    return inFlight.get(key)
  }

  // 3. Start a new fetch
  console.log(`[weekly-report] start key=${key}`)
  const t0 = Date.now()

  const promise = generateFn()
    .then((result) => {
      if (CACHE_TTL_MS > 0) {
        resultCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
      }
      console.log(`[weekly-report] complete key=${key} duration=${Date.now() - t0}ms`)
      return result
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  return promise
}

/**
 * Manually evict a specific key or the entire cache.
 * @param {string} [group]
 * @param {string} [fromDate]
 * @param {string} [toDate]
 */
function clearReportCache(group, fromDate, toDate, warehouseId = null) {
  if (group && fromDate && toDate) {
    resultCache.delete(makeKey(group, fromDate, toDate, warehouseId))
  } else {
    resultCache.clear()
  }
}

module.exports = { getCachedReport, clearReportCache, makeKey }
