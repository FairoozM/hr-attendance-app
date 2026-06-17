/**
 * Instagram Graph API — Business Discovery (official Meta API only).
 *
 * Profile pictures (`profile_picture_url`) are only populated when Instagram Graph API
 * Business Discovery returns that field for the discovered account. Many accounts will
 * omit it (e.g. private profiles, personal accounts not visible to Business Discovery,
 * or permission limits) — in those cases we store null and log a clear reason.
 *
 * @see https://developers.facebook.com/docs/instagram-api/reference/ig-user
 */

const DEFAULT_GRAPH_VERSION = 'v22.0'

function getGraphApiVersion() {
  const raw = String(process.env.META_GRAPH_API_VERSION || '').trim()
  if (!raw) return DEFAULT_GRAPH_VERSION
  return raw.startsWith('v') ? raw : `v${raw}`
}

function isInstagramGraphConfigured() {
  const token = String(process.env.META_ACCESS_TOKEN || '').trim()
  const igUserId = String(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '').trim()
  return Boolean(token && igUserId)
}

/**
 * Normalize handle for Business Discovery: trim, strip leading @, Instagram-safe charset.
 * @param {string | undefined} raw
 * @returns {string | null}
 */
function normalizeInstagramUsername(raw) {
  if (raw == null || typeof raw !== 'string') return null
  let s = raw.trim().replace(/^@+/, '')
  if (!s) return null
  s = s.toLowerCase()
  if (!/^[\w.]+$/.test(s)) return null
  if (s.length > 30) return null
  return s
}

/**
 * Map Meta Graph API error payloads to stable app codes (never leak raw stack traces to callers).
 */
function classifyGraphError(errPayload) {
  const code = errPayload?.code
  const sub = errPayload?.error_subcode
  const msg = String(errPayload?.message || 'Instagram Graph API error')
  const type = String(errPayload?.type || '')

  if (code === 190 || /access token/i.test(msg) || /OAuthException/i.test(type)) {
    return { errorCode: 'OAUTH', errorMessage: 'Access token is missing, invalid, or expired.' }
  }
  if (code === 4 || code === 17 || code === 32 || /rate limit|request limit|throttl/i.test(msg)) {
    return { errorCode: 'RATE_LIMIT', errorMessage: 'Instagram / Meta rate limit reached. Try again later.' }
  }
  if (code === 10 || code === 200 || code === 294 || /permission|authorized ad account/i.test(msg)) {
    return { errorCode: 'PERMISSION', errorMessage: 'Missing Meta permissions for Business Discovery or Instagram account access.' }
  }
  if (code === 100 && /does not exist|invalid user id|Invalid username/i.test(msg)) {
    return { errorCode: 'INVALID_USERNAME', errorMessage: 'Invalid or unknown Instagram username.' }
  }
  if (code === 100) {
    return { errorCode: 'BAD_REQUEST', errorMessage: msg.slice(0, 280) }
  }
  return { errorCode: 'GRAPH_ERROR', errorMessage: msg.slice(0, 280) }
}

/**
 * Fetch public profile fields for another Instagram user via Business Discovery.
 * Does not throw — returns a structured result for API routes and background jobs.
 *
 * @param {string} username
 * @returns {Promise<{
 *   success: true,
 *   username: string,
 *   name: string | null,
 *   followersCount: number | null,
 *   followingCount: number | null,
 *   mediaCount: number | null,
 *   biography: string | null,
 *   website: string | null,
 *   profilePictureUrl: string | null
 * } | {
 *   success: false,
 *   username: string,
 *   profilePictureUrl: null,
 *   errorCode: string,
 *   errorMessage: string
 * }>}
 */
async function fetchInstagramBusinessProfile(username) {
  const normalized = normalizeInstagramUsername(username)
  if (!normalized) {
    return {
      success: false,
      username: String(username || '').trim() || 'unknown',
      profilePictureUrl: null,
      errorCode: 'INVALID_USERNAME',
      errorMessage: 'Invalid Instagram handle format.',
    }
  }

  if (!isInstagramGraphConfigured()) {
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'Instagram Graph API is not configured (META_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID).',
    }
  }

  const version = getGraphApiVersion()
  const igUserId = String(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '').trim()
  const accessToken = String(process.env.META_ACCESS_TOKEN || '').trim()

  // Request profile_picture_url along with other Business Discovery fields.
  const fields = [
    'business_discovery.username(',
    normalized,
    '){id,username,name,followers_count,follows_count,media_count,biography,website,profile_picture_url}',
  ].join('')

  const base = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(igUserId)}`
  const u = new URL(base)
  u.searchParams.set('fields', fields)
  u.searchParams.set('access_token', accessToken)

  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), 20000)
  let res
  try {
    res = await fetch(u.toString(), { method: 'GET', signal: ac.signal })
  } catch (e) {
    const m = e && e.message ? String(e.message) : 'Network error'
    console.error('[instagram-graph] request failed:', m)
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode: 'NETWORK',
      errorMessage: 'Could not reach Instagram Graph API.',
    }
  } finally {
    clearTimeout(to)
  }

  let json
  try {
    json = await res.json()
  } catch {
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode: 'INVALID_RESPONSE',
      errorMessage: 'Invalid JSON from Instagram Graph API.',
    }
  }

  if (!res.ok) {
    const e = json && json.error ? json.error : {}
    const { errorCode, errorMessage } = classifyGraphError(e)
    console.error('[instagram-graph] HTTP', res.status, errorCode, errorMessage, e)
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode,
      errorMessage,
    }
  }

  if (json && json.error) {
    const { errorCode, errorMessage } = classifyGraphError(json.error)
    console.error('[instagram-graph] error in body', errorCode, errorMessage)
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode,
      errorMessage,
    }
  }

  const bd = json && json.business_discovery
  if (!bd || typeof bd !== 'object') {
    console.warn(
      '[instagram-graph] business_discovery missing in response; username may be invalid, private, or not discoverable',
      { username: normalized },
    )
    return {
      success: false,
      username: normalized,
      profilePictureUrl: null,
      errorCode: 'NOT_DISCOVERABLE',
      errorMessage:
        'Could not load this account via Business Discovery (invalid username, private account, or not accessible to your app).',
    }
  }

  const pic = bd.profile_picture_url != null && String(bd.profile_picture_url).trim()
    ? String(bd.profile_picture_url).trim()
    : null

  if (pic == null) {
    console.warn(
      '[instagram-graph] business_discovery did not include profile_picture_url (private account, API limitations, or account type not supported by Business Discovery)',
      { username: normalized, hasId: Boolean(bd.id) },
    )
  }

  return {
    success: true,
    username: bd.username != null ? String(bd.username) : normalized,
    name: bd.name != null && String(bd.name).trim() ? String(bd.name).trim() : null,
    followersCount: typeof bd.followers_count === 'number' ? bd.followers_count : null,
    followingCount: typeof bd.follows_count === 'number' ? bd.follows_count : null,
    mediaCount: typeof bd.media_count === 'number' ? bd.media_count : null,
    biography: bd.biography != null && String(bd.biography).trim() ? String(bd.biography).trim() : null,
    website: bd.website != null && String(bd.website).trim() ? String(bd.website).trim() : null,
    profilePictureUrl: pic,
  }
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  getGraphApiVersion,
  isInstagramGraphConfigured,
  normalizeInstagramUsername,
  fetchInstagramBusinessProfile,
}
