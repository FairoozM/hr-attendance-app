const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const clientId = process.env.ZOHO_CLIENT_ID;
const clientSecret = process.env.ZOHO_CLIENT_SECRET;
const accountsBase = (process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com').replace(/\/+$/, '');
const redirectUri = 'http://localhost:7777/callback';
const scope = 'ZohoInventory.FullAccess.all';

if (!clientId || !clientSecret) {
  console.error('Missing ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET in backend/.env');
  process.exit(1);
}

if (typeof fetch !== 'function') {
  console.error('This script requires Node 18+ because it uses global fetch.');
  process.exit(1);
}

function openBrowser(url) {
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });

  const res = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: res.status, json };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Zoho returned error: ${error}`);
    console.error('[zoho-oauth] authorization error:', error);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code in callback URL');
    console.error('[zoho-oauth] missing code in callback URL');
    server.close();
    return;
  }

  console.log('[zoho-oauth] code received, exchanging immediately...');

  try {
    const result = await exchangeCode(code);

    res.writeHead(result.json.refresh_token ? 200 : 500, { 'Content-Type': 'text/plain' });
    res.end(result.json.refresh_token
      ? 'Success. You can close this tab and copy the refresh token from Terminal.'
      : 'Token exchange failed. Check Terminal.'
    );

    console.log('\n[zoho-oauth] token response status:', result.status);
    console.log(JSON.stringify(result.json, null, 2));

    if (result.json.refresh_token) {
      console.log('\nCOPY THIS INTO backend/.env:\n');
      console.log(`ZOHO_REFRESH_TOKEN=${result.json.refresh_token}`);
      console.log('');
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange crashed. Check Terminal.');
    console.error('[zoho-oauth] exchange crashed:', err);
  } finally {
    server.close();
  }
});

server.listen(7777, () => {
  const authUrl = `${accountsBase}/oauth/v2/auth?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent'
  }).toString()}`;

  console.log('[zoho-oauth] listening on http://localhost:7777/callback');
  console.log('[zoho-oauth] opening browser...');
  console.log('\nAuth URL:\n' + authUrl + '\n');

  openBrowser(authUrl);
});
