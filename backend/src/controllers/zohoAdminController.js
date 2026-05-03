/**
 * Admin-only Zoho guard rails: usage, cache, manual item sync.
 */

const zohoApiStore = require('../services/zohoApiStore')
const {
  getZohoGuardStatus,
  getDailySuccessCount,
  invalidateDailyCountCache,
} = require('../services/zohoApiClient')
const {
  fetchAllItemsRaw,
  clearItemsCache,
  clearWarehouseItemsCaches,
} = require('../integrations/zoho/zohoAdapter')

async function getUsageToday(_req, res) {
  try {
    const summary = await zohoApiStore.usageSummaryTodayUtc()
    const successfulCallsToday = await zohoApiStore.countSuccessfulCallsTodayUtc()
    const guard = getZohoGuardStatus()
    res.json({
      utcDate: new Date().toISOString().slice(0, 10),
      summary,
      successfulCallsToday,
      guard,
      minuteApproxFromProcess: guard.limits.minuteWindowSize,
    })
  } catch (err) {
    console.error('[zoho-admin] getUsageToday:', err)
    res.status(500).json({ error: err.message || 'Failed to load usage' })
  }
}

async function getUsageSummary(_req, res) {
  try {
    const summary = await zohoApiStore.usageSummaryTodayUtc()
    const byEndpoint = await zohoApiStore.usageByEndpointToday(80)
    const guard = getZohoGuardStatus()
    res.json({
      summary,
      byEndpoint,
      guard,
      successfulCallsToday: await getDailySuccessCount(),
    })
  } catch (err) {
    console.error('[zoho-admin] getUsageSummary:', err)
    res.status(500).json({ error: err.message || 'Failed to load summary' })
  }
}

async function getCacheStats(_req, res) {
  try {
    const stats = await zohoApiStore.cacheStats()
    res.json({ stats, cacheEnabled: process.env.ZOHO_CACHE_ENABLED !== 'false' })
  } catch (err) {
    console.error('[zoho-admin] getCacheStats:', err)
    res.status(500).json({ error: err.message || 'Failed cache stats' })
  }
}

async function postCacheClear(_req, res) {
  try {
    await zohoApiStore.deleteAllCache()
    clearItemsCache()
    clearWarehouseItemsCaches()
    invalidateDailyCountCache()
    res.json({ ok: true, message: 'PostgreSQL Zoho cache cleared; in-memory item caches cleared.' })
  } catch (err) {
    console.error('[zoho-admin] postCacheClear:', err)
    res.status(500).json({ error: err.message || 'Failed to clear cache' })
  }
}

const ITEM_SYNC_JOB = 'items_full_sync'
const LOCK_MS = 35 * 60 * 1000

async function postManualItemsSync(_req, res) {
  const acquired = await zohoApiStore.acquireSyncLock(ITEM_SYNC_JOB, LOCK_MS)
  if (!acquired) {
    const lock = await zohoApiStore.getSyncLock(ITEM_SYNC_JOB)
    return res.status(409).json({
      error: 'Another item sync is already running.',
      code: 'ZOHO_SYNC_LOCK',
      lock,
    })
  }
  try {
    clearItemsCache()
    clearWarehouseItemsCaches()
    await zohoApiStore.deleteCacheByPrefix('zoho:items_list:')
    await zohoApiStore.deleteCacheByPrefix('zoho:/inventory/v1/items')
    await zohoApiStore.deleteCacheByPrefix('zoho:list:/inventory/v1/items')

    const items = await fetchAllItemsRaw()
    invalidateDailyCountCache()
    res.json({
      ok: true,
      itemCount: Array.isArray(items) ? items.length : 0,
      message: 'Manual items sync completed.',
    })
  } catch (err) {
    console.error('[zoho-admin] postManualItemsSync:', err)
    res.status(502).json({
      error: err.message || 'Sync failed',
      code: err.code || 'ZOHO_SYNC_FAILED',
    })
  } finally {
    await zohoApiStore.releaseSyncLock(ITEM_SYNC_JOB).catch(() => {})
  }
}

module.exports = {
  getUsageToday,
  getUsageSummary,
  getCacheStats,
  postCacheClear,
  postManualItemsSync,
}
