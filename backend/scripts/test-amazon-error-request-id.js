#!/usr/bin/env node
/**
 * Controlled SP-API call that expects a non-2xx (invalid path / version),
 * to verify amazonRequestId is surfaced when Amazon returns it — without printing secrets.
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const {
  callAmazonSpApi,
  throwAmazonSpApiIfFailed,
  describeAmazonSpApiFailure,
} = require('../src/services/amazonSpApiService')

async function main() {
  const marketplaceKey = process.argv[2] === 'ksa' ? 'ksa' : 'uae'
  console.info('[test] Using marketplaceKey=%s (no tokens or secrets will be printed)', marketplaceKey)

  const badPath = '/catalog/2099-01-01/items'
  const res = await callAmazonSpApi(badPath, {
    marketplaceKey,
    method: 'GET',
    params: { marketplaceIds: 'ATVPDKIKX0DER', keywords: 'test' },
    paramsSerializer: { indexes: null },
    amazonOperation: 'searchCatalogItems',
  })

  console.info('[test] HTTP status:', res.status)
  console.info('[test] amazonRequestId:', res.amazonRequestId || '(none)')
  const desc = describeAmazonSpApiFailure(res, 'searchCatalogItems', marketplaceKey)
  if (desc) {
    console.info('[test] describeAmazonSpApiFailure.operation:', desc.operation)
    console.info('[test] describeAmazonSpApiFailure.statusCode:', desc.statusCode)
    console.info('[test] describeAmazonSpApiFailure.safeErrorMessage (truncated):', String(desc.safeErrorMessage).slice(0, 120))
  }

  try {
    throwAmazonSpApiIfFailed(res, 'searchCatalogItems', marketplaceKey)
    console.error('[test] Expected throwAmazonSpApiIfFailed to throw on non-2xx')
    process.exit(1)
  } catch (e) {
    if (e.code !== 'AMAZON_SP_HTTP') {
      console.error('[test] Unexpected error code:', e.code)
      process.exit(1)
    }
    console.info('[test] Thrown AMAZON_SP_HTTP amazonRequestId:', e.amazonRequestId || '(none)')
    console.info('[test] Thrown statusCode:', e.statusCode)
  }

  console.info('[test] Done (no Authorization, refresh_token, or access_token printed).')
}

main().catch((e) => {
  console.error('[test] Fatal:', e.message || e)
  process.exit(1)
})
