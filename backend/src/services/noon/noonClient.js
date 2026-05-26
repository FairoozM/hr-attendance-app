const axios = require('axios')

const { getNoonSessionCookie, refreshNoonSessionCookie } = require('./noonAuthService')
const { readNoonConfig } = require('./noonConfig')
const { NoonServiceError } = require('./noonErrors')

const TIMEOUT_MS = 15_000

function safeMessageFromBody(data, fallback) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
  }
  if (typeof data === 'string' && data.trim()) return data.trim()
  return fallback
}

function safeDetailsFromBody(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.details)) {
    return []
  }

  return data.details
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object' && typeof item.message === 'string') {
        return item.message.trim()
      }
      return ''
    })
    .filter(Boolean)
}

function normalizeRequestPath(requestPath) {
  if (!requestPath) return '/'
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function safeResponseBody(data) {
  if (data == null) return null
  if (typeof data === 'string') return data.slice(0, 1000)
  if (typeof data !== 'object') return data
  try {
    return JSON.parse(JSON.stringify(data))
  } catch {
    return '[unserializable response body]'
  }
}

function getReadyConfig() {
  const config = readNoonConfig()
  if (!config.enabled) {
    throw new NoonServiceError('NOON_DISABLED', 'Noon API integration is disabled.', 503)
  }
  if (!config.configured) {
    throw new NoonServiceError(
      'NOON_CONFIG_INVALID',
      'Noon API configuration is incomplete.',
      503,
      config.errors.length ? config.errors : config.missing
    )
  }
  return config
}

async function requestNoon(method, requestPath, body, options = {}) {
  const config = getReadyConfig()
  const client = axios.create({
    baseURL: config.baseUrl,
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  })

  const url = normalizeRequestPath(requestPath)
  const safeFullUrl = `${config.baseUrl}${url}`

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookieHeader =
      attempt === 0
        ? await getNoonSessionCookie()
        : await refreshNoonSessionCookie()

    try {
      const response = await client.request({
        method,
        url,
        data: body,
        params: options.params,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': config.userAgent,
          Cookie: cookieHeader,
          ...(options.headers || {}),
        },
      })

      if (response.status === 401 && attempt === 0) continue

      if (response.status === 429) {
        throw new NoonServiceError(
          'NOON_RATE_LIMIT',
          'Noon rate limit reached. Try again shortly.',
          429,
          safeDetailsFromBody(response.data),
          {
            noonStatus: 429,
            method,
            path: url,
            url: safeFullUrl,
            safeBody: safeResponseBody(response.data),
          }
        )
      }

      if (response.status >= 400) {
        throw new NoonServiceError(
          'NOON_API_REQUEST_FAILED',
          safeMessageFromBody(response.data, `Noon request failed with HTTP ${response.status}.`),
          response.status,
          safeDetailsFromBody(response.data),
          {
            noonStatus: response.status,
            method,
            path: url,
            url: safeFullUrl,
            safeBody: safeResponseBody(response.data),
          }
        )
      }

      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
        request: {
          method,
          path: url,
          url: safeFullUrl,
        },
      }
    } catch (error) {
      if (error instanceof NoonServiceError) {
        if (error.httpStatus === 401 && attempt === 0) continue
        throw error
      }

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new NoonServiceError(
            'NOON_API_TIMEOUT',
            'Timed out while waiting for Noon API response.',
            504,
            [],
            { method, path: url, url: safeFullUrl }
          )
        }
        throw new NoonServiceError(
          'NOON_API_NETWORK',
          'Could not reach Noon API.',
          502,
          [],
          { method, path: url, url: safeFullUrl }
        )
      }

      throw new NoonServiceError(
        'NOON_API_UNKNOWN',
        'Noon API request failed.',
        500,
        [],
        { method, path: url, url: safeFullUrl }
      )
    }
  }

  throw new NoonServiceError('NOON_AUTH_RETRY_FAILED', 'Noon authentication retry failed.', 401)
}

function noonGet(requestPath, options) {
  return requestNoon('GET', requestPath, undefined, options)
}

function noonPost(requestPath, body, options) {
  return requestNoon('POST', requestPath, body, options)
}

module.exports = {
  noonGet,
  noonPost,
}
