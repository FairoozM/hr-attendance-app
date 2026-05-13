const {
  normalizeMarketplaceKey,
  suggestedClientHttpStatusForAmazonUpstream,
  amazonSpApiHttpErrorJson,
} = require('../services/amazonSpApiService')
const ordersSync = require('../services/amazonOrdersSyncService')
const cacheStore = require('../services/amazonOrdersCacheStore')
const { getAmazonOrdersDashboard } = require('../services/amazonOrdersDashboardService')
const { MANUAL_SYNC_COOLDOWN_MINUTES } = require('../config/amazonSpApiGuardrails')
const {
  listSkuImageOverridesForAdmin,
  upsertSkuImageOverride,
  normalizeMarketplaceKeyForOverride,
} = require('../services/amazonSkuImageOverrideStore')

function parseMetadataLastRequestIds(metadata) {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = metadata.lastAmazonRequestIds
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x).trim().slice(0, 128)).filter(Boolean)
}

function isAdminUser(req) {
  return Boolean(req.user && req.user.role === 'admin')
}

function parseQueryDate(v) {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function parseQueryInt(v, fallback) {
  const n = parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function isoOrNull(v) {
  if (v == null) return null
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

/** Truncate and redact obvious email-shaped tokens from sync error text (defense in depth). */
function toSafeSyncError(msg) {
  if (msg == null || typeof msg !== 'string') return null
  const t = msg.trim().slice(0, 1200)
  if (!t) return null
  return t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted]')
}

/**
 * GET /api/amazon/orders — cached orders only (no live Amazon).
 */
async function getCachedAmazonOrders(req, res) {
  try {
    const marketplaceKey = normalizeMarketplaceKey(req.query.marketplaceKey ?? req.query.marketplace)
    const createdAfter = parseQueryDate(req.query.createdAfter)
    const createdBefore = parseQueryDate(req.query.createdBefore)
    const limit = parseQueryInt(req.query.limit, 100)
    const offset = parseQueryInt(req.query.offset, 0)
    const rawImg = req.query.includeSkuImages
    const includeSkuImages =
      rawImg === undefined || rawImg === null || String(rawImg).trim() === ''
        ? true
        : !/^(0|false|no|off)$/i.test(String(rawImg).trim())

    const data = await ordersSync.getCachedAmazonOrders({
      marketplaceKey,
      createdAfter,
      createdBefore,
      limit,
      offset,
      includeSkuImages,
    })
    const lastSyncedAt = await cacheStore.getMaxLastSyncedAt(marketplaceKey)

    return res.json({
      success: true,
      data: {
        ...data,
        lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
      },
    })
  } catch (e) {
    console.error('[amazon orders cache]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to read cached Amazon orders',
      error: 'Unexpected server error',
    })
  }
}

/**
 * POST /api/amazon/orders/sync — admin or warehouse; guarded live sync.
 * Body `force: true` bypasses the manual sync cooldown only for **admin**; warehouse and others ignore `force`.
 */
async function postAmazonOrdersSync(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const marketplaceKey = normalizeMarketplaceKey(body.marketplaceKey ?? body.marketplace)
    const createdAfter = body.createdAfter != null ? new Date(String(body.createdAfter)) : null
    const createdBefore = body.createdBefore != null ? new Date(String(body.createdBefore)) : null
    if (createdAfter && Number.isNaN(createdAfter.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid createdAfter', error: 'Invalid date' })
    }
    if (createdBefore && Number.isNaN(createdBefore.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid createdBefore', error: 'Invalid date' })
    }
    const includeItems = body.includeItems !== false
    const isAdmin = Boolean(req.user && req.user.role === 'admin')
    /** Non-admins cannot bypass cooldown: `force` is honored only when `isAdmin`. */
    const force = Boolean(body.force) && isAdmin
    const forceAllowed = isAdmin

    const summary = await ordersSync.syncAmazonOrders({
      marketplaceKey,
      createdAfter: createdAfter && !Number.isNaN(createdAfter.getTime()) ? createdAfter : null,
      createdBefore: createdBefore && !Number.isNaN(createdBefore.getTime()) ? createdBefore : null,
      includeItems,
      force,
      forceAllowed,
    })

    const httpStatus = 200
    return res.status(httpStatus).json({ success: true, data: summary })
  } catch (e) {
    if (e?.code === 'AMAZON_SYNC_RANGE' || e?.code === 'AMAZON_SYNC_VALIDATION') {
      return res.status(400).json({
        success: false,
        message: 'Amazon sync rejected',
        error: e.message || 'Invalid request',
      })
    }
    if (e?.code === 'AMAZON_SYNC_FORBIDDEN') {
      return res.status(403).json({
        success: false,
        message: 'Amazon sync rejected',
        error: e.message || 'Forbidden',
      })
    }
    if (e?.code === 'AMAZON_SP_HTTP') {
      const sc = suggestedClientHttpStatusForAmazonUpstream(e.statusCode)
      const frag = amazonSpApiHttpErrorJson(e)
      if (frag) {
        return res.status(sc).json({ ...frag, message: 'Amazon sync failed' })
      }
    }
    console.error('[amazon orders sync]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Amazon sync failed',
      error: 'Unexpected server error',
      ...(e && e.amazonRequestId ? { amazonRequestId: String(e.amazonRequestId).slice(0, 128) } : {}),
      ...(e && Number.isFinite(Number(e.statusCode)) ? { statusCode: Number(e.statusCode) } : {}),
    })
  }
}

/**
 * GET /api/amazon/sync/status
 */
async function getAmazonSyncStatus(req, res) {
  try {
    const mk = req.query.marketplaceKey ?? req.query.marketplace
    const keys = mk ? [normalizeMarketplaceKey(mk)] : ['uae', 'ksa']
    const out = {}
    for (const marketplaceKey of keys) {
      const last = await cacheStore.getLastSyncRow(marketplaceKey, 'orders')
      const lastOk = await cacheStore.getLastSuccessfulSyncRow(marketplaceKey, 'orders')
      const recent = await cacheStore.selectRecentSyncLogs(marketplaceKey, 8)
      out[marketplaceKey] = {
        lastSync: last
          ? {
              id: String(last.id),
              syncType: last.sync_type,
              status: last.status,
              startedAt: last.started_at,
              finishedAt: last.finished_at,
              createdAfter: isoOrNull(last.created_after),
              createdBefore: isoOrNull(last.created_before),
              ordersFetched: last.orders_fetched,
              orderItemsFetched: last.order_items_fetched,
              apiCallsMade: last.api_calls_made,
              errorMessage: last.error_message || null,
              ...(isAdminUser(req)
                ? { lastAmazonRequestIds: parseMetadataLastRequestIds(last.metadata) }
                : {}),
            }
          : null,
        lastSuccess: lastOk
          ? {
              finishedAt: lastOk.finished_at,
              ordersFetched: lastOk.orders_fetched,
              orderItemsFetched: lastOk.order_items_fetched,
              apiCallsMade: lastOk.api_calls_made,
            }
          : null,
        recent: recent.map((r) => {
          const base = {
            id: String(r.id),
            syncType: r.sync_type,
            status: r.status,
            startedAt: r.started_at,
            finishedAt: r.finished_at,
            createdAfter: isoOrNull(r.created_after),
            createdBefore: isoOrNull(r.created_before),
            ordersFetched: r.orders_fetched,
            orderItemsFetched: r.order_items_fetched,
            apiCallsMade: r.api_calls_made,
            errorMessage: r.error_message || null,
          }
          if (isAdminUser(req)) {
            base.lastAmazonRequestIds = parseMetadataLastRequestIds(r.metadata)
          }
          return base
        }),
      }
    }
    return res.json({ success: true, data: out })
  } catch (e) {
    console.error('[amazon sync status]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to read sync status',
      error: 'Unexpected server error',
    })
  }
}

