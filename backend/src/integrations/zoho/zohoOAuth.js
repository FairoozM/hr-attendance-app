const { readZohoInventoryConfig } = require('./zohoConfig')
const { httpsRequestJson, formEncode } = require('./zohoHttp')

/** In-memory access token (single Node process) */
let cached = { accessToken: null, expiresAtMs: 0 }

const SLACK_MS = 30_000

/**
 * @returns {Promise<string>}
 */
async function getZohoAccessToken() {
  const c = readZohoInventoryConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_INVENTORY_ORGANIZATION_ID.')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  if (cached.accessToken && Date.now() < cached.expiresAtMs - SLACK_MS) {
    return cached.accessToken
  }
  const tokenPath = '/oauth/v2/token'
  const body = formEncode({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
  })
  const url = `${c.accountsBase}${tokenPath}`
  const { status, body: resBody } = await httpsRequestJson(url, {
    method: 'POST',
    body,
    timeoutMs: c.timeoutMs,
  })
  if (status < 200 || status >= 300) {
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
    const e = new Error('Zoho token response is not valid JSON')
    e.code = 'ZOHO_OAUTH_ERROR'
    throw e
  }
  if (json.error) {
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
  return cached.accessToken
}

/** For unit tests: reset in-memory token cache. */
function resetZohoTokenCache() {
  cached = { accessToken: null, expiresAtMs: 0 }
}

module.exports = { getZohoAccessToken, resetZohoTokenCache }
