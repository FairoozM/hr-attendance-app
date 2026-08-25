/**
 * Tests for the hr-spa-router CloudFront Function (see spa-router.js).
 *
 * Run with:  node --test --test-reporter=spec scripts/cloudfront/spa-router.test.js
 *
 * The function file is uploaded to CloudFront verbatim, so these tests evaluate those exact
 * bytes instead of importing a re-exported copy. A passing suite is therefore a statement
 * about the code that runs at the edge, not about a lookalike.
 *
 * Why each group matters is recorded in docs/cloudfront-production-configuration.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, 'spa-router.js')
const source = readFileSync(sourcePath, 'utf8')

// The CloudFront Functions runtime has no module system: it evaluates the file and calls the
// global `handler`. Reproducing that here is what makes the suite meaningful.
const handler = vm.runInNewContext(`${source}\nhandler`)

/** A viewer-request event of the shape CloudFront actually delivers. */
function viewerRequest(uri, querystring = {}) {
  return {
    version: '1.0',
    context: { eventType: 'viewer-request' },
    viewer: { ip: '203.0.113.1' },
    request: { method: 'GET', uri, querystring, headers: {}, cookies: {} },
  }
}

const route = (uri, querystring) => handler(viewerRequest(uri, querystring))
const SHELL = '/index.html'

test('the committed file is shaped the way the runtime requires', () => {
  assert.match(source, /function handler\(event\)/, 'the runtime calls a global named handler')
  // No module system exists at the edge, so anything module-ish here would not survive upload.
  assert.doesNotMatch(source, /\bmodule\.exports\b|\bexport\s|\brequire\(/, 'must not use modules')
})

test('a client-side route is served the app shell', () => {
  for (const uri of ['/login', '/dashboard', '/employees', '/attendance']) {
    assert.equal(route(uri).uri, SHELL, uri)
  }
})

test('a trailing slash is still a client-side route', () => {
  for (const uri of ['/', '/dashboard/', '/ai/amazon-initial-draft/', '/rto-agent/']) {
    assert.equal(route(uri).uri, SHELL, uri)
  }
})

test('a nested route is served the shell however deep it goes', () => {
  for (const uri of [
    '/ai/amazon-initial-draft',
    '/management/prices/ksa',
    '/reports/weekly/sales/2026/08',
    '/a/b/c/d/e/f',
  ]) {
    assert.equal(route(uri).uri, SHELL, uri)
  }
})

test('/rto-agent keeps working, because this function replaced the one that only did that', () => {
  // hr-rto-agent-spa-rewrite rewrote exactly /rto-agent and /rto-agent/*. Losing those would
  // be a silent regression for whoever relies on that page.
  for (const uri of ['/rto-agent', '/rto-agent/', '/rto-agent/anything/deeper']) {
    assert.equal(route(uri).uri, SHELL, uri)
  }
})

test('the API is never rewritten, so its status codes survive', () => {
  // This is the whole reason for a function rather than distribution-wide 403/404 custom error
  // responses: rewriting /api would turn a 401 or a 403 from requireAdmin into a 200 HTML page.
  for (const uri of [
    '/api',
    '/api/health',
    '/api/auth/login',
    '/api/employees',
    '/api/amazon-initial-draft/preview',
    '/api/attendance/sick-leave-document/1',
    '/api/socket.io/?EIO=4',
  ]) {
    assert.equal(route(uri).uri, uri, uri)
  }
})

test('a path with a file extension is left alone', () => {
  for (const uri of [
    '/index.html',
    '/assets/index-Bh2D9JcZ.js',
    '/assets/index-a1b2c3.css',
    '/api-runtime-config.js',
    '/favicon.ico',
    '/logo.png',
    '/manifest.webmanifest',
    '/nested/path/to/image.svg',
  ]) {
    assert.equal(route(uri).uri, uri, uri)
  }
})

test('a missing asset stays missing instead of becoming the shell', () => {
  // Masking a broken bundle reference as a 200 HTML page turns a loud failure into a blank
  // screen, so a stale or mistyped asset must keep returning its error.
  assert.equal(route('/assets/does-not-exist.js').uri, '/assets/does-not-exist.js')
})

test('the query string is passed through untouched', () => {
  const querystring = { tab: { value: 'surplus' }, page: { value: '2' } }

  const rewritten = route('/ai/amazon-initial-draft', querystring)
  assert.equal(rewritten.uri, SHELL)
  assert.deepEqual(rewritten.querystring, querystring)

  const untouched = route('/api/employees', querystring)
  assert.equal(untouched.uri, '/api/employees')
  assert.deepEqual(untouched.querystring, querystring)
})

test('nothing but the uri is modified', () => {
  const event = viewerRequest('/dashboard')
  const before = { method: event.request.method, headers: event.request.headers, cookies: event.request.cookies }
  const result = handler(event)

  assert.equal(result.uri, SHELL)
  assert.equal(result.method, before.method)
  assert.deepEqual(result.headers, before.headers)
  assert.deepEqual(result.cookies, before.cookies)
})
