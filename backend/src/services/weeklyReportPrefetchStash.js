/**
 * In-memory stash of the raw items + transaction payloads from the last weekly report fetch,
 * keyed identically to weeklyReportCache.makeKey. Family-details can peek this bundle and pass
 * `prefetched` into buildFamilyWarehouseMatrixForGroupMembers so matrix.meta.usedPrefetch is true
 * without a second GET /items or invoice sweep (when the user opened the report first).
 */

const { makeKey } = require('./weeklyReportCache')

/** Align with weekly report result cache default (15m); independent short TTL if env is 0. */
const TTL_MS = 15 * 60 * 1000

/** @type {Map<string, { bundle: object, expiresAt: number }>} */
const stash = new Map()

/**
 * @param {string} reportGroup
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string|null} warehouseId
 * @param {string|null} excludeWarehouseId
 * @param {{ raw: unknown, salesR: object, purchR: object, vcR: object }} bundle
 */
function stashWeeklyReportPrefetchBundle(reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId, bundle) {
  const key = makeKey(reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId)
  stash.set(key, { bundle, expiresAt: Date.now() + TTL_MS })
}

/**
 * @returns {{ raw: unknown, salesR: object, purchR: object, vcR: object } | null}
 */
function peekWeeklyReportPrefetchBundle(reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId) {
  const key = makeKey(reportGroup, fromDate, toDate, warehouseId, excludeWarehouseId)
  const e = stash.get(key)
  if (!e || Date.now() > e.expiresAt) {
    stash.delete(key)
    return null
  }
  return e.bundle
}

module.exports = {
  stashWeeklyReportPrefetchBundle,
  peekWeeklyReportPrefetchBundle,
}
