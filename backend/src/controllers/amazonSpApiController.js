const axios = require('axios')
const {
  getMarketplaceParticipations,
  searchAmazonCatalogItems: fetchSpApiCatalogItems,
  normalizeMarketplaceKey,
  throwAmazonSpApiIfFailed,
  suggestedClientHttpStatusForAmazonUpstream,
} = require('../services/amazonSpApiService')

function safeAmazonErrorFromBody(data) {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const e = data.errors[0]
    const code = e && e.code != null ? String(e.code) : ''
    const message = e && e.message != null ? String(e.message) : ''
    if (code && message) return `${code}: ${message}`
    if (message) return message
    if (code) return code
    return null
  }
  if (data.error || data.error_description) {
    const code = data.error != null ? String(data.error) : ''
    const message = data.error_description != null ? String(data.error_description) : ''
    if (code && message) return `${code}: ${message}`
    if (message) return message
    if (code) return code
  }
  return null
}

function safeErrorFromLwaBody(body) {
  if (!body || typeof body !== 'object') return 'Login with Amazon failed'
  const fromOauth = safeAmazonErrorFromBody(body)
  if (fromOauth) return fromOauth
  return 'Login with Amazon failed'
}

function withAmazonSupportRef(payload, amazonRequestId) {
  if (amazonRequestId == null || typeof amazonRequestId !== 'string') return payload
  const id = amazonRequestId.trim().slice(0, 128)
  if (!id) return payload
  return { ...payload, amazonRequestId: id }
}

function jsonFromAmazonSpHttp(err, message) {
  const id = err.amazonRequestId ? String(err.amazonRequestId).slice(0, 128) : null
  const statusCode = Number.isFinite(Number(err.statusCode)) ? Number(err.statusCode) : 502
  const error =
    err.safeErrorMessage != null ? String(err.safeErrorMessage).slice(0, 500) : String(err.message || '').slice(0, 500)
  return {
    success: false,
    message,
    error,
    statusCode,
    ...(id ? { amazonRequestId: id } : {}),
  }
}

/**
 * GET /api/amazon/marketplaces
 */
async function getAmazonMarketplaces(req, res) {
  try {
    const mk = normalizeMarketplaceKey(req.query.marketplaceKey ?? req.query.marketplace)
    const spRes = await getMarketplaceParticipations({ marketplaceKey: mk })
    throwAmazonSpApiIfFailed(spRes, 'getMarketplaceParticipations', mk)
    const { data, amazonRequestId } = spRes

    if (
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data)
    ) {
      const payload = Array.isArray(data.payload) ? data.payload : []
      const marketplaceIds = payload
        .map((p) => p && p.marketplace && p.marketplace.id)
        .filter((id) => typeof id === 'string' && id.length > 0)

      return res.json({
        success: true,
        data: {
          marketplaceCount: marketplaceIds.length,
          marketplaceIds,
          raw: data,
        },
      })
    }

    const upstream = safeAmazonErrorFromBody(data)
    const error =
      upstream || (data === null ? 'Invalid or empty response from Amazon' : 'Unexpected Amazon response shape')

    return res.status(502).json(
      withAmazonSupportRef(
        {
          success: false,
          message: 'Failed to fetch Amazon marketplaces',
          error,
          statusCode: 502,
        },
        amazonRequestId
      )
    )
  } catch (err) {
    if (err?.code === 'AMAZON_SP_HTTP') {
      const sc = suggestedClientHttpStatusForAmazonUpstream(err.statusCode)
      return res.status(sc).json(jsonFromAmazonSpHttp(err, 'Failed to fetch Amazon marketplaces'))
    }
    if (
      err?.code === 'AMAZON_LWA_CONFIG' ||
      err?.code === 'AMAZON_SPAPI_CONFIG' ||
      err?.code === 'AMAZON_SPAPI_INVALID_ENDPOINT' ||
      err?.code === 'AMAZON_SPAPI_INVALID_PATH'
    ) {
      return res.status(503).json({
        success: false,
        message: 'Failed to fetch Amazon marketplaces',
        error: 'Amazon API is not configured on the server',
      })
    }

    if (err?.code === 'AMAZON_LWA_TOKEN_FAILED') {
      const error = safeErrorFromLwaBody(err.lwaBody)
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch Amazon marketplaces',
        error,
      })
    }

    if (axios.isAxiosError(err) && !err.response) {
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch Amazon marketplaces',
        error: 'Could not reach Amazon',
      })
    }

    console.error('[amazon marketplaces]', err?.message || err)
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Amazon marketplaces',
      error: 'Unexpected server error',
    })
  }
}