function mapSyncLogRowForHealth(r) {
  const ids = parseMetadataLastRequestIds(r.metadata)
  return {
    syncType: r.sync_type,
    status: r.status,
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    createdAfter: isoOrNull(r.created_after),
    createdBefore: isoOrNull(r.created_before),
    ordersFetched: r.orders_fetched,
    orderItemsFetched: r.order_items_fetched,
    apiCallsMade: r.api_calls_made,
    amazonRequestIds: ids.length ? ids : null,
    error: toSafeSyncError(r.error_message),
  }
}

async function buildAmazonMarketplaceHealth(marketplaceKey) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const last = await cacheStore.getLastSyncRow(mk, 'orders')
  const lastOk = await cacheStore.getLastSuccessfulSyncRow(mk, 'orders')
  const lastFail = await cacheStore.getLastSyncRowByStatus(mk, 'orders', 'failed')
  const finishedRow = await cacheStore.getLastFinishedSyncRow(mk, 'orders')
  const recentSyncRows = await cacheStore.selectRecentSyncLogs(mk, 25)
  const apiRows = await cacheStore.selectRecentApiCallsByMarketplace(mk, 50)

  const now = Date.now()
  const cut24 = now - 24 * 60 * 60 * 1000
  let recent429Count = 0
  for (const r of apiRows) {
    const t = r.called_at ? new Date(r.called_at).getTime() : 0
    if (t >= cut24 && Number(r.status_code) === 429) recent429Count += 1
  }

  const recentApiCalls = apiRows.map((r) => ({
    operation: r.operation,
    marketplaceKey: r.marketplace_key,
    calledAt: isoOrNull(r.called_at),
    statusCode: r.status_code,
    rateLimitHeader: r.rate_limit_header || null,
    success: Boolean(r.success),
    safeError: r.safe_error || null,
    amazonRequestId: r.amazon_request_id ? String(r.amazon_request_id).slice(0, 128) : null,
  }))

  let cooldownUntil = null
  if (finishedRow?.finished_at) {
    const coolMs = Math.max(1, parseInt(String(MANUAL_SYNC_COOLDOWN_MINUTES), 10) || 10) * 60_000
    const end = new Date(finishedRow.finished_at).getTime() + coolMs
    if (now < end) cooldownUntil = new Date(end).toISOString()
  }

  const fromMeta = last ? parseMetadataLastRequestIds(last.metadata)[0] : null
  const fromApi = apiRows.find((x) => x.amazon_request_id)?.amazon_request_id
  const lastAmazonRequestId = (fromMeta || fromApi || null)
    ? String(fromMeta || fromApi).slice(0, 128)
    : null

  let lastSafeError = toSafeSyncError(last?.error_message)
  if (!lastSafeError) lastSafeError = toSafeSyncError(lastFail?.error_message)

  return {
    marketplaceKey: mk,
    lastSuccessfulSyncAt: isoOrNull(lastOk?.finished_at),
    lastFailedSyncAt: lastFail ? isoOrNull(lastFail.finished_at || lastFail.started_at) : null,
    lastStatus: last?.status || null,
    cooldownUntil,
    recentSyncs: recentSyncRows.map(mapSyncLogRowForHealth),
    recentApiCalls,
    recent429Count,
    lastAmazonRequestId,
    lastSafeError,
  }
}

