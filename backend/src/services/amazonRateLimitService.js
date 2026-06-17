/**
 * Amazon SP-API guardrails: spacing, sync cooldowns, API call audit (no secrets).
 */

const { query } = require('../db')
const cacheStore = require('./amazonOrdersCacheStore')
const {
  GET_ORDERS_MIN_INTERVAL_MS,
  GET_ORDER_ITEMS_MIN_INTERVAL_MS,
  GET_MARKETPLACE_PARTICIPATIONS_MIN_INTERVAL_MS,
  CATALOG_SEARCH_MIN_INTERVAL_MS,
  FBA_INVENTORY_MIN_INTERVAL_MS,
  REPORTS_MIN_INTERVAL_MS,
  MANUAL_SYNC_COOLDOWN_MINUTES,
} = require('../config/amazonSpApiGuardrails')

const GET_ORDERS_MIN_MS = GET_ORDERS_MIN_INTERVAL_MS
const GET_MARKETPLACES_MIN_MS = GET_MARKETPLACE_PARTICIPATIONS_MIN_INTERVAL_MS
const GET_ORDER_ITEMS_MIN_MS = GET_ORDER_ITEMS_MIN_INTERVAL_MS
const GET_CATALOG_MIN_MS = CATALOG_SEARCH_MIN_INTERVAL_MS
const GET_FBA_INVENTORY_MIN_MS = FBA_INVENTORY_MIN_INTERVAL_MS
const REPORTS_MIN_MS = REPORTS_MIN_INTERVAL_MS

const DEFAULT_SYNC_COOLDOWN_MIN = MANUAL_SYNC_COOLDOWN_MINUTES

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeMk(marketplaceKey) {
  return String(marketplaceKey || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
}

async function maxCalledAtForOperation(operation, marketplaceKey) {
  if (operation === 'getOrderItems') {
    const r = await query(
      `SELECT MAX(called_at) AS t FROM amazon_api_call_log WHERE operation = 'getOrderItems'`
    )
    return r.rows[0]?.t ? new Date(r.rows[0].t).getTime() : 0
  }
  const mk = normalizeMk(marketplaceKey)
  const r = await query(
    `SELECT MAX(called_at) AS t FROM amazon_api_call_log WHERE operation = $1 AND marketplace_key = $2`,
    [operation, mk]
  )
  return r.rows[0]?.t ? new Date(r.rows[0].t).getTime() : 0
}

function minSpacingMs(operation) {
  if (operation === 'getOrders') return GET_ORDERS_MIN_MS
  if (operation === 'getMarketplaceParticipations') return GET_MARKETPLACES_MIN_MS
  if (operation === 'getOrderItems') return GET_ORDER_ITEMS_MIN_MS
  if (operation === 'searchCatalogItems') return GET_CATALOG_MIN_MS
  if (operation === 'getFbaInventorySummaries') return GET_FBA_INVENTORY_MIN_MS
  if (
    operation === 'createListingsReport' ||
    operation === 'getListingsReport' ||
    operation === 'getListingsReportDocument'
  ) return REPORTS_MIN_MS
  return 1500
}

/**
 * Wait until minimum spacing since last recorded call for this operation.
 * @param {string} operation
 * @param {string} marketplaceKey
 */
async function waitForAmazonOperation(operation, marketplaceKey) {
  const minMs = minSpacingMs(operation)
  const last = await maxCalledAtForOperation(operation, marketplaceKey)
  if (!last) return
  const elapsed = Date.now() - last
  const need = minMs - elapsed
  if (need > 0) {
    await sleep(need)
  }
}

/**
 * @param {string} operation
 * @param {string} marketplaceKey
 * @param {{ statusCode?: number, rateLimitHeader?: string|null, success: boolean, safeError?: string|null, amazonRequestId?: string|null }} result
 */
async function recordAmazonApiCall(operation, marketplaceKey, result) {
  try {
    await cacheStore.appendApiCallLog({
      operation,
      marketplaceKey: normalizeMk(marketplaceKey),
      statusCode: result.statusCode,
      rateLimitHeader: result.rateLimitHeader,
      success: Boolean(result.success),
      safeError: result.safeError,
      amazonRequestId: result.amazonRequestId,
    })
  } catch (e) {
    console.warn('[amazon-rate] api call log failed:', e.message || e)
  }
}

/**
 * @param {string} syncType
 * @param {string} marketplaceKey
 * @param {number} [cooldownMinutes]
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
async function canStartSync(syncType, marketplaceKey, cooldownMinutes = DEFAULT_SYNC_COOLDOWN_MIN) {
  const mk = normalizeMk(marketplaceKey)
  await cacheStore.markStaleRunningSyncsFailed(mk, 45)

  const running = await cacheStore.findRecentRunningSync(mk, 40)
  if (running) {
    return {
      allowed: false,
      reason: 'Amazon sync skipped because another sync is already running for this marketplace.',
    }
  }

  const r = await query(
    `SELECT finished_at, status FROM amazon_sync_log
     WHERE marketplace_key = $1 AND sync_type = $2 AND finished_at IS NOT NULL
     ORDER BY finished_at DESC LIMIT 1`,
    [mk, syncType]
  )
  const row = r.rows[0]
  if (!row || !row.finished_at) return { allowed: true }

  const delta = Date.now() - new Date(row.finished_at).getTime()
  const coolMs = Math.max(1, parseInt(String(cooldownMinutes), 10) || DEFAULT_SYNC_COOLDOWN_MIN) * 60_000
  if (delta < coolMs) {
    return {
      allowed: false,
      reason:
        'Amazon sync skipped because a recent sync already ran. Try again later.',
    }
  }
  return { allowed: true }
}

async function getLastSuccessfulSync(syncType, marketplaceKey) {
  return cacheStore.getLastSuccessfulSyncRow(normalizeMk(marketplaceKey), syncType)
}

module.exports = {
  waitForAmazonOperation,
  recordAmazonApiCall,
  canStartSync,
  getLastSuccessfulSync,
  normalizeMk,
  DEFAULT_SYNC_COOLDOWN_MIN,
}
