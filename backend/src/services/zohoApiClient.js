/**
 * Single Zoho REST client wrapper (Inventory + Books on www.zohoapis.com).
 * Per-minute / daily limits, safe-stop, PostgreSQL cache + usage logs, bounded retries.
 * OAuth refresh remains in zohoOAuth.js (not counted as Inventory API).
 */

const { getZohoAccessToken, isInvalidAccessTokenResponse } = require('../integrations/zoho/zohoOAuth')
const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const { httpsRequestJson, httpsRequestBuffer } = require('../integrations/zoho/zohoHttp')
const zohoApiStore = require('./zohoApiStore')

async function safeInsertUsageLog(row) {
  try {
    await zohoApiStore.insertUsageLog(row)
  } catch (e) {
    console.warn('[zoho-api] usage log insert failed:', e.message || e)
  }
}

function parseEnvInt(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(String(raw).trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

const DAILY_LIMIT = parseEnvInt('ZOHO_DAILY_CALL_LIMIT', parseEnvInt('ZOHO_DAILY_API_BUDGET', 9000))
const WARNING_LIMIT = parseEnvInt('ZOHO_WARNING_LIMIT', 7000)
const SAFE_STOP_LIMIT = parseEnvInt('ZOHO_SAFE_STOP_LIMIT', 8500)
const PER_MINUTE_LIMIT = parseEnvInt('ZOHO_PER_MINUTE_LIMIT', 70)
/** When at the per-minute cap, wait for the rolling window (instead of failing fast). */
const PER_MINUTE_AUTO_WAIT = !/^(0|false|no)$/i.test(
  String(process.env.ZOHO_PER_MINUTE_AUTO_WAIT ?? 'true')
)
const PER_MINUTE_WAIT_MAX_MS = parseEnvInt('ZOHO_PER_MINUTE_WAIT_MAX_MS', 120000)
const CACHE_ENABLED = !/^(0|false|no)$/i.test(String(process.env.ZOHO_CACHE_ENABLED ?? 'true'))

const TTL_MS = {
  items_list: 6 * 60 * 60 * 1000,
  item_detail: 60 * 60 * 1000,
  sales_orders: 15 * 60 * 1000,
  stock: 10 * 60 * 1000,
  contacts: 6 * 60 * 60 * 1000,
  default: 5 * 60 * 1000,
}

const minuteTimestamps = []
let warnedWarningLimitDay = ''
let syncPausedUntil = 0
let dailyCountCache = { n: null, at: 0 }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function trimMinuteWindow() {
  const cutoff = Date.now() - 60_000
  while (minuteTimestamps.length > 0 && minuteTimestamps[0] < cutoff) {
    minuteTimestamps.shift()
  }
}

function recordOutboundMinute() {
  trimMinuteWindow()
  minuteTimestamps.push(Date.now())
}

async function getDailySuccessCount() {
  const now = Date.now()
  if (dailyCountCache.n != null && now - dailyCountCache.at < 2000) {
    return dailyCountCache.n
  }
  const n = await zohoApiStore.countSuccessfulCallsTodayUtc()
  dailyCountCache = { n, at: now }
  return n
}

function invalidateDailyCountCache() {
  dailyCountCache = { n: null, at: 0 }
}

function pauseFrom429() {
  syncPausedUntil = Date.now() + 15 * 60 * 1000
  console.warn('[zoho-api] PAUSED Zoho sync jobs until', new Date(syncPausedUntil).toISOString(), '(HTTP 429)')
}

function isSyncPaused() {
  return Date.now() < syncPausedUntil
}

function defaultCacheKey(path, searchParams) {
  const qs = searchParams ? searchParams.toString() : ''
  return `zoho:${path.split('?')[0]}${qs ? `?${qs}` : ''}`
}

function inferCacheCategory(path, product) {
  const p = path.split('?')[0]
  if (product === 'books') {
    if (p.includes('/contacts')) return 'contacts'
    return 'sales_orders'
  }
  if (/\/items\/[^/]+\/image$/i.test(p)) return 'item_detail'
  if (/\/items\/[^/]+$/.test(p) && !p.endsWith('/items')) return 'item_detail'
  if (p.endsWith('/items') || p.endsWith('/items/')) return 'items_list'
  if (p.includes('/settings/warehouses')) return 'stock'
  if (
    p.includes('/invoices') ||
    p.includes('/salesorders') ||
    p.includes('/bills') ||
    p.includes('/vendorcredits') ||
    p.includes('/purchaseorders')
  ) {
    return 'sales_orders'
  }
  return 'default'
}

function inferSource(path, product) {
  if (product === 'books') return 'books'
  const p = path.split('?')[0]
  if (p.includes('/image')) return 'inventory_image'
  return 'inventory'
}

function isThrottle(status, bodyStr) {
  if (status === 429) return true
  if (!bodyStr || typeof bodyStr !== 'string') return false
  return (
    bodyStr.includes('"code":1070') ||
    bodyStr.includes("'code':1070") ||
    bodyStr.includes('maximum number of in process requests')
  )
}

function isRetriableTransportError(err) {
  const c = err && err.code
  return c === 'ZOHO_API_TIMEOUT' || c === 'ZOHO_API_NETWORK_ERROR'
}

function isRetriableHttpStatus(status) {
  return status === 502 || status === 503 || status === 504
}

async function logBlocked(endpoint, method, statusName, source, msg) {
  await safeInsertUsageLog({
    endpoint: endpoint.slice(0, 500),
    method: method || 'GET',
    cacheKey: null,
    status: statusName,
    source: source || null,
    responseCode: null,
    errorMessage: msg || null,
    cost: 0,
  })
}

async function assertGuards(pathBase, method, source, critical) {
  if (isSyncPaused() && !critical) {
    const e = new Error('Zoho API sync is temporarily paused after HTTP 429. Retry later.')
    e.code = 'ZOHO_SYNC_PAUSED'
    console.warn('[zoho-api] blocked reason=sync_paused endpoint=', pathBase)
    await logBlocked(pathBase, method, 'blocked_sync_paused', source, e.message)
    throw e
  }

  trimMinuteWindow()
  if (minuteTimestamps.length >= PER_MINUTE_LIMIT) {
    if (PER_MINUTE_AUTO_WAIT) {
      const waitStarted = Date.now()
      while (minuteTimestamps.length >= PER_MINUTE_LIMIT) {
        if (Date.now() - waitStarted > PER_MINUTE_WAIT_MAX_MS) {
          const e = new Error(
            `Zoho per-minute limit: still at ${PER_MINUTE_LIMIT} calls/60s after ${PER_MINUTE_WAIT_MAX_MS}ms wait. Try again or slow down.`
          )
          e.code = 'ZOHO_RATE_MINUTE_LIMIT'
          console.warn(
            '[zoho-api] blocked reason=per_minute_wait_timeout endpoint=',
            pathBase,
            'usage_last60s=',
            minuteTimestamps.length
          )
          await logBlocked(pathBase, method, 'blocked_minute', source, e.message)
          throw e
        }
        const oldest = minuteTimestamps[0]
        const waitMs = Math.min(Math.max(50, oldest + 60_000 - Date.now() + 50), 15_000)
        console.warn(
          '[zoho-api] per-minute window full; waiting',
          Math.round(waitMs),
          'ms',
          'queued=',
          minuteTimestamps.length,
          'endpoint=',
          pathBase
        )
        await sleep(waitMs)
        trimMinuteWindow()
      }
    } else {
      const e = new Error(
        `Zoho per-minute API limit exceeded (${PER_MINUTE_LIMIT} calls / 60s). Slow down requests.`
      )
      e.code = 'ZOHO_RATE_MINUTE_LIMIT'
      console.warn(
        '[zoho-api] blocked reason=per_minute endpoint=',
        pathBase,
        'usage_last60s=',
        minuteTimestamps.length
      )
      await logBlocked(pathBase, method, 'blocked_minute', source, e.message)
      throw e
    }
  }

  const daily = await getDailySuccessCount()
  console.log('[zoho-api] usage today=', daily, 'endpoint=', pathBase)

  if (daily >= DAILY_LIMIT) {
    const e = new Error(`Zoho daily API limit reached (${DAILY_LIMIT} successful calls, UTC day).`)
    e.code = 'ZOHO_DAILY_LIMIT'
    console.warn('[zoho-api] blocked reason=daily_hard endpoint=', pathBase)
    await logBlocked(pathBase, method, 'blocked_daily', source, e.message)
    throw e
  }

  if (!critical && daily >= SAFE_STOP_LIMIT) {
    const e = new Error(
      `Zoho safe-stop active (${daily}/${SAFE_STOP_LIMIT} calls today). Non-critical requests are blocked.`
    )
    e.code = 'ZOHO_SAFE_STOP'
    console.warn('[zoho-api] blocked reason=safe_stop endpoint=', pathBase)
    await logBlocked(pathBase, method, 'blocked_safe_stop', source, e.message)
    throw e
  }

  const dayKey = new Date().toISOString().slice(0, 10)
  if (daily >= WARNING_LIMIT && warnedWarningLimitDay !== dayKey) {
    warnedWarningLimitDay = dayKey
    console.warn(`[zoho-api] WARNING: Zoho usage today ${daily}/${WARNING_LIMIT} (warning threshold)`)
  }
}

async function runInventoryJsonOnce(opts) {
  const {
    url,
    method,
    body,
    timeoutMs,
    pathBase,
    cacheKey,
    cacheCategory,
    source,
    critical,
    getToken,
    setToken,
  } = opts

  await assertGuards(pathBase, method, source, critical)

  let token = getToken()
  const doReq = (t) =>
    httpsRequestJson(url, {
      method,
      body: body || undefined,
      timeoutMs,
      headers: { Authorization: `Zoho-oauthtoken ${t}` },
    })

  recordOutboundMinute()
  let { status, body: resBody } = await doReq(token)

  if (isInvalidAccessTokenResponse(status, resBody)) {
    console.warn('[zoho-auth] retrying after invalid access token —', pathBase)
    token = await getZohoAccessToken({ force: true })
    setToken(token)
    recordOutboundMinute()
    ;({ status, body: resBody } = await doReq(token))
  }

  if (isThrottle(status, resBody)) {
    pauseFrom429()
    await safeInsertUsageLog({
      endpoint: pathBase.slice(0, 500),
      method,
      cacheKey,
      status: 'error',
      source,
      responseCode: status,
      errorMessage: (resBody || '').slice(0, 500),
      cost: 1,
    })
    invalidateDailyCountCache()
    const e = new Error(`Zoho rate limit (HTTP ${status}). Sync paused.`)
    e.code = 'ZOHO_HTTP_429'
    e.httpStatus = status
    throw e
  }

  if (status < 200 || status >= 300) {
    const e = new Error(`Zoho API HTTP ${status} for ${pathBase}: ${(resBody || '').slice(0, 500)}`)
    e.code = 'ZOHO_API_ERROR'
    e.httpStatus = status
    e.zohoPath = pathBase
    await safeInsertUsageLog({
      endpoint: pathBase.slice(0, 500),
      method,
      cacheKey,
      status: 'error',
      source,
      responseCode: status,
      errorMessage: e.message.slice(0, 1000),
      cost: 1,
    })
    invalidateDailyCountCache()
    throw e
  }

  let json
  try {
    json = JSON.parse(resBody)
  } catch (err) {
    const e = new Error('Zoho response is not valid JSON')
    e.code = 'ZOHO_API_ERROR'
    e.cause = err
    await safeInsertUsageLog({
      endpoint: pathBase.slice(0, 500),
      method,
      cacheKey,
      status: 'error',
      source,
      responseCode: status,
      errorMessage: e.message,
      cost: 1,
    })
    invalidateDailyCountCache()
    throw e
  }

  if (json && typeof json === 'object' && 'code' in json && String(json.code) !== '0') {
    const e = new Error(
      `Zoho API application error: code ${json.code} — ${json.message || resBody?.slice(0, 200)}`
    )
    e.code = 'ZOHO_API_ERROR'
    e.zohoResponse = json
    await safeInsertUsageLog({
      endpoint: pathBase.slice(0, 500),
      method,
      cacheKey,
      status: 'error',
      source,
      responseCode: status,
      errorMessage: e.message.slice(0, 1000),
      cost: 1,
    })
    invalidateDailyCountCache()
    throw e
  }

  await safeInsertUsageLog({
    endpoint: pathBase.slice(0, 500),
    method,
    cacheKey,
    status: 'success',
    source,
    responseCode: status,
    errorMessage: null,
    cost: 1,
  })
  invalidateDailyCountCache()

  if (method === 'GET' && CACHE_ENABLED && cacheKey) {
    const ttl = TTL_MS[cacheCategory] || TTL_MS.default
    const expiresAt = new Date(Date.now() + ttl)
    try {
      await zohoApiStore.upsertCache(cacheKey, { payload: json }, expiresAt)
    } catch (ce) {
      console.warn('[zoho-api] cache write failed:', ce.message || ce)
    }
  }

  return json
}

/**
 * @param {object} [meta]
 * @param {boolean} [meta.critical]
 * @param {string} [meta.cacheKey]
 * @param {string} [meta.cacheCategory]
 * @param {string} [meta.source]
 * @param {boolean} [meta.skipCache]
 */
async function zohoInventoryJsonRequest(path, searchParams, method, body, meta = {}) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }

  const methodU = method || 'GET'
  const sp = searchParams || new URLSearchParams()
  if (!sp.get('organization_id')) sp.set('organization_id', c.organizationId)

  const pathBase = path.split('?')[0]
  const critical = meta.critical !== false
  const source = meta.source || inferSource(pathBase, 'inventory')
  const cacheCategory = meta.cacheCategory || inferCacheCategory(pathBase, 'inventory')
  const cacheKey =
    meta.cacheKey || (methodU === 'GET' && !meta.skipCache ? defaultCacheKey(pathBase, sp) : null)

  if (methodU === 'GET' && CACHE_ENABLED && cacheKey && !meta.skipCache) {
    try {
      const row = await zohoApiStore.getCacheRow(cacheKey)
      if (row && new Date(row.expires_at) > new Date()) {
        const payload = row.data && row.data.payload !== undefined ? row.data.payload : row.data
        console.log('[zoho-api] cache hit endpoint=', pathBase, 'usageToday=', await getDailySuccessCount())
        await safeInsertUsageLog({
          endpoint: pathBase.slice(0, 500),
          method: methodU,
          cacheKey,
          status: 'cache_hit',
          source,
          responseCode: 200,
          errorMessage: null,
          cost: 0,
        })
        return payload
      }
    } catch (err) {
      console.warn('[zoho-api] cache read failed:', err.message || err)
    }
    console.log('[zoho-api] cache miss endpoint=', pathBase)
  }

  const u = new URL(c.apiBase + pathBase)
  u.search = sp.toString()
  const url = u.toString()

  let token = await getZohoAccessToken()
  const maxTransportRetries = 2
  let transportAttempt = 0
  let lastErr

  while (transportAttempt <= maxTransportRetries) {
    try {
      return await runInventoryJsonOnce({
        url,
        method: methodU,
        body,
        timeoutMs: c.timeoutMs,
        pathBase,
        cacheKey,
        cacheCategory,
        source,
        critical,
        getToken: () => token,
        setToken: (t) => {
          token = t
        },
      })
    } catch (err) {
      lastErr = err
      if (err && err.code === 'ZOHO_HTTP_429') throw err
      if (transportAttempt >= maxTransportRetries) break
      const ok =
        isRetriableTransportError(err) ||
        (err && err.httpStatus && isRetriableHttpStatus(err.httpStatus))
      if (!ok) break
      const backoff = [500, 1500][transportAttempt] || 1500
      console.warn(`[zoho-api] retry transport in ${backoff}ms attempt=${transportAttempt + 1}`, err.message)
      await sleep(backoff)
      transportAttempt += 1
      token = await getZohoAccessToken()
    }
  }
  throw lastErr
}