/**
 * GET /api/amazon/sync/health — admin only; aggregated sync + rate-limit audit (no secrets or PII).
 */
async function getAmazonSyncHealth(req, res) {
  try {
    const marketplaces = []
    for (const key of ['uae', 'ksa']) {
      marketplaces.push(await buildAmazonMarketplaceHealth(key))
    }
    return res.json({ success: true, data: { marketplaces } })
  } catch (e) {
    console.error('[amazon sync health]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to read Amazon sync health',
      error: 'Unexpected server error',
    })
  }
}

/**
 * GET /api/amazon/rate-limits — admin only
 */
async function getAmazonRateLimits(req, res) {
  try {
    const rows = await cacheStore.selectRecentApiCalls(200)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const recentCalls = rows.slice(0, 40).map((r) => ({
      id: String(r.id),
      operation: r.operation,
      marketplaceKey: r.marketplace_key,
      calledAt: r.called_at,
      statusCode: r.status_code,
      rateLimitHeader: r.rate_limit_header,
      success: r.success,
      safeError: r.safe_error || null,
      amazonRequestId: r.amazon_request_id || null,
    }))

    const callsLast24h = rows.filter((r) => {
      const t = r.called_at ? new Date(r.called_at).getTime() : 0
      return t >= cutoff
    })
    const callsByOperation = {}
    const throttle429ByMarketplace = { uae: 0, ksa: 0 }
    let throttle429 = 0
    for (const r of callsLast24h) {
      const op = r.operation || 'unknown'
      callsByOperation[op] = (callsByOperation[op] || 0) + 1
      if (Number(r.status_code) === 429) {
        throttle429 += 1
        const mk = String(r.marketplace_key || '').toLowerCase()
        if (mk === 'uae' || mk === 'ksa') throttle429ByMarketplace[mk] += 1
      }
    }

    let lastRateLimitHeader = null
    let lastAmazonRequestId = null
    for (const r of rows) {
      if (!lastRateLimitHeader && r.rate_limit_header) lastRateLimitHeader = r.rate_limit_header
      if (!lastAmazonRequestId && r.amazon_request_id) lastAmazonRequestId = r.amazon_request_id
      if (lastRateLimitHeader && lastAmazonRequestId) break
    }

    return res.json({
      success: true,
      data: {
        recentCalls,
        summary: {
          callsLast24hTotal: callsLast24h.length,
          callsLast24hByOperation: callsByOperation,
          throttle429Last24h: throttle429,
          throttle429Last24hByMarketplace: throttle429ByMarketplace,
          lastRateLimitHeaderObserved: lastRateLimitHeader,
          lastAmazonRequestId,
        },
      },
    })
  } catch (e) {
    console.error('[amazon rate limits]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to read rate limit log',
      error: 'Unexpected server error',
    })
  }
}

