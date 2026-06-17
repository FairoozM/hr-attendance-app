/**
 * Amazon Advertising API v3 — async reporting for Sponsored Products campaign spend/clicks.
 * Uses the same LWA app credentials as SP-API per region (UAE / KSA) plus an Ads **profile id**.
 *
 * Env (production):
 * - AMAZON_UAE_ADS_PROFILE_ID, AMAZON_KSA_ADS_PROFILE_ID — from Amazon Ads console (profile id).
 * - AMAZON_ADS_API_HOST — default https://advertising-api-eu.amazon.com (UAE + KSA).
 * - AMAZON_ADS_LWA_SCOPE — default advertising::campaign_management (must match LWA app consent).
 *
 * Token: LWA refresh with `scope` set; Ads API is separate from SP-API host but can share the same LWA client.
 */

const axios = require('axios')
const zlib = require('zlib')
const { promisify } = require('util')
const { normalizeMarketplaceKey, getAmazonConfig } = require('./amazonSpApiService')

const gunzip = promisify(zlib.gunzip)

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const DEFAULT_ADS_HOST = 'https://advertising-api-eu.amazon.com'
const REPORTING_REPORTS_PATH = '/reporting/reports'
const DEFAULT_LWA_SCOPE = 'advertising::campaign_management'

const CREATE_CT = 'application/vnd.createasyncreportrequest.v3+json'
const STATUS_ACCEPT = 'application/vnd.asyncreportstatus.v3+json'

const POLL_MAX_ATTEMPTS = 90
const POLL_MS = 2500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getAdsApiHost() {
  const h = String(process.env.AMAZON_ADS_API_HOST || '').trim()
  return h || DEFAULT_ADS_HOST
}

function getAdsProfileId(marketplaceKey) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const isKsa = mk === 'ksa'
  const id = String(
    isKsa ? process.env.AMAZON_KSA_ADS_PROFILE_ID : process.env.AMAZON_UAE_ADS_PROFILE_ID || ''
  ).trim()
  return id
}

function getLwaScope() {
  const s = String(process.env.AMAZON_ADS_LWA_SCOPE || '').trim()
  return s || DEFAULT_LWA_SCOPE
}

async function getAmazonAdvertisingAccessToken(marketplaceKey) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const cfg = getAmazonConfig(mk)
  const miss = []
  if (!cfg.lwaClientId) miss.push('client id')
  if (!cfg.lwaClientSecret) miss.push('client secret')
  if (!cfg.refreshToken) miss.push('refresh token')
  if (miss.length) {
    const err = new Error(`Missing Amazon LWA configuration for Ads (${cfg.mode}, ${mk})`)
    err.code = 'AMAZON_ADS_LWA_CONFIG'
    err.missingParts = miss
    throw err
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id: cfg.lwaClientId,
    client_secret: cfg.lwaClientSecret,
    scope: getLwaScope(),
  })

  const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  })

  if (status !== 200 || !data || typeof data.access_token !== 'string') {
    const err = new Error('Amazon Advertising LWA token exchange failed')
    err.code = 'AMAZON_ADS_LWA_TOKEN_FAILED'
    err.lwaStatus = status
    err.lwaBody = data
    throw err
  }
  return data.access_token
}

function buildAdsHeaders(marketplaceKey, accessToken) {
  const mk = normalizeMarketplaceKey(marketplaceKey)
  const cfg = getAmazonConfig(mk)
  const profileId = getAdsProfileId(mk)
  if (!profileId) {
    const err = new Error(
      mk === 'ksa'
        ? 'Missing AMAZON_KSA_ADS_PROFILE_ID for Amazon Ads'
        : 'Missing AMAZON_UAE_ADS_PROFILE_ID for Amazon Ads'
    )
    err.code = 'AMAZON_ADS_PROFILE_NOT_CONFIGURED'
    throw err
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': cfg.lwaClientId,
    'Amazon-Advertising-API-Scope': profileId,
  }
}

