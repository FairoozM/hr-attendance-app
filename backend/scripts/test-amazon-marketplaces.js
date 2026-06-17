#!/usr/bin/env node
/**
 * Calls amazonSpApiService.getMarketplaceParticipations(). Safe console output only.
 *
 * Usage: npm run test:amazon-marketplaces --prefix backend
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getMarketplaceParticipations } = require('../src/services/amazonSpApiService');

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
  console.log('FAILED: Amazon marketplaces fetch failed');
  console.log(`Status code: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

async function main() {
  let status;
  let data;
  try {
    const result = await getMarketplaceParticipations();
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

  const payload = Array.isArray(data.payload) ? data.payload : [];
  const ids = payload
    .map((p) => p && p.marketplace && p.marketplace.id)
    .filter((id) => typeof id === 'string' && id.length > 0);

  console.log('SUCCESS: Amazon marketplaces fetched');
  console.log(`Status: ${status}`);
  console.log(`Marketplace count: ${ids.length}`);
  console.log(`Marketplace IDs: ${ids.length ? ids.join(', ') : '(none parsed)'}`);
}

main().catch(() => {
  printFailure('(unexpected)', null);
  process.exit(1);
});
