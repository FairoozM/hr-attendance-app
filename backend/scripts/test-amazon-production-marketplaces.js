#!/usr/bin/env node
/**
 * Production SP-API: marketplace participations (UAE or KSA LWA + EU prod endpoint).
 * Forces AMAZON_SP_API_MODE=production for this process only. Safe console output.
 *
 * Usage:
 *   npm run test:amazon-prod-uae --prefix backend
 *   npm run test:amazon-prod-ksa --prefix backend
 *   cd backend && node scripts/test-amazon-production-marketplaces.js uae
 *   cd backend && node scripts/test-amazon-production-marketplaces.js ksa
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.AMAZON_SP_API_MODE = 'production';

const {
  getMarketplaceParticipations,
  getAmazonConfig,
  normalizeMarketplaceKey,
} = require('../src/services/amazonSpApiService');

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
  console.log('FAILED: Amazon production marketplaces fetch failed');
  console.log(`Status code: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

async function main() {
  const rawArg = process.argv[2];
  const marketplaceKey = normalizeMarketplaceKey(
    rawArg != null && String(rawArg).trim() ? String(rawArg).trim() : 'uae'
  );

  const cfg = getAmazonConfig(marketplaceKey);
  console.log(`marketplaceKey: ${marketplaceKey}`);
  console.log(`endpoint: ${cfg.endpoint || '(not set)'}`);

  let status;
  let data;
  try {
    const result = await getMarketplaceParticipations({ marketplaceKey });
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
      printFailure('(not sent — missing production endpoint)', null);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_ENDPOINT') {
      printFailure('(not sent — invalid endpoint URL)', null);
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
  const names = payload
    .map((p) => {
      const m = p && p.marketplace;
      if (!m) return null;
      const name = m.name != null ? String(m.name).trim() : '';
      const cc = m.countryCode != null ? String(m.countryCode).trim() : '';
      if (name && cc) return `${name} (${cc})`;
      if (name) return name;
      if (cc) return `(${cc})`;
      return null;
    })
    .filter(Boolean);

  console.log('SUCCESS: Amazon production marketplaces fetched');
  console.log(`status: ${status}`);
  console.log(`marketplace count: ${ids.length}`);
  console.log(`marketplace IDs: ${ids.length ? ids.join(', ') : '(none parsed)'}`);
  console.log(
    `marketplace names / countries: ${names.length ? names.join(' | ') : '(none parsed)'}`
  );
}

main().catch(() => {
  printFailure('(unexpected)', null);
  process.exit(1);
});