function parseNum(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function parseIntSafe(v) {
  if (v == null || v === '') return 0
  const n = parseInt(String(v).replace(/,/g, '').trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {string} text - UTF-8 report body (possibly one JSON array or NDJSON)
 * @returns {{ cost: number, clicks: number }}
 */
function sumCostAndClicksFromReportBody(text) {
  const t = String(text || '').trim()
  if (!t) return { cost: 0, clicks: 0 }

  let rows = []
  try {
    if (t.startsWith('[')) {
      rows = JSON.parse(t)
    } else {
      for (const line of t.split(/\n/)) {
        const ln = line.trim()
        if (!ln) continue
        try {
          rows.push(JSON.parse(ln))
        } catch {
          // skip bad line
        }
      }
    }
  } catch {
    return { cost: 0, clicks: 0 }
  }

  if (!Array.isArray(rows)) {
    rows = rows && typeof rows === 'object' ? [rows] : []
  }

  let cost = 0
  let clicks = 0
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    cost += parseNum(r.cost != null ? r.cost : r.COST)
    clicks += parseIntSafe(r.clicks != null ? r.clicks : r.CLICKS)
  }
  return {
    cost: Math.round(cost * 100) / 100,
    clicks,
  }
}

async function downloadAndSumReport(url) {
  const { data, status } = await axios.get(url, {
    responseType: 'arraybuffer',
    validateStatus: () => true,
    timeout: 120000,
  })
  if (status !== 200 || !data) {
    const err = new Error(`Amazon Ads report download failed (HTTP ${status})`)
    err.code = 'AMAZON_ADS_REPORT_DOWNLOAD'
    throw err
  }
  const buf = Buffer.from(data)
  let text
  try {
    const raw = await gunzip(buf)
    text = raw.toString('utf8')
  } catch {
    text = buf.toString('utf8')
  }
  return sumCostAndClicksFromReportBody(text)
}

/**
 * Sponsored Products campaign-level SUMMARY for [startDate, endDate] (inclusive).
 * @param {string} marketplaceKey - 'uae' | 'ksa'
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
async function fetchSponsoredProductsSpendSummary(marketplaceKey, startDate, endDate) {
  const host = getAdsApiHost().replace(/\/+$/, '')
  const token = await getAmazonAdvertisingAccessToken(marketplaceKey)
  const headers = {
    ...buildAdsHeaders(marketplaceKey, token),
    'Content-Type': CREATE_CT,
    Accept: CREATE_CT,
  }

  const body = {
    name: `hr-weekly-ads-sp-${normalizeMarketplaceKey(marketplaceKey)}-${startDate}_${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      reportTypeId: 'spCampaigns',
      timeUnit: 'SUMMARY',
      groupBy: ['campaign'],
      columns: ['campaignId', 'campaignName', 'cost', 'clicks', 'impressions'],
      format: 'GZIP_JSON',
    },
  }

  const createUrl = `${host}${REPORTING_REPORTS_PATH}`
  const createRes = await axios.post(createUrl, body, {
    headers,
    validateStatus: () => true,
    timeout: 60000,
  })

  if (createRes.status !== 200 && createRes.status !== 201 && createRes.status !== 202) {
    const detail =
      createRes.data && typeof createRes.data === 'object'
        ? JSON.stringify(createRes.data).slice(0, 800)
        : String(createRes.data || '').slice(0, 400)
    const err = new Error(`Amazon Ads create report failed (HTTP ${createRes.status}): ${detail}`)
    err.code = 'AMAZON_ADS_CREATE_REPORT'
    err.status = createRes.status
    throw err
  }

  const reportId =
    (createRes.data && (createRes.data.reportId || createRes.data.report_id)) ||
    (createRes.data && createRes.data.id)
  const rid = reportId != null ? String(reportId).trim() : ''
  if (!rid) {
    const err = new Error('Amazon Ads create report returned no reportId')
    err.code = 'AMAZON_ADS_CREATE_REPORT'
    throw err
  }

  const statusHeaders = {
    Authorization: headers.Authorization,
    'Amazon-Advertising-API-ClientId': headers['Amazon-Advertising-API-ClientId'],
    'Amazon-Advertising-API-Scope': headers['Amazon-Advertising-API-Scope'],
    Accept: STATUS_ACCEPT,
  }

  const statusUrl = `${host}${REPORTING_REPORTS_PATH}/${encodeURIComponent(rid)}`
  let last = null
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i += 1) {
    const stRes = await axios.get(statusUrl, {
      headers: statusHeaders,
      validateStatus: () => true,
      timeout: 60000,
    })
    last = stRes.data
    const statusStr = last && (last.status || last.processingStatus)
    const s = statusStr != null ? String(statusStr).toUpperCase() : ''

    if (s === 'COMPLETED' || s === 'SUCCESS') {
      const url = last.url || last.location || last.downloadUrl
      if (!url || typeof url !== 'string') {
        const err = new Error('Amazon Ads report completed but no download URL')
        err.code = 'AMAZON_ADS_REPORT_NO_URL'
        throw err
      }
      return downloadAndSumReport(url)
    }
    if (s === 'FAILURE' || s === 'FAILED') {
      const reason = last.failureReason || last.statusDetails || JSON.stringify(last).slice(0, 500)
      const err = new Error(`Amazon Ads report failed: ${reason}`)
      err.code = 'AMAZON_ADS_REPORT_FAILED'
      throw err
    }
    if (stRes.status === 429) {
      await sleep(POLL_MS * 2)
    } else {
      await sleep(POLL_MS)
    }
  }

  const err = new Error('Amazon Ads report generation timed out; try again in a minute.')
  err.code = 'AMAZON_ADS_REPORT_TIMEOUT'
  err.lastStatus = last
  throw err
}

/**
 * Weekly Ads page: spend + clicks from Amazon Advertising for Amazon UAE / KSA rows only.
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 */
async function fetchWeeklyAdsAmazonMarketplaceTotals(fromDate, toDate) {
  const warnings = [
    'Spend and clicks are Sponsored Products (campaign summary) only; other ad types are not included.',
  ]
  const spend = { 'Amazon (UAE)': null, 'Amazon (KSA)': null }
  const clicks = { 'Amazon (UAE)': null, 'Amazon (KSA)': null }

  const regions = [
    { key: 'uae', label: 'Amazon (UAE)' },
    { key: 'ksa', label: 'Amazon (KSA)' },
  ]
  for (const { key, label } of regions) {
    if (!getAdsProfileId(key)) {
      warnings.push(`${label}: set AMAZON_${key === 'ksa' ? 'KSA' : 'UAE'}_ADS_PROFILE_ID to pull Ads from Amazon.`)
      continue
    }
    try {
      const r = await fetchSponsoredProductsSpendSummary(key, fromDate, toDate)
      spend[label] = r.cost
      clicks[label] = r.clicks
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      warnings.push(`${label}: ${msg}`)
    }
  }

  return {
    from_date: fromDate,
    to_date: toDate,
    spend,
    clicks,
    warnings,
    source: 'amazon_advertising_reporting_v3',
  }
}

module.exports = {
  getAdsApiHost,
  getAdsProfileId,
  sumCostAndClicksFromReportBody,
  fetchSponsoredProductsSpendSummary,
  fetchWeeklyAdsAmazonMarketplaceTotals,
}
