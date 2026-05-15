/**
 * Amazon Advertising API — configuration only (no HTTP).
 * Separate from SP-API: Ads uses its own refresh token unless you explicitly opt in to reuse
 * the SP-API refresh token (see AMAZON_ADS_ALLOW_SP_API_REFRESH_TOKEN_FALLBACK).
 *
 * Never log client_secret, refresh_token, or access tokens.
 */

const { getAmazonSpApiMode, normalizeMarketplaceKey } = require('./amazonSpApiService')

const DEFAULT_ADS_ENDPOINT = 'https://advertising-api-eu.amazon.com'
const DEFAULT_ADS_SCOPE = 'advertising::campaign_management'

function trimEnv(name) {
  const v = process.env[name]
  return v == null ? '' : String(v).trim()
}

function spRefreshFallbackEnabled() {
  return trimEnv('AMAZON_ADS_ALLOW_SP_API_REFRESH_TOKEN_FALLBACK') === '1'
}

/**
 * Ads API base URL (no trailing path). Supports AMAZON_ADS_API_ENDPOINT (preferred) and
 * legacy AMAZON_ADS_API_HOST.
 * @returns {string}
 */
function getAmazonAdsApiEndpoint() {
  return trimEnv('AMAZON_ADS_API_ENDPOINT') || trimEnv('AMAZON_ADS_API_HOST') || DEFAULT_ADS_ENDPOINT
}

/**
 * LWA scope string sent with Ads token exchange (must match LWA app consent).
 * @returns {string}
 */
function getAmazonAdsLwaScope() {
  return trimEnv('AMAZON_ADS_LWA_SCOPE') || DEFAULT_ADS_SCOPE
}

/**
 * Resolved Ads credentials + profile for one region.
 *
 * @param {string} marketplaceKey - 'uae' | 'ksa'
 * @param {{ requireProfile?: boolean }} [opts]
 * @param {boolean} [opts.requireProfile=true] - Set false for LWA-only or GET /v2/profiles (no scope header).
 * @returns {{
 *   endpoint: string,
 *   clientId: string,
 *   clientSecret: string,
 *   refreshToken: string,
 *   adsScope: string,
 *   profileId: string,
 *   marketplaceKey: 'uae'|'ksa',
 *   mode: 'production'|'sandbox'
 * }}
 * @throws {Error & { code: 'AMAZON_ADS_CONFIG_INCOMPLETE', missing: string[], marketplaceKey: string }}}
 */
function getAmazonAdsConfig(marketplaceKey, opts = {}) {
  const requireProfile = opts.requireProfile !== false
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const mode = getAmazonSpApiMode()
  const isKsa = mk === 'ksa'
  const U = isKsa ? 'KSA' : 'UAE'

  const endpoint = getAmazonAdsApiEndpoint().replace(/\/+$/, '')
  const adsScope = getAmazonAdsLwaScope()

  /** @type {string[]} */
  const missing = []

  let clientId = ''
  let clientSecret = ''
  let refreshToken = ''
  let profileId = ''

  if (mode === 'production') {
    clientId =
      trimEnv(`AMAZON_${U}_ADS_LWA_CLIENT_ID`) || trimEnv(`AMAZON_${U}_LWA_CLIENT_ID`)
    clientSecret =
      trimEnv(`AMAZON_${U}_ADS_LWA_CLIENT_SECRET`) || trimEnv(`AMAZON_${U}_LWA_CLIENT_SECRET`)
    refreshToken = trimEnv(`AMAZON_${U}_ADS_REFRESH_TOKEN`)
    if (!refreshToken && spRefreshFallbackEnabled()) {
      refreshToken = trimEnv(`AMAZON_${U}_REFRESH_TOKEN`)
    }
    profileId = trimEnv(`AMAZON_${U}_ADS_PROFILE_ID`)
  } else {
    clientId = trimEnv('AMAZON_ADS_SANDBOX_LWA_CLIENT_ID') || trimEnv('AMAZON_LWA_CLIENT_ID')
    clientSecret = trimEnv('AMAZON_ADS_SANDBOX_LWA_CLIENT_SECRET') || trimEnv('AMAZON_LWA_CLIENT_SECRET')
    refreshToken = trimEnv(isKsa ? 'AMAZON_KSA_ADS_REFRESH_TOKEN' : 'AMAZON_UAE_ADS_REFRESH_TOKEN')
    if (!refreshToken) refreshToken = trimEnv('AMAZON_ADS_SANDBOX_REFRESH_TOKEN')
    if (!refreshToken && spRefreshFallbackEnabled()) {
      refreshToken = trimEnv('AMAZON_REFRESH_TOKEN')
    }
    profileId = trimEnv(`AMAZON_${U}_ADS_PROFILE_ID`)
  }

  if (!clientId) missing.push(`LWA client id (e.g. AMAZON_${U}_ADS_LWA_CLIENT_ID or AMAZON_${U}_LWA_CLIENT_ID)`)
  if (!clientSecret) missing.push(`LWA client secret (Ads-specific or SP-API regional fallback)`)
  if (!refreshToken) {
    missing.push(
      `Ads refresh token (AMAZON_${U}_ADS_REFRESH_TOKEN). SP-API refresh is not used unless AMAZON_ADS_ALLOW_SP_API_REFRESH_TOKEN_FALLBACK=1.`,
    )
  }
  if (requireProfile && !profileId) {
    missing.push(`AMAZON_${U}_ADS_PROFILE_ID (from GET .../v2/profiles after Ads-scoped LWA works)`)
  }

  if (missing.length) {
    const err = new Error(
      `Amazon Ads configuration incomplete for ${mk} (${mode}): ${missing.join('; ')}`,
    )
    err.code = 'AMAZON_ADS_CONFIG_INCOMPLETE'
    err.missing = missing
    err.marketplaceKey = mk
    throw err
  }

  return {
    endpoint,
    clientId,
    clientSecret,
    refreshToken,
    adsScope,
    profileId: profileId || '',
    marketplaceKey: mk,
    mode,
  }
}

module.exports = {
  getAmazonAdsApiEndpoint,
  getAmazonAdsLwaScope,
  getAmazonAdsConfig,
  DEFAULT_ADS_ENDPOINT,
  DEFAULT_ADS_SCOPE,
}