/**
 * Binary GET (item images). No PostgreSQL body cache; guards + logging apply.
 */
async function zohoInventoryBufferRequest(path, searchParams, meta = {}) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const methodU = 'GET'
  const sp = searchParams || new URLSearchParams()
  if (!sp.get('organization_id')) sp.set('organization_id', c.organizationId)

  const pathBase = path.split('?')[0]
  const critical = meta.critical !== false
  const source = meta.source || 'inventory_image'

  const u = new URL(c.apiBase + pathBase)
  u.search = sp.toString()
  const url = u.toString()

  let token = await getZohoAccessToken()
  let transportAttempt = 0
  let lastErr

  while (transportAttempt <= 2) {
    try {
      await assertGuards(pathBase, methodU, source, critical)
      const doReq = (t) =>
        httpsRequestBuffer(url, {
          timeoutMs: c.timeoutMs,
          headers: { Authorization: `Zoho-oauthtoken ${t}` },
        })
      recordOutboundMinute()
      let { status, body, headers: resHeaders } = await doReq(token)
      const bodyStr = body.toString('utf8')
      if (isInvalidAccessTokenResponse(status, bodyStr)) {
        token = await getZohoAccessToken({ force: true })
        recordOutboundMinute()
        ;({ status, body, headers: resHeaders } = await doReq(token))
      }
      if (isThrottle(status, bodyStr)) {
        pauseFrom429()
        await safeInsertUsageLog({
          endpoint: pathBase.slice(0, 500),
          method: methodU,
          cacheKey: null,
          status: 'error',
          source,
          responseCode: status,
          errorMessage: '429 throttle',
          cost: 1,
        })
        invalidateDailyCountCache()
        const e = new Error('Zoho rate limit (HTTP 429). Sync paused.')
        e.code = 'ZOHO_HTTP_429'
        e.httpStatus = status
        throw e
      }
      await safeInsertUsageLog({
        endpoint: pathBase.slice(0, 500),
        method: methodU,
        cacheKey: null,
        status: status >= 200 && status < 300 ? 'success' : 'error',
        source,
        responseCode: status,
        errorMessage: status >= 200 && status < 300 ? null : bodyStr.slice(0, 300),
        cost: 1,
      })
      invalidateDailyCountCache()
      const raw = resHeaders && resHeaders['content-type']
      const contentType = raw ? String(raw).split(';')[0].trim() || 'image/jpeg' : 'image/jpeg'
      return { status, body, headers: resHeaders, contentType }
    } catch (err) {
      lastErr = err
      if (err && err.code === 'ZOHO_HTTP_429') throw err
      if (transportAttempt >= 2) break
      if (!isRetriableTransportError(err)) break
      await sleep([500, 1500][transportAttempt] || 1500)
      transportAttempt += 1
      token = await getZohoAccessToken()
    }
  }
  throw lastErr
}

