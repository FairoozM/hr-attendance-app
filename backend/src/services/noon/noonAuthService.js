const crypto = require('crypto')
const fs = require('fs')

const axios = require('axios')
const jwt = require('jsonwebtoken')

const { readNoonConfig } = require('./noonConfig')
const { NoonServiceError } = require('./noonErrors')

const LOGIN_PATH = '/identity/public/v1/api/login'

let cachedSession = null
let lastLoginScopeDebug = {
  defaultProjectCodeSent: false,
  projectCodeValue: null,
  loggedAt: null,
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function findStringByKeys(source, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey))
  const visited = new Set()

  function visit(value) {
    if (!value || typeof value !== 'object') return ''
    if (visited.has(value)) return ''
    visited.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = visit(item)
        if (nested) return nested
      }
      return ''
    }

    for (const [rawKey, rawValue] of Object.entries(value)) {
      if (wanted.has(normalizeKey(rawKey)) && typeof rawValue === 'string' && rawValue.trim()) {
        return rawValue.trim()
      }
    }

    for (const rawValue of Object.values(value)) {
      const nested = visit(rawValue)
      if (nested) return nested
    }

    return ''
  }

  return visit(source)
}

function safeMessageFromBody(data, fallback) {
  if (isRecord(data)) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : ''
    if (message.trim()) return message.trim()
  }
  if (typeof data === 'string' && data.trim()) return data.trim()
  return fallback
}

function safeDetailsFromBody(data) {
  if (!isRecord(data) || !Array.isArray(data.details)) return []
  return data.details
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (isRecord(item) && typeof item.message === 'string') return item.message.trim()
      return ''
    })
    .filter(Boolean)
}

function parseCookieHeader(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
        .map((entry) => String(entry || '').split(';')[0].trim())
        .filter(Boolean)
    : []

  if (!cookies.length) {
    throw new NoonServiceError(
      'NOON_AUTH_COOKIE_MISSING',
      'Noon login succeeded but no session cookie was returned.',
      502
    )
  }

  return cookies.join('; ')
}

function parseCookieExpiry(setCookieHeader) {
  if (!Array.isArray(setCookieHeader)) return null

  let best = null
  for (const entry of setCookieHeader) {
    const parts = String(entry || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)

    const maxAgePart = parts.find((part) => /^max-age=/i.test(part))
    if (maxAgePart) {
      const seconds = Number(maxAgePart.split('=')[1])
      if (Number.isFinite(seconds) && seconds > 0) {
        const candidate = Date.now() + seconds * 1000
        best = best == null ? candidate : Math.min(best, candidate)
        continue
      }
    }

    const expiresPart = parts.find((part) => /^expires=/i.test(part))
    if (expiresPart) {
      const value = expiresPart.slice(expiresPart.indexOf('=') + 1)
      const candidate = new Date(value).getTime()
      if (!Number.isNaN(candidate) && candidate > 0) {
        best = best == null ? candidate : Math.min(best, candidate)
      }
    }
  }

  return best
}

function hasUsableCachedSession() {
  if (!cachedSession || !cachedSession.cookieHeader) return false
  if (cachedSession.expiresAtMs == null) return true
  return Date.now() < cachedSession.expiresAtMs - 30_000
}

function getSignedJwt(credentials) {
  const now = Math.floor(Date.now() / 1000)
  return jwt.sign(
    {
      sub: credentials.keyId,
      iat: now,
      exp: now + 5 * 60,
      jti: crypto.randomUUID(),
    },
    credentials.privateKey,
    { algorithm: 'RS256' }
  )
}

