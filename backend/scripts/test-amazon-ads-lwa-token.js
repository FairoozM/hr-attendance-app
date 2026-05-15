#!/usr/bin/env node
/**
 * Exchange Amazon Ads LWA refresh token for an access token (Ads scope).
 * Does not print secrets, refresh token, or full access token.
 *
 * Usage (from backend/):
 *   node scripts/test-amazon-ads-lwa-token.js uae
 *   node scripts/test-amazon-ads-lwa-token.js ksa
 */
const path = require('path')
const axios = require('axios')
const { getAmazonAdsConfig } = require('../src/services/amazonAdsConfigService')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

function previewToken(token) {
  if (!token || typeof token !== 'string') return '(none)'
  const t = token.trim()
  if (t.length <= 12) return `${t}...`
  return `${t.slice(0, 12)}...`
}

function usage() {
  console.log('Usage: node scripts/test-amazon-ads-lwa-token.js <uae|ksa>')
  process.exit(1)
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

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.adsScope,
  })

  try {
    const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    })

    if (status !== 200 || !data || typeof data.access_token !== 'string') {
      console.log('FAILED')
      console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
      console.log(`code: AMAZON_ADS_LWA_TOKEN_FAILED`)
      console.log(`HTTP status: ${status}`)
      if (data && typeof data === 'object') {
        console.log(
          `message: ${JSON.stringify({
            error: data.error,
            error_description: data.error_description,
          })}`,
        )
      }
      process.exit(1)
    }

    const tokenType = data.token_type != null ? String(data.token_type) : '(unknown)'
    const expiresIn =
      data.expires_in != null && Number.isFinite(Number(data.expires_in))
        ? String(Number(data.expires_in))
        : '(unknown)'

    console.log('SUCCESS')
    console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
    console.log(`token_type: ${tokenType}`)
    console.log(`expires_in: ${expiresIn}`)
    console.log(`access_token_preview: ${previewToken(data.access_token)}`)
  } catch (err) {
    console.log('FAILED')
    console.log(`marketplaceKey: ${cfg.marketplaceKey}`)
    console.log('code: REQUEST_ERROR')
    console.log(`message: ${err && err.message ? String(err.message) : String(err)}`)
    process.exit(1)
  }
}

main()
