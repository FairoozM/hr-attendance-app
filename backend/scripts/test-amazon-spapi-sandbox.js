#!/usr/bin/env node
/**
 * Sandbox: LWA access token + GET /sellers/v1/marketplaceParticipations (no SigV4).
 * Does not log secrets or full tokens.
 *
 * Usage: npm run test:amazon-spapi --prefix backend
 */
const path = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const USER_AGENT = 'LifeSmile-HRBI-SPAPI-Sandbox-Test/1.0';

const REQUIRED = [
  'AMAZON_LWA_CLIENT_ID',
  'AMAZON_LWA_CLIENT_SECRET',
  'AMAZON_REFRESH_TOKEN',
];

function resolveSandboxSpEndpoint() {
  return (
    String(process.env.AMAZON_SP_API_ENDPOINT || '').trim() ||
    String(process.env.AMAZON_SANDBOX_SP_API_ENDPOINT || '').trim()
  );
}

function missingKeys(keys, env) {
  return keys.filter((k) => !env[k] || String(env[k]).trim() === '');
}

/** GET ${AMAZON_SP_API_ENDPOINT}/sellers/v1/marketplaceParticipations */
function buildMarketplaceParticipationsUrl(endpointRaw) {
  const trimmed = String(endpointRaw || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!u.hostname || !u.protocol.startsWith('http')) return null;
    const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    return `${base}/sellers/v1/marketplaceParticipations`;
  } catch {
    return null;
  }
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

/** Same LWA exchange as test-amazon-lwa-token.js */
async function fetchLwaAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.AMAZON_REFRESH_TOKEN,
    client_id: process.env.AMAZON_LWA_CLIENT_ID,
    client_secret: process.env.AMAZON_LWA_CLIENT_SECRET,
  });

  const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  });

  if (status !== 200 || !data || typeof data.access_token !== 'string') {
    const err = new Error('LWA_TOKEN_FAILED');
    err.lwaStatus = status;
    err.lwaBody = data;
    throw err;
  }

  return data.access_token;
}

function printFailure(statusLine, dataForAmazonError) {
  console.log('FAILED: Amazon SP-API sandbox request failed');
  console.log(`Status code: ${statusLine}`);
  const safe = dataForAmazonError ? safeAmazonErrorPayload(dataForAmazonError) : null;
  if (safe && (safe.code || safe.message)) {
    console.log(`Amazon error: ${JSON.stringify(safe)}`);
  }
}

async function main() {
  const miss = missingKeys(REQUIRED, process.env);
  if (miss.length) {
    printFailure(`(not sent — missing env: ${miss.join(', ')})`);
    process.exit(1);
  }

  const ep = resolveSandboxSpEndpoint();
  if (!ep) {
    printFailure(
      '(not sent — missing AMAZON_SP_API_ENDPOINT or AMAZON_SANDBOX_SP_API_ENDPOINT)'
    );
    process.exit(1);
  }

  const url = buildMarketplaceParticipationsUrl(ep);
  if (!url) {
    printFailure('(not sent — invalid sandbox SP-API endpoint URL)');
    process.exit(1);
  }

  let accessToken;
  try {
    accessToken = await fetchLwaAccessToken();
  } catch (e) {
    const statusLine =
      e && e.lwaStatus != null ? String(e.lwaStatus) : '(LWA request failed)';
    printFailure(statusLine, e && e.lwaBody);
    process.exit(1);
  }

  let status;
  let data;
  try {
    const res = await axios.get(url, {
      headers: {
        'x-amz-access-token': accessToken,
        'user-agent': USER_AGENT,
        accept: 'application/json',
      },
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(body) => body],
    });
    status = res.status;
    const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
  } catch (e) {
    printFailure('(network / transport)', null);
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

  console.log('SUCCESS: Amazon SP-API sandbox request completed');
  console.log(`Status: ${status}`);
  console.log(`Marketplace count: ${ids.length}`);
  console.log(`Marketplace IDs: ${ids.length ? ids.join(', ') : '(none parsed)'}`);
}

main().catch(() => {
  printFailure('(unexpected)', null);
  process.exit(1);
});