function loadNoonCredentials() {
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

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(config.jsonPath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new NoonServiceError(
        'NOON_CREDENTIALS_MISSING',
        'Noon service account JSON file was not found.',
        503
      )
    }
    throw new NoonServiceError(
      'NOON_CREDENTIALS_INVALID_JSON',
      'Noon service account JSON could not be parsed.',
      500
    )
  }

  const privateKey = findStringByKeys(parsed, ['private_key', 'privateKey'])
  const keyId = findStringByKeys(parsed, ['key_id', 'keyId', 'kid'])
  const fileProjectCode = findStringByKeys(parsed, [
    'project_code',
    'projectCode',
    'default_project_code',
    'defaultProjectCode',
  ])
  const projectCode = config.projectCode || fileProjectCode

  const missingFields = [
    !privateKey ? 'private_key' : '',
    !keyId ? 'key_id' : '',
  ].filter(Boolean)

  if (missingFields.length) {
    throw new NoonServiceError(
      'NOON_CREDENTIALS_FIELDS_MISSING',
      'Noon service account JSON is missing required fields.',
      500,
      missingFields
    )
  }

  return { privateKey, keyId, projectCode }
}

function clearNoonSessionCookie() {
  cachedSession = null
}

function getNoonLoginScopeDebug() {
  return { ...lastLoginScopeDebug }
}

function getNoonAuthStatus() {
  return {
    cached: Boolean(cachedSession && cachedSession.cookieHeader),
    authenticated: hasUsableCachedSession(),
    expiresAt:
      cachedSession && cachedSession.expiresAtMs != null
        ? new Date(cachedSession.expiresAtMs).toISOString()
        : null,
    cachedAt:
      cachedSession && cachedSession.obtainedAtMs != null
        ? new Date(cachedSession.obtainedAtMs).toISOString()
        : null,
  }
}

async function loginNoonSession(forceRefresh = false) {
  if (!forceRefresh && hasUsableCachedSession()) {
    return cachedSession.cookieHeader
  }

  const config = readNoonConfig()
  const credentials = loadNoonCredentials()
  const token = getSignedJwt(credentials)
  const effectiveProjectCode = config.projectCode || credentials.projectCode
  const body = {
    token,
    ...(effectiveProjectCode ? { default_project_code: effectiveProjectCode } : {}),
  }
  lastLoginScopeDebug = {
    defaultProjectCodeSent: Boolean(effectiveProjectCode),
    projectCodeValue: effectiveProjectCode || null,
    loggedAt: new Date().toISOString(),
  }
  console.info(
    `[noon-auth] default_project_code sent: ${lastLoginScopeDebug.defaultProjectCodeSent} value: ${lastLoginScopeDebug.projectCodeValue || '(none)'}`
  )

  try {
    const response = await axios.post(`${config.baseUrl}${LOGIN_PATH}`, body, {
      timeout: 15_000,
      validateStatus: () => true,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
      },
    })

    if (response.status >= 400) {
      throw new NoonServiceError(
        'NOON_AUTH_FAILED',
        safeMessageFromBody(response.data, `Noon login failed with HTTP ${response.status}.`),
        response.status,
        safeDetailsFromBody(response.data)
      )
    }

    const setCookieHeader = response.headers['set-cookie']
    const cookieHeader = parseCookieHeader(setCookieHeader)
    cachedSession = {
      cookieHeader,
      obtainedAtMs: Date.now(),
      expiresAtMs: parseCookieExpiry(setCookieHeader),
    }

    return cookieHeader
  } catch (error) {
    if (error instanceof NoonServiceError) throw error
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new NoonServiceError(
          'NOON_AUTH_TIMEOUT',
          'Timed out while authenticating with Noon.',
          504
        )
      }
      throw new NoonServiceError(
        'NOON_AUTH_NETWORK',
        'Could not reach Noon authentication service.',
        502
      )
    }
    throw new NoonServiceError('NOON_AUTH_UNKNOWN', 'Noon authentication failed.', 500)
  }
}

async function getNoonSessionCookie(options = {}) {
  return loginNoonSession(Boolean(options.forceRefresh))
}

async function refreshNoonSessionCookie() {
  clearNoonSessionCookie()
  return loginNoonSession(true)
}

module.exports = {
  clearNoonSessionCookie,
  getNoonAuthStatus,
  getNoonLoginScopeDebug,
  getNoonSessionCookie,
  loadNoonCredentials,
  loginNoonSession,
  refreshNoonSessionCookie,
}
