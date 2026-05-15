const cookie = require('cookie')

const ACCESS_COOKIE = 'hr_access'
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60

function cookieBaseOpts() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  }
}

function serializeAccessToken(token) {
  return cookie.serialize(ACCESS_COOKIE, token, {
    ...cookieBaseOpts(),
    maxAge: SEVEN_DAYS_SEC,
  })
}

function serializeClearAccess() {
  return cookie.serialize(ACCESS_COOKIE, '', {
    ...cookieBaseOpts(),
    maxAge: 0,
  })
}

function readAccessTokenFromCookie(req) {
  const raw = req.headers && req.headers.cookie
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = cookie.parse(raw)
    const t = parsed[ACCESS_COOKIE]
    return t && typeof t === 'string' ? t.trim() : null
  } catch {
    return null
  }
}

module.exports = {
  ACCESS_COOKIE,
  serializeAccessToken,
  serializeClearAccess,
  readAccessTokenFromCookie,
}