/**
 * GET /api/amazon/dashboard/orders — BI from cache; optional `includeSkuImages` (catalog, rate-limited).
 */
async function getAmazonOrdersDashboardHandler(req, res) {
  try {
    const rawMk = req.query.marketplaceKey ?? req.query.marketplace ?? 'all'
    const createdAfter = parseQueryDate(req.query.createdAfter)
    const createdBefore = parseQueryDate(req.query.createdBefore)
    const rawImg = req.query.includeSkuImages
    const includeSkuImages =
      rawImg === undefined || rawImg === null || String(rawImg).trim() === ''
        ? true
        : !/^(0|false|no|off)$/i.test(String(rawImg).trim())

    const data = await getAmazonOrdersDashboard({
      marketplaceKey: rawMk,
      createdAfter,
      createdBefore,
      includeSkuImages,
    })

    return res.json({ success: true, data })
  } catch (e) {
    if (e?.code === 'AMAZON_DASHBOARD_RANGE' || e?.code === 'AMAZON_DASHBOARD_VALIDATION') {
      return res.status(400).json({
        success: false,
        message: 'Invalid dashboard query',
        error: e.message || 'Invalid request',
      })
    }
    console.error('[amazon orders dashboard]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to load Amazon orders dashboard',
      error: 'Unexpected server error',
    })
  }
}

/**
 * GET /api/amazon/sku-image-overrides — admin only; safe rows (no secrets).
 */
async function getAmazonSkuImageOverrides(req, res) {
  try {
    const rawMk = req.query.marketplaceKey
    let mkFilter = undefined
    if (rawMk != null && String(rawMk).trim() !== '') {
      const mk = normalizeMarketplaceKeyForOverride(rawMk)
      if (mk == null) {
        return res.status(400).json({
          success: false,
          message: 'marketplaceKey must be uae or ksa when provided',
          error: 'Bad request',
        })
      }
      mkFilter = mk
    }
    const sellerSku =
      req.query.sellerSku != null && String(req.query.sellerSku).trim()
        ? String(req.query.sellerSku).trim()
        : undefined
    const asin = req.query.asin != null && String(req.query.asin).trim() ? String(req.query.asin).trim() : undefined
    const limit = parseInt(String(req.query.limit || ''), 10)
    const items = await listSkuImageOverridesForAdmin({
      marketplaceKey: mkFilter,
      sellerSku,
      asin,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return res.json({ success: true, data: { items } })
  } catch (e) {
    console.error('[amazon sku image overrides list]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to list SKU image overrides',
      error: 'Unexpected server error',
    })
  }
}

/**
 * POST /api/amazon/sku-image-overrides — admin only; upsert manual image URL.
 */
async function postAmazonSkuImageOverride(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    let mk = null
    if (body.marketplaceKey != null && String(body.marketplaceKey).trim() !== '') {
      mk = normalizeMarketplaceKeyForOverride(body.marketplaceKey)
      if (mk == null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid marketplaceKey (use uae, ksa, or omit for global)',
          error: 'Bad request',
        })
      }
    }
    const row = await upsertSkuImageOverride({
      marketplaceKey: mk,
      sellerSku: body.sellerSku,
      asin: body.asin,
      imageUrl: body.imageUrl,
      source: body.source,
      notes: body.notes,
    })
    const imageSource =
      row.sellerSku != null && String(row.sellerSku).trim() !== '' ? 'sku_override' : 'asin_override'
    return res.json({
      success: true,
      data: {
        marketplaceKey: row.marketplaceKey,
        sellerSku: row.sellerSku,
        asin: row.asin,
        imageUrl: row.imageUrl,
        imageSource,
      },
    })
  } catch (e) {
    if (e?.code === 'AMAZON_SKU_IMAGE_OVERRIDE_VALIDATION') {
      return res.status(400).json({
        success: false,
        message: e.message || 'Validation failed',
        error: 'Bad request',
      })
    }
    console.error('[amazon sku image override upsert]', e?.message || e)
    return res.status(500).json({
      success: false,
      message: 'Failed to save SKU image override',
      error: 'Unexpected server error',
    })
  }
}

module.exports = {
  getCachedAmazonOrders,
  postAmazonOrdersSync,
  getAmazonSyncStatus,
  getAmazonSyncHealth,
  getAmazonRateLimits,
  getAmazonOrdersDashboardHandler,
  getAmazonSkuImageOverrides,
  postAmazonSkuImageOverride,
}
