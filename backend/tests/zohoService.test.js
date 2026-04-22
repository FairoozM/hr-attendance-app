/**
 * Integration-ish tests for backend/src/services/zohoService.js
 *
 * The Zoho-side webhook is replaced with a local http.Server that returns
 * canned responses. This exercises the strict validation + every error code
 * the service is documented to throw, end-to-end through the real http
 * client (no mocking inside zohoService itself).
 *
 * The DB layer is mocked so `listMembersOfGroup` returns whatever members the
 * test wants — the service then asks our local "Zoho" for items and
 * filters/validates the result.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { mockModule, freshRequire } = require('./_helpers')

let server
let serverHandler
let baseUrl

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => serverHandler(req, res))
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      baseUrl = `http://127.0.0.1:${port}/webhook`
      resolve()
    })
  })
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function configureWebhook({ timeoutMs = 1000 } = {}) {
  process.env.ZOHO_REPORT_WEBHOOK_URL         = baseUrl
  process.env.ZOHO_REPORT_WEBHOOK_AUTH_HEADER = 'Bearer test'
  process.env.ZOHO_REPORT_WEBHOOK_TIMEOUT_MS  = String(timeoutMs)
}

function clearWebhookConfig() {
  delete process.env.ZOHO_REPORT_WEBHOOK_URL
  delete process.env.ZOHO_REPORT_WEBHOOK_AUTH_HEADER
  delete process.env.ZOHO_REPORT_WEBHOOK_TIMEOUT_MS
}

/**
 * Load a fresh copy of zohoService with the DB mocked to return `members`.
 * Always done per-test so env changes are picked up.
 */
function loadZoho(members = []) {
  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => members,
    listGroupKeys:      async () => ['slow_moving', 'other_family'],
  })
  return freshRequire('../src/services/zohoService')
}

function jsonResponder(status, payload) {
  return (req, res) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  }
}

// ---------------------------------------------------------------------------
// Pure-function tests (no HTTP)
// ---------------------------------------------------------------------------

test('zohoService._internals.validateAndNormaliseItem accepts a complete row', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'FL-001', item_name: 'FL Shine', family: 'ZDS',
    opening_stock: 100, purchases: 5, returned_to_wholesale: 0,
    closing_stock: 95, sold: 10,
  }, 0)
  assert.equal(errors.length, 0)
  assert.equal(item.sku, 'FL-001')
  assert.equal(item.family, 'ZDS')
  assert.equal(item.opening_stock, 100)
  assert.equal(item.sold, 10)
})

test('zohoService._internals.validateAndNormaliseItem rejects missing family key', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0,
  }, 0)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" is required/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem accepts family as empty string', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', family: '', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0,
  }, 0)
  assert.equal(errors.length, 0)
  assert.equal(item.family, '')
})

test('zohoService._internals.validateAndNormaliseItem rejects non-string family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', family: 99,
    opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0,
  }, 0)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" must be a string/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem rejects null family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', family: null,
    opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0,
  }, 0)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" must be a JSON string, not null/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem defaults null/absent numerics to 0', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', family: '', purchases: null, // others absent
  }, 0)
  assert.equal(errors.length, 0)
  assert.equal(item.purchases, 0)
  assert.equal(item.opening_stock, 0)
})

test('zohoService._internals.validateAndNormaliseItem rejects a missing sku', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({ item_name: 'X' }, 3)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"sku" is required/.test(e)))
  assert.ok(errors[0].startsWith('items[3]'))
})

test('zohoService._internals.validateAndNormaliseItem rejects empty/whitespace skus', () => {
  const zoho = loadZoho()
  for (const sku of ['', '   ']) {
    const { item, errors } = zoho._internals.validateAndNormaliseItem({ sku, family: '' }, 0)
    assert.equal(item, null)
    assert.ok(errors.length > 0)
  }
})

test('zohoService._internals.validateAndNormaliseItem rejects non-numeric stock fields (string, bool, NaN)', () => {
  const zoho = loadZoho()
  const cases = [
    { opening_stock: '100' },
    { sold: true },
    { purchases: NaN },
    { closing_stock: Infinity },
  ]
  for (const extra of cases) {
    const { item, errors } = zoho._internals.validateAndNormaliseItem({ sku: 'X', family: 'F', ...extra }, 0)
    assert.equal(item, null, `should reject ${JSON.stringify(extra)}`)
    assert.ok(errors.some((e) => /must be a JSON number/.test(e)))
  }
})

test('zohoService._internals.buildMatcher matches by SKU first, item_name as legacy fallback', () => {
  const zoho = loadZoho()
  const match = zoho._internals.buildMatcher([
    { sku: 'FL-001', item_name: 'FL Shine' },
    { sku: null,     item_name: 'Legacy Only' },
  ])
  assert.equal(match({ sku: 'fl-001', item_name: 'whatever' }), true)
  assert.equal(match({ sku: '',       item_name: 'Legacy Only' }), true)
  assert.equal(match({ sku: 'FL-002', item_name: 'no match' }), false)
})

