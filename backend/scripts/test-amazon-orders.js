#!/usr/bin/env node
/**
 * Calls amazonSpApiService.getAmazonOrders(). Safe console output only (no PII, tokens, or secrets).
 *
 * Region mode (production-safe window: last 24h, CreatedBefore ≥3m ago, max 10 orders):
 *   node scripts/test-amazon-orders.js uae
 *   node scripts/test-amazon-orders.js ksa
 *   npm run test:amazon-orders-uae --prefix backend
 *
 * Manual marketplace id(s) (any first arg other than uae/ksa — uses service default date window):
 *   node scripts/test-amazon-orders.js A2VIGQ35RCS4UG
 *   node scripts/test-amazon-orders.js A17E79C6D8DWNP
 *
 * Default (no args):
 *   node scripts/test-amazon-orders.js
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
  getAmazonOrders,
  getAmazonConfig,
  normalizeMarketplaceKey,
} = require('../src/services/amazonSpApiService');

function iso8601Z(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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

function printFailure(statusLine, dataForAmazonError, ctx = {}) {
  console.log('FAILED: Amazon orders fetch failed');
  if (ctx.marketplaceKey != null && String(ctx.marketplaceKey).length > 0) {
    console.log(`marketplaceKey: ${ctx.marketplaceKey}`);
  }
  if (ctx.marketplaceId != null && String(ctx.marketplaceId).length > 0) {
    console.log(`marketplaceId: ${ctx.marketplaceId}`);
  }
  console.log(`status: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

function extractOrders(data) {
  if (!data || typeof data !== 'object' || data.payload == null) return [];
  const pl = data.payload;
  if (Array.isArray(pl.Orders)) return pl.Orders;
  return [];
}

function isRegionKey(arg) {
  const a = String(arg || '').trim().toLowerCase();
  return a === 'uae' || a === 'ksa';
}

async function main() {
  const args = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);

  let orderParams = {};
  let marketplaceKeyOut = '';
  let usedMarketplaceId = '';

  if (args.length > 0 && isRegionKey(args[0])) {
    const marketplaceKey = normalizeMarketplaceKey(args[0]);
    marketplaceKeyOut = marketplaceKey;
    const cfg = getAmazonConfig(marketplaceKey);
    usedMarketplaceId = cfg.defaultMarketplaceId ? String(cfg.defaultMarketplaceId).trim() : '';

    const now = Date.now();
    const createdAfter = iso8601Z(new Date(now - 24 * 60 * 60 * 1000));
    const createdBefore = iso8601Z(new Date(now - 3 * 60 * 1000 - 10 * 1000));

    orderParams = {
      marketplaceKey,
      CreatedAfter: createdAfter,
      CreatedBefore: createdBefore,
      MaxResultsPerPage: 10,
    };
    if (usedMarketplaceId) {
      orderParams.MarketplaceIds = usedMarketplaceId;
    }
  } else if (args.length > 0) {
    marketplaceKeyOut = '(manual marketplace id)';
    const ids = args.join(',');
    usedMarketplaceId = ids;
    orderParams = { MarketplaceIds: ids };
  } else {
    marketplaceKeyOut = '(default — uae)';
  }

  let status;
  let data;
  try {
    const result = await getAmazonOrders(orderParams);
    status = result.status;
    data = result.data;
  } catch (e) {
    const ctx = {
      marketplaceKey: marketplaceKeyOut,
      marketplaceId: usedMarketplaceId || undefined,
    };
    if (e && e.code === 'AMAZON_LWA_TOKEN_FAILED') {
      const statusLine =
        e.lwaStatus != null ? String(e.lwaStatus) : '(LWA request failed)';
      printFailure(statusLine, e.lwaBody, ctx);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_LWA_CONFIG') {
      printFailure('(not sent — LWA env)', null, ctx);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_CONFIG') {
      printFailure('(not sent — SP-API endpoint not configured)', null, ctx);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_ENDPOINT') {
      printFailure('(not sent — invalid SP-API endpoint URL)', null, ctx);
      process.exit(1);
    }
    if (e && e.code === 'AMAZON_SPAPI_INVALID_PATH') {
      printFailure('(not sent — invalid path)', null, ctx);
      process.exit(1);
    }
    printFailure('(request failed)', null, ctx);
    process.exit(1);
  }

  if (status !== 200 || data === null || typeof data !== 'object' || Array.isArray(data)) {
    const ctx = {
      marketplaceKey: marketplaceKeyOut,
      marketplaceId: usedMarketplaceId || undefined,
    };
    printFailure(String(status), data, ctx);
    if (data === null && status === 200) {
      console.log('Amazon error: (empty or non-JSON body)');
    } else if (data === null) {
      console.log('Amazon error: (non-JSON response body)');
    }
    process.exit(1);
  }

  const orders = extractOrders(data);
  if (!usedMarketplaceId && orders.length > 0 && orders[0].MarketplaceId) {
    usedMarketplaceId = String(orders[0].MarketplaceId);
  }

  const orderIds = orders
    .map((o) => o && o.AmazonOrderId)
    .filter((id) => typeof id === 'string' && id.length > 0);
  const previewIds = orderIds.slice(0, 5);
  const previewOrders = orders.slice(0, 5);

  console.log('SUCCESS: Amazon orders fetched');
  console.log(`marketplaceKey: ${marketplaceKeyOut}`);
  console.log(`marketplaceId: ${usedMarketplaceId || '(unknown)'}`);
  console.log(`status: ${status}`);
  console.log(`orderCount: ${orders.length}`);
  console.log(
    `amazonOrderIds (preview, max 5): ${previewIds.length ? previewIds.join(', ') : '(none)'}`
  );
  if (previewOrders.length > 0) {
    console.log('order status / purchase date (preview, max 5, no PII):');
    for (const o of previewOrders) {
      const id = o.AmazonOrderId != null ? String(o.AmazonOrderId) : '-';
      const st = o.OrderStatus != null ? String(o.OrderStatus) : '-';
      const pd = o.PurchaseDate != null ? String(o.PurchaseDate) : '-';
      console.log(`  ${id}: OrderStatus=${st} | PurchaseDate=${pd}`);
    }
  }
}

main().catch(() => {
  printFailure('(unexpected)', null, {});
  process.exit(1);
});
