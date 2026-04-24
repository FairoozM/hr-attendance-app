const { readZohoConfig, orgEnvHint } = require('./zohoConfig')
const { httpsRequestJson, formEncode } = require('./zohoHttp')

/** In-memory access token (single Node process) */
let cached = { accessToken: null, expiresAtMs: 0 }

/**
 * Single in-flight refresh promise. Concurrent callers share this so we never
 * fire parallel POST /oauth/v2/token requests against Zoho.
 * @type {Promise<string>|null}
 */
let inFlightRefreshPromise = null

const SLACK_MS = 30_000

/**
 * @param {{ force?: boolean }} [opts] - when `force` is true, ignore the cached
 *   token (used by the API client's one-shot 401/INVALID_OAUTHTOKEN retry).
 * @returns {Promise<string>}
 */
async function getZohoAccessToken(opts = {}) {
  const force = opts && opts.force === true
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error(
      `Zoho not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, and ${orgEnvHint()}.`
    )
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }

  if (!force && cached.accessToken && Date.now() < cached.expiresAtMs - SLACK_MS) {
    if (process.env.DEBUG_ZOHO === '1') {
      console.log('[zoho-auth] reusing cached access token')
    }
    return cached.accessToken
  }

  if (inFlightRefreshPromise) {
    console.log('[zoho-auth] awaiting in-flight refresh')
    return inFlightRefreshPromise
  }

  inFlightRefreshPromise = (async () => {
    if (process.env.DEBUG_ZOHO === '1') {
      const shortStack = String(new Error().stack || '')
        .split('\n')
        .slice(1, 12)
        .join('\n')
        .trim()
      console.log('[zoho-auth] token refresh call stack:')
      console.log(shortStack || '(no stack)')
    }

    const tokenPath = '/oauth/v2/token'
    const grantType = 'refresh_token'
    if (grantType !== 'refresh_token') {
      console.error('[zoho-auth] ERROR authorization_code flow was triggered unexpectedly')
      const e = new Error(
        'Refusing to request Zoho token with non-refresh_token grant at runtime. ' +
          'Re-issue the refresh token at https://api-console.zoho.com (Self Client) ' +
          'and set ZOHO_REFRESH_TOKEN.'
      )
      e.code = 'ZOHO_OAUTH_ERROR'
      throw e
    }
    const tokenParams = {
      grant_type: grantType,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
    }
    if (c.redirectUri) tokenParams.redirect_uri = c.redirectUri
    const body = formEncode(tokenParams)
    const url = `${c.accountsBase}${tokenPath}`
    const debugZoho = process.env.DEBUG_ZOHO === '1'
    if (debugZoho) {
      const tail6 = (s) => {
        const v = String(s || '')
        return v.length <= 6 ? v : v.slice(-6)
      }
      console.log('[zoho-auth] accountsBase:', c.accountsBase)
      console.log('[zoho-auth] clientId suffix:', tail6(c.clientId))
      console.log('[zoho-auth] refreshToken suffix:', tail6(c.refreshToken))
      console.log('[zoho-auth] grant_type:', grantType)
    }
    const { status, body: resBody } = await httpsRequestJson(url, {
      method: 'POST',
      body,
      timeoutMs: c.timeoutMs,
    })
    // On any failure, log Zoho's exact response status + body once,
    // with `access_token` redacted in the unlikely case Zoho echoes one in an
    // error envelope. Successful responses are NEVER logged here (would expose
    // the access token).
    const logFailureDetail = (reason) => {
      const safeBody = String(resBody || '').replace(
        /("access_token"\s*:\s*")[^"]+(")/g,
        '$1[REDACTED]$2'
      )
      console.error(
        `[zoho-auth] token response error (${reason}) — HTTP ${status} body:`,
        safeBody.slice(0, 1000)
      )
    }
    if (status < 200 || status >= 300) {
      logFailureDetail('non-2xx')
      const e = new Error(
        `Zoho token refresh failed (HTTP ${status}): ${resBody?.slice(0, 500) || ''}`.trim()
      )
      e.code = 'ZOHO_OAUTH_ERROR'
      e.httpStatus = status
      throw e
    }
    let json
    try {
      json = JSON.parse(resBody)
    } catch {
      logFailureDetail('non-JSON body')
      const e = new Error('Zoho token response is not valid JSON')
      e.code = 'ZOHO_OAUTH_ERROR'
      throw e
    }
    if (json.error) {
      logFailureDetail(`error=${json.error}`)
      const e = new Error(`Zoho OAuth error: ${json.error} — ${json.error_description || ''}`)
      e.code = 'ZOHO_OAUTH_ERROR'
      e.oauth = json
      throw e
    }
    if (!json.access_token) {
      const e = new Error('Zoho token response is missing access_token')
      e.code = 'ZOHO_OAUTH_ERROR'
      throw e
    }
    const sec = Number(json.expires_in) || 3600
    cached = {
      accessToken: String(json.access_token),
      expiresAtMs: Date.now() + sec * 1000,
    }
    console.log('[zoho-auth] fetched new access token (expires in ' + sec + 's)')
    return cached.accessToken
  })()

  try {
    return await inFlightRefreshPromise
  } catch (err) {
    cached = { accessToken: null, expiresAtMs: 0 }
    console.error('[zoho-auth] refresh failed', err && err.message)
    throw err
  } finally {
    inFlightRefreshPromise = null
  }
}

/**
 * Heuristic: did Zoho reject the access token itself (vs scope or other errors)?
 * Triggers the API client's one-shot retry.
 *
 * @param {number} httpStatus
 * @param {string} body
 * @returns {boolean}
 */
function isInvalidAccessTokenResponse(httpStatus, body) {
  if (httpStatus !== 401) return false
  const s = String(body || '')
  return /INVALID[_-]?OAUTHTOKEN/i.test(s) || /invalid[_ ]token/i.test(s)
}

/** For unit tests: reset in-memory token cache and any in-flight refresh. */
function resetZohoTokenCache() {
  cached = { accessToken: null, expiresAtMs: 0 }
  inFlightRefreshPromise = null
}

module.exports = { getZohoAccessToken, isInvalidAccessTokenResponse, resetZohoTokenCache }