async function zohoBooksJsonRequest(path, searchParams, method, body, meta = {}) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const methodU = method || 'GET'
  const sp = searchParams || new URLSearchParams()
  if (!sp.get('organization_id')) sp.set('organization_id', c.organizationId)

  const pathBase = path.split('?')[0]
  const critical = meta.critical !== false
  const source = meta.source || inferSource(pathBase, 'books')
  const cacheCategory = meta.cacheCategory || inferCacheCategory(pathBase, 'books')
  const cacheKey =
    meta.cacheKey || (methodU === 'GET' && !meta.skipCache ? defaultCacheKey(`books:${pathBase}`, sp) : null)

  if (methodU === 'GET' && CACHE_ENABLED && cacheKey && !meta.skipCache) {
    try {
      const row = await zohoApiStore.getCacheRow(cacheKey)
      if (row && new Date(row.expires_at) > new Date()) {
        const payload = row.data && row.data.payload !== undefined ? row.data.payload : row.data
        console.log('[zoho-api] cache hit endpoint=', pathBase, 'usageToday=', await getDailySuccessCount())
        await safeInsertUsageLog({
          endpoint: pathBase.slice(0, 500),
          method: methodU,
          cacheKey,
          status: 'cache_hit',
          source,
          responseCode: 200,
          errorMessage: null,
          cost: 0,
        })
        return payload
      }
    } catch (err) {
      console.warn('[zoho-api] cache read failed:', err.message || err)
    }
    console.log('[zoho-api] cache miss endpoint=', pathBase)
  }

  const u = new URL(c.apiBase + pathBase)
  u.search = sp.toString()
  const url = u.toString()

  let token = await getZohoAccessToken()
  let transportAttempt = 0
  let lastErr

  while (transportAttempt <= 2) {
    try {
      return await runInventoryJsonOnce({
        url,
        method: methodU,
        body,
        timeoutMs: c.timeoutMs,
        pathBase,
        cacheKey,
        cacheCategory,
        source,
        critical,
        getToken: () => token,
        setToken: (t) => {
          token = t
        },
      })
    } catch (err) {
      lastErr = err
      if (err && err.code === 'ZOHO_HTTP_429') throw err
      if (transportAttempt >= 2) break
      const ok =
        isRetriableTransportError(err) ||
        (err && err.httpStatus && isRetriableHttpStatus(err.httpStatus))
      if (!ok) break
      await sleep([500, 1500][transportAttempt] || 1500)
      transportAttempt += 1
      token = await getZohoAccessToken()
    }
  }
  throw lastErr
}

function getZohoGuardStatus() {
  return {
    syncPausedUntil: syncPausedUntil > Date.now() ? new Date(syncPausedUntil).toISOString() : null,
    perMinuteLimit: PER_MINUTE_LIMIT,
    dailyLimit: DAILY_LIMIT,
    warningLimit: WARNING_LIMIT,
    safeStopLimit: SAFE_STOP_LIMIT,
    cacheEnabled: CACHE_ENABLED,
    limits: {
      minuteWindowSize: minuteTimestamps.length,
    },
  }
}

module.exports = {
  zohoInventoryJsonRequest,
  zohoInventoryBufferRequest,
  zohoBooksJsonRequest,
  getZohoGuardStatus,
  getDailySuccessCount,
  invalidateDailyCountCache,
  isSyncPaused,
  TTL_MS,
  CACHE_ENABLED,
}
