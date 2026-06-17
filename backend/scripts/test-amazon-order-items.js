#!/usr/bin/env node
/**
 * Calls amazonSpApiService.getAmazonOrderItems(). Safe console output only (no PII, tokens, or secrets).
 *
 * Usage:
 *   node scripts/test-amazon-order-items.js uae AMAZON_ORDER_ID
 *   node scripts/test-amazon-order-items.js ksa AMAZON_ORDER_ID
 *   npm run test:amazon-order-items --prefix backend -- uae AMAZON_ORDER_ID
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
  getAmazonOrderItems,
  mapAmazonOrderItemSafe,
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
  console.log('FAILED: Amazon order items fetch failed');
  console.log(`status: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

function extractOrderItems(data) {
  if (!data || typeof data !== 'object' || data.payload == null) return [];
  const pl = data.payload;
  if (Array.isArray(pl.OrderItems)) return pl.OrderItems;
  return [];
}

function isRegionKey(arg) {
  const a = String(arg || '').trim().toLowerCase();
  return a === 'uae' || a === 'ksa';
}

async function main() {
  const args = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);
  if (args.length < 2 || !isRegionKey(args[0])) {
    console.log('Usage: node scripts/test-amazon-order-items.js <uae|ksa> <AMAZON_ORDER_ID>');
    process.exit(1);
  }
  const marketplaceKey = normalizeMarketplaceKey(args[0]);
  const amazonOrderId = args[1];

  let status;
  let data;
  try {
    const result = await getAmazonOrderItems(amazonOrderId, { marketplaceKey });
    status = result.status;
    data = result.data;
  } catch (e) {
    if (e && e.code === 'AMAZON_ORDER_ID_REQUIRED') {
      printFailure('(invalid order id)', null);
      process.exit(1);
    }
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
      printFailure('(not sent — SP-API endpoint not configured)', null);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_ENDPOINT') {
      printFailure('(not sent — invalid SP-API endpoint URL)', null);
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
    process.exit(1);
  }

  const rawItems = extractOrderItems(data);
  const safeItems = rawItems.map(mapAmazonOrderItemSafe).filter(Boolean);

  console.log('SUCCESS: Amazon order items fetched');
  console.log(`marketplaceKey: ${marketplaceKey}`);
  console.log(`amazonOrderId: ${amazonOrderId}`);
  console.log(`status: ${status}`);
  console.log(`itemCount: ${safeItems.length}`);
  for (let i = 0; i < Math.min(5, safeItems.length); i++) {
    const it = safeItems[i];
    const sku = it.SellerSKU != null ? String(it.SellerSKU) : '—';
    const asin = it.ASIN != null ? String(it.ASIN) : '—';
    const title = it.Title != null ? String(it.Title).slice(0, 80) : '—';
    console.log(`  [${i + 1}] ASIN=${asin} SellerSKU=${sku}`);
    console.log(`      Title (trimmed): ${title}${String(it.Title || '').length > 80 ? '…' : ''}`);
    console.log(
      `      Qty: ordered=${it.QuantityOrdered != null ? it.QuantityOrdered : '—'} shipped=${it.QuantityShipped != null ? it.QuantityShipped : '—'}`
    );
  }
  if (safeItems.length > 5) {
    console.log(`  … ${safeItems.length - 5} more item(s) not listed`);
  }
}

main().catch(() => {
  printFailure('(unexpected)', null);
  process.exit(1);
});