function extractCatalogItems(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.items)) return data.items
  return []
}

function catalogQueryFromRequest(query) {
  const q = query && typeof query === 'object' ? query : {}
  const pick = (key) => {
    const v = q[key]
    if (v == null) return undefined
    if (Array.isArray(v)) {
      const s = String(v[0] ?? '').trim()
      return s || undefined
    }
    const s = String(v).trim()
    return s || undefined
  }
  const params = {}
  const mp = pick('marketplaceIds')
  const kw = pick('keywords')
  const id = pick('identifiers')
  const idType = pick('identifiersType')
  const inc = pick('includedData')
  if (mp !== undefined) params.marketplaceIds = mp
  if (kw !== undefined) params.keywords = kw
  if (id !== undefined) params.identifiers = id
  if (idType !== undefined) params.identifiersType = idType
  if (inc !== undefined) params.includedData = inc
  const mkt = pick('marketplaceKey') ?? pick('marketplace')
  if (mkt !== undefined) params.marketplaceKey = normalizeMarketplaceKey(mkt)
  return params
}

/**
 * GET /api/amazon/catalog/items
 * Query: ?marketplaceIds=ATVPDKIKX0DER&keywords=pan (optional overrides)
 */
async function searchAmazonCatalogItems(req, res) {
  try {
    const params = catalogQueryFromRequest(req.query)
    const spRes = await fetchSpApiCatalogItems(params)
    throwAmazonSpApiIfFailed(
      spRes,
      'searchCatalogItems',
      normalizeMarketplaceKey(params.marketplaceKey != null ? params.marketplaceKey : 'uae')
    )
    const { data, amazonRequestId } = spRes

    if (
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data)
    ) {
      const items = extractCatalogItems(data)
      return res.json({
        success: true,
        data: {
          itemCount: items.length,
          items,
          raw: data,
        },
      })
    }

    const upstream = safeAmazonErrorFromBody(data)
    const error =
      upstream || (data === null ? 'Invalid or empty response from Amazon' : 'Unexpected Amazon response shape')

    return res.status(502).json(
      withAmazonSupportRef(
        {
          success: false,
          message: 'Failed to fetch Amazon catalog items',
          error,
          statusCode: 502,
        },
        amazonRequestId
      )
    )
  } catch (err) {
    if (err?.code === 'AMAZON_SP_HTTP') {
      const sc = suggestedClientHttpStatusForAmazonUpstream(err.statusCode)
      return res.status(sc).json(jsonFromAmazonSpHttp(err, 'Failed to fetch Amazon catalog items'))
    }
    if (
      err?.code === 'AMAZON_LWA_CONFIG' ||
      err?.code === 'AMAZON_SPAPI_CONFIG' ||
      err?.code === 'AMAZON_SPAPI_INVALID_ENDPOINT' ||
      err?.code === 'AMAZON_SPAPI_INVALID_PATH'
    ) {
      return res.status(503).json({
        success: false,
        message: 'Failed to fetch Amazon catalog items',
        error: 'Amazon API is not configured on the server',
      })
    }

    if (err?.code === 'AMAZON_LWA_TOKEN_FAILED') {
      const error = safeErrorFromLwaBody(err.lwaBody)
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch Amazon catalog items',
        error,
      })
    }

    if (axios.isAxiosError(err) && !err.response) {
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch Amazon catalog items',
        error: 'Could not reach Amazon',
      })
    }

    console.error('[amazon catalog items]', err?.message || err)
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Amazon catalog items',
      error: 'Unexpected server error',
    })
  }
}

module.exports = {
  getAmazonMarketplaces,
  searchAmazonCatalogItems,
}