// ---------------------------------------------------------------------------
// HTTP integration tests
// ---------------------------------------------------------------------------

test('zohoService: ZOHO_NOT_CONFIGURED when env vars missing', async () => {
  clearWebhookConfig()
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_NOT_CONFIGURED'
  )
})

test('zohoService: HTTP 401 from webhook → ZOHO_WEBHOOK_HTTP_ERROR (auth failure)', async () => {
  configureWebhook()
  serverHandler = jsonResponder(401, { error: 'invalid token' })
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_WEBHOOK_HTTP_ERROR' && /HTTP 401/.test(e.message)
  )
})

test('zohoService: HTTP 500 from webhook → ZOHO_WEBHOOK_HTTP_ERROR', async () => {
  configureWebhook()
  serverHandler = jsonResponder(500, { error: 'oops' })
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_WEBHOOK_HTTP_ERROR'
  )
})

test('zohoService: malformed JSON → WEBHOOK_INVALID_RESPONSE', async () => {
  configureWebhook()
  serverHandler = (req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end('not json at all <html>')
  }
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'WEBHOOK_INVALID_RESPONSE' && /not valid JSON/.test(e.validation_errors[0])
  )
})

test('zohoService: missing items array → WEBHOOK_INVALID_RESPONSE', async () => {
  configureWebhook()
  serverHandler = jsonResponder(200, { totally: 'wrong shape' })
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'WEBHOOK_INVALID_RESPONSE' && /missing an "items" array/.test(e.validation_errors[0])
  )
})

test('zohoService: row missing sku → WEBHOOK_INVALID_RESPONSE with row-level errors', async () => {
  configureWebhook()
  serverHandler = jsonResponder(200, {
    items: [
      { sku: 'OK-1', family: '', opening_stock: 1, purchases: 0, returned_to_wholesale: 0, closing_stock: 1, sold: 0 },
      { item_name: 'No SKU here', family: '', opening_stock: 1, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    ],
  })
  const zoho = loadZoho([{ sku: 'OK-1' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) =>
      e.code === 'WEBHOOK_INVALID_RESPONSE' &&
      e.validation_errors.some((m) => /items\[1\]: "sku" is required/.test(m))
  )
})

test('zohoService: row with non-numeric stock → WEBHOOK_INVALID_RESPONSE', async () => {
  configureWebhook()
  serverHandler = jsonResponder(200, {
    items: [{ sku: 'A', family: '', opening_stock: '100', purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 }],
  })
  const zoho = loadZoho([{ sku: 'A' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) =>
      e.code === 'WEBHOOK_INVALID_RESPONSE' &&
      e.validation_errors.some((m) => /must be a JSON number/.test(m))
  )
})

test('zohoService: timeout → ZOHO_WEBHOOK_TIMEOUT', async () => {
  configureWebhook({ timeoutMs: 50 })
  // Never respond, force the client-side timeout.
  serverHandler = (req, res) => { /* intentionally hang */ void req; void res }
  const zoho = loadZoho([{ sku: 'X' }])
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_WEBHOOK_TIMEOUT'
  )
})

test('zohoService: empty members short-circuits — Zoho is never called', async () => {
  configureWebhook()
  let called = false
  serverHandler = (req, res) => {
    called = true
    res.statusCode = 200
    res.end('{"items":[]}')
  }
  const zoho = loadZoho([])
  const items = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.deepEqual(items, [])
  assert.equal(called, false, 'Zoho should not be called when group has no members')
})

test('zohoService: SKU-based filter excludes Zoho rows that are not in the group', async () => {
  configureWebhook()
  serverHandler = jsonResponder(200, {
    items: [
      { sku: 'IN-GROUP', family: 'ZDS', opening_stock: 10, purchases: 0, returned_to_wholesale: 0, closing_stock: 10, sold: 0 },
      { sku: 'NOT-IN-GROUP', family: 'OtherFam', opening_stock: 5, purchases: 0, returned_to_wholesale: 0, closing_stock: 5, sold: 0 },
    ],
  })
  const zoho = loadZoho([{ sku: 'IN-GROUP' }])
  const items = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.equal(items.length, 1)
  assert.equal(items[0].sku, 'IN-GROUP')
  assert.equal(items[0].family, 'ZDS')
})

test('zohoService: webhook query params + auth header are sent correctly', async () => {
  configureWebhook()
  let captured
  serverHandler = (req, res) => {
    captured = { url: req.url, auth: req.headers.authorization }
    res.statusCode = 200
    res.end('{"items":[]}')
  }
  const zoho = loadZoho([{ sku: 'X' }])
  await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.match(captured.url, /from_date=2026-01-01/)
  assert.match(captured.url, /to_date=2026-01-07/)
  assert.equal(captured.auth, 'Bearer test')
})
