#!/usr/bin/env node
/**
 * List Amazon Advertising profiles (GET /v2/profiles) using an Ads-scoped LWA token.
 * Does not print secrets, refresh token, or full access token.
 *
 * Usage (from backend/):
 *   node scripts/test-amazon-ads-profiles.js uae
 *   node scripts/test-amazon-ads-profiles.js ksa
 */
const path = require('path')
const axios = require('axios')
const { getAmazonAdsConfig, getAmazonAdsApiEndpoint } = require('../src/services/amazonAdsConfigService')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

function usage() {
  console.log('Usage: node scripts/test-amazon-ads-profiles.js <uae|ksa>')
  process.exit(1)
}

async function getAccessToken(cfg) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.adsScope,
  })
  const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  })
  if (status !== 200 || !data || typeof data.access_token !== 'string') {
    const err = new Error('LWA token exchange failed')
    err.lwaStatus = status
    err.lwaBody = data
    throw err
  }
  return data.access_token
}

async function main() {
  const arg = (process.argv[2] || '').trim().toLowerCase()
  if (arg !== 'uae' && arg !== 'ksa') usage()

  let cfg
  try {
    cfg = getAmazonAdsConfig(arg, { requireProfile: false })
  } catch (e) {
    console.log('FAILED')
    console.log(`marketplaceKey: ${arg}`)
    console.log(`code: ${e && e.code ? e.code : 'ERROR'}`)
    console.log(`message: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  }

  let accessToken
  try {
    accessToken = await getAccessToken(cfg)
  } catch (e) {
    console.log('FAILED')
    console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
    console.log('code: AMAZON_ADS_LWA_TOKEN_FAILED')
    const status = e && e.lwaStatus != null ? e.lwaStatus : ''
    const body = e && e.lwaBody
    console.log(`HTTP status: ${status}`)
    if (body && typeof body === 'object') {
      console.log(
        `message: ${JSON.stringify({
          error: body.error,
          error_description: body.error_description,
        })}`,
      )
    } else {
      console.log(`message: ${e && e.message ? e.message : String(e)}`)
    }
    process.exit(1)
  }

  const base = getAmazonAdsApiEndpoint().replace(/\/+$/, '')
  const url = `${base}/v2/profiles`

  try {
    const { data, status } = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': cfg.clientId,
      },
      validateStatus: () => true,
      timeout: 60000,
    })

    if (status !== 200) {
      console.log('FAILED')
      console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
      console.log(`code: AMAZON_ADS_PROFILES_HTTP`)
      console.log(`HTTP status: ${status}`)
      const snippet =
        data && typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : String(data || '').slice(0, 200)
      console.log(`message: ${snippet}`)
      process.exit(1)
    }

    const list = Array.isArray(data) ? data : []
    console.log('SUCCESS')
    console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
    console.log(`HTTP status: ${status}`)
    console.log(`profile_count: ${list.length}`)
    console.log('profiles:')
    for (const p of list) {
      const id = p.profileId != null ? String(p.profileId) : ''
      const cc = p.countryCode != null ? String(p.countryCode) : ''
      const cur = p.currencyCode != null ? String(p.currencyCode) : ''
      const name =
        p.accountInfo && p.accountInfo.name != null ? String(p.accountInfo.name) : ''
      const mp =
        p.accountInfo && p.accountInfo.marketplaceStringId != null
          ? String(p.accountInfo.marketplaceStringId)
          : ''
      console.log(
        JSON.stringify({
          profileId: id,
          countryCode: cc,
          currencyCode: cur,
          accountName: name,
          marketplaceStringId: mp,
        }),
      )
    }
  } catch (err) {
    console.log('FAILED')
    console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
    console.log('code: REQUEST_ERROR')
    console.log(`message: ${err && err.message ? String(err.message) : String(err)}`)
    process.exit(1)
  }
}

main()
