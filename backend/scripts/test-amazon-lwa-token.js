#!/usr/bin/env node
/**
 * One-off: load backend/.env, exchange Amazon LWA refresh token for an access token (sandbox-ready).
 * Does not print secrets or full tokens.
 *
 * Usage (from repo root): npm run test:amazon-token --prefix backend
 * Or from backend/: npm run test:amazon-token
 */
const path = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const REQUIRED = [
  'AMAZON_LWA_CLIENT_ID',
  'AMAZON_LWA_CLIENT_SECRET',
  'AMAZON_REFRESH_TOKEN',
];

function missingEnv() {
  return REQUIRED.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
}

function previewToken(token) {
  if (!token || typeof token !== 'string') return '(none)';
  const t = token.trim();
  if (t.length <= 12) return `${t}...`;
  return `${t.slice(0, 12)}...`;
}

async function main() {
  const missing = missingEnv();
  if (missing.length > 0) {
    console.log('FAILED: missing required environment variables');
    console.log(`Missing: ${missing.join(', ')}`);
    process.exit(1);
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.AMAZON_REFRESH_TOKEN,
    client_id: process.env.AMAZON_LWA_CLIENT_ID,
    client_secret: process.env.AMAZON_LWA_CLIENT_SECRET,
  });

  try {
    const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });

    if (status !== 200 || !data || typeof data.access_token !== 'string') {
      console.log('FAILED: LWA token response was not successful');
      if (data && typeof data === 'object') {
        const safe = { error: data.error, error_description: data.error_description };
        console.log(`Details: ${JSON.stringify(safe)}`);
      } else {
        console.log(`HTTP status: ${status}`);
      }
      process.exit(1);
    }

    const tokenType = data.token_type != null ? String(data.token_type) : '(unknown)';
    const expiresIn =
      data.expires_in != null && Number.isFinite(Number(data.expires_in))
        ? `${Number(data.expires_in)} seconds`
        : '(unknown)';

    console.log('SUCCESS: Amazon LWA access token generated');
    console.log(`Token type: ${tokenType}`);
    console.log(`Expires in: ${expiresIn}`);
    console.log(`Access token preview: ${previewToken(data.access_token)}`);
  } catch (err) {
    console.log('FAILED: request error');
    const msg = err && err.message ? String(err.message) : String(err);
    console.log(`Details: ${msg}`);
    process.exit(1);
  }
}

main();
