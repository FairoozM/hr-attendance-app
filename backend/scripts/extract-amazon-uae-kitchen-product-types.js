#!/usr/bin/env node
/**
 * One-time read-only Amazon UAE Kitchen product-type catalogue extraction.
 *
 * Reuses amazonSpApiService LWA + callAmazonSpApi. Does not write listings/orders/inventory.
 *
 * Usage:
 *   cd backend && node scripts/extract-amazon-uae-kitchen-product-types.js
 *   npm run extract:amazon-uae-kitchen --prefix backend
 */
'use strict'

const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const {
  runAmazonUaeKitchenExtraction,
} = require('../src/services/amazonProductTypeExtraction/extractionRunner')

function printSanitizedFailure(err) {
  const code = err && err.code ? String(err.code) : 'UNKNOWN'
  const message = err && err.message ? String(err.message).slice(0, 400) : 'extraction_failed'
  console.error('FAILED: Amazon UAE kitchen catalogue extraction')
  console.error(`Error code: ${code}`)
  console.error(`Message: ${message}`)
  if (err && Array.isArray(err.missingParts) && err.missingParts.length) {
    console.error(`Missing LWA config parts: ${err.missingParts.join(', ')}`)
  }
  if (err && err.httpStatus != null) {
    console.error(`HTTP status: ${err.httpStatus}`)
  }
  if (code === 'AMAZON_LWA_CONFIG') {
    console.error(
      'Check AMAZON_SP_API_MODE=production and AMAZON_UAE_LWA_CLIENT_ID / AMAZON_UAE_LWA_CLIENT_SECRET / AMAZON_UAE_REFRESH_TOKEN / AMAZON_PROD_SP_API_ENDPOINT'
    )
  }
}

async function main() {
  const summary = await runAmazonUaeKitchenExtraction()
  console.log('SUCCESS: Amazon UAE kitchen catalogue extraction complete')
  console.log(`Total UAE product types: ${summary.totalUaeProductTypes}`)
  console.log(`Kitchen-related product types: ${summary.kitchenProductTypeCount}`)
  console.log(`Exact classifications: ${summary.exactClassifications}`)
  console.log(`Inferred classifications: ${summary.inferredClassifications}`)
  console.log(`Successful definitions: ${summary.successfulDefinitions}`)
  console.log(`Failed definitions: ${summary.failedDefinitions}`)
  console.log(`Workbook: ${summary.workbookPath}`)
  console.log(`Raw JSON: ${summary.allProductTypesJsonPath}`)
  console.log(`Summary: ${summary.summaryPath}`)
}

main().catch((err) => {
  printSanitizedFailure(err)
  process.exit(1)
})
