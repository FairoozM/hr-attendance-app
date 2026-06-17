#!/usr/bin/env node
/**
 * Calls amazonSpApiService.searchAmazonCatalogItems(). Safe console output only.
 *
 * Usage:
 *   npm run test:amazon-catalog --prefix backend
 *   cd backend && node scripts/test-amazon-catalog-items.js
 *   cd backend && node scripts/test-amazon-catalog-items.js A2VIGQ35RCS4UG pan
 *   cd backend && node scripts/test-amazon-catalog-items.js A17E79C6D8DWNP cookware
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { searchAmazonCatalogItems } = require('../src/services/amazonSpApiService');

function safeAmazonErrorPayload(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const e = data.errors[0];
    return {
      code: e && e.code != null ? String(e.code) : undefined,
      message: e && e.message != null ? String(e.message) : undefined,
    };
  }
  if (data.error || data.error_description) {
    return {
      code: data.error != null ? String(data.error) : undefined,
      message: data.error_description != null ? String(data.error_description) : undefined,
    };
  }
  return null;
}

function printFailure(statusLine, dataForAmazonError) {
  console.log('FAILED: Amazon catalog items fetch failed');
  console.log(`Status code: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

function extractItems(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.items)) return data.items;
  return [];
}

async function main() {
  const argv = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);

  let params = {};
  if (argv.length >= 2) {
    params = { marketplaceIds: argv[0], keywords: argv.slice(1).join(' ') };
    console.log(`Marketplace ID under test: ${argv[0]}`);
    console.log(`Keywords under test: ${argv.slice(1).join(' ')}`);
  } else if (argv.length === 1) {
    params = { marketplaceIds: argv[0] };
    console.log(`Marketplace ID under test: ${argv[0]}`);
    console.log('Keywords under test: (default — pan)');
  } else {
    console.log('Marketplace ID under test: (default — ATVPDKIKX0DER)');
    console.log('Keywords under test: (default — pan)');
  }

  let status;
  let data;
  try {
    const result = await searchAmazonCatalogItems(params);
    status = result.status;
    data = result.data;
  } catch (e) {
    if (e && e.code === 'AMAZON_LWA_TOKEN_FAILED') {
      const statusLine =
        e.lwaStatus != null ? String(e.lwaStatus) : '(LWA request failed)';
      printFailure(statusLine, e.lwaBody);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_LWA_CONFIG') {
      printFailure('(not sent — LWA env)', null);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_CONFIG') {
      printFailure('(not sent — missing AMAZON_SP_API_ENDPOINT)', null);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_ENDPOINT') {
      printFailure('(not sent — invalid AMAZON_SP_API_ENDPOINT)', null);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_PATH') {
      printFailure('(not sent — invalid path)', null);
      process.exit(1);
    }
    printFailure('(request failed)', null);
    process.exit(1);
  }

  if (status !== 200 || data === null || typeof data !== 'object' || Array.isArray(data)) {
    printFailure(String(status), data);
    if (data === null && status === 200) {
      console.log('Amazon error: (empty or non-JSON body)');
    } else if (data === null) {
      console.log('Amazon error: (non-JSON response body)');
    }
    process.exit(1);
  }

  const items = extractItems(data);
  const asins = items
    .map((it) => it && it.asin)
    .filter((a) => typeof a === 'string' && a.length > 0);

  console.log('SUCCESS: Amazon catalog items fetched');
  console.log(`Status: ${status}`);
  console.log(`Item count: ${items.length}`);
  console.log(`ASINs (preview): ${asins.length ? asins.slice(0, 10).join(', ') + (asins.length > 10 ? ', …' : '') : '(none)'}`);
}

main().catch(() => {
  printFailure('(unexpected)', null);
  process.exit(1);
});
