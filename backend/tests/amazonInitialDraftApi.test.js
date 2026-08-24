'use strict'

/**
 * Exercises the real router and controller over HTTP.
 *
 * Auth and the catalog transport are stubbed; nothing else is. No database is contacted,
 * so this never touches the HR database or the website.
 */

const { after, before, describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const express = require('express')

const catalogDb = require('../src/db/lifesmileWebsiteDb')
const repository = require('../src/services/amazonInitialDraft/websiteCatalogRepository')
const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')
const { UAE_HEADERS, UAE_LABELS, buildTemplateWorkbook } = require('./helpers/amazonTemplateFixture')

const SKU = 'LS-POT-24'

const ITEM = {
  itemCode: SKU,
  productName: 'Life Smile 24cm Cooking Pot',
  longDescription: '<p>A pot.</p>',
  shortDescription: '',
  color: 'Silver',
  size: '24 cm',
  material: 'Stainless Steel',
  variantType: 'Single',
  categoryName: 'Cookware',
  subCategoryName: 'Pots',
  status: 'active',
  matchSource: 'product',
  parentItemCode: null,
  variantCount: 0,
  specs: normalizeSpecEntries('[{"title":"Guarantee","description":"1 Year"}]'),
  weightDimensions: normalizeSpecEntries('[{"title":"Weight","description":"2.5 KG"}]'),
}

let server
let baseUrl
let currentUser = { id: 1, role: 'admin' }
const originalIsConfigured = catalogDb.isConfigured
const originalFind = repository.findCatalogItemsBySku

function template() {
  return buildTemplateWorkbook({
    technicalHeaders: UAE_HEADERS,
    displayLabels: UAE_LABELS,
    dataRows: { 8: { A: SKU } },
  }).buffer
}

/** Minimal multipart body, so no HTTP client dependency is needed. */
function multipart(buffer, filename, field = 'file') {
  const boundary = `----test${Date.now()}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` }
}

function send(method, path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl)
    const request = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const raw = Buffer.concat(chunks)
          const type = response.headers['content-type'] || ''
          resolve({
            status: response.statusCode,
            headers: response.headers,
            buffer: raw,
            body: type.includes('application/json') ? JSON.parse(raw.toString('utf8') || '{}') : null,
          })
        })
      }
    )
    request.on('error', reject)
    if (payload) {
      request.setHeader('Content-Type', payload.contentType)
      request.setHeader('Content-Length', String(payload.body.length))
      request.write(payload.body)
    }
    request.end()
  })
}

before(async () => {
  // Stub the two boundaries: who is calling, and where the catalog rows come from.
  catalogDb.isConfigured = () => true
  repository.findCatalogItemsBySku = async (skus) =>
    new Map(skus.map((sku) => [sku, sku === SKU ? { status: 'matched', item: ITEM, candidates: [] } : { status: 'unmatched', item: null, candidates: [], reason: 'not-in-catalog' }]))

  const app = express()
  app.use((req, _res, next) => {
    req.user = currentUser
    next()
  })
  app.use('/api/amazon-initial-draft', require('../src/routes/amazonInitialDraft.routes'))

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  catalogDb.isConfigured = originalIsConfigured
  repository.findCatalogItemsBySku = originalFind
  if (server) await new Promise((resolve) => server.close(resolve))
})

describe('amazon initial draft API — access control', () => {
  it('refuses a non-admin on every route', async () => {
    currentUser = { id: 2, role: 'employee' }
    try {
      for (const [method, path] of [
        ['GET', '/api/amazon-initial-draft/health'],
        ['POST', '/api/amazon-initial-draft/preview'],
        ['POST', '/api/amazon-initial-draft/draft'],
        ['POST', '/api/amazon-initial-draft/report'],
      ]) {
        const response = await send(method, path, method === 'POST' ? multipart(template(), 't.xlsm') : null)
        assert.ok(response.status === 401 || response.status === 403, `${method} ${path} returned ${response.status}`)
      }
    } finally {
      currentUser = { id: 1, role: 'admin' }
    }
  })

  it('refuses an unauthenticated caller', async () => {
    currentUser = null
    try {
      const response = await send('GET', '/api/amazon-initial-draft/health')
      assert.ok(response.status === 401 || response.status === 403)
    } finally {
      currentUser = { id: 1, role: 'admin' }
    }
  })
})

describe('amazon initial draft API — preview', () => {
  it('returns the summary, rows and detail groups', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/preview', multipart(template(), 'uae.xlsm'))

    assert.equal(response.status, 200)
    assert.equal(response.body.success, true)
    assert.match(response.body.notice, /^Initial Draft —/)
    assert.equal(response.body.summary.matched, 1)
    assert.equal(response.body.summary.fileName, 'uae.xlsm')
    assert.ok(response.body.summary.populatedCells > 0)
    assert.equal(response.body.rows[0].sku, SKU)

    for (const key of [
      'populated',
      'conflicts',
      'preservedIdentical',
      'missingValues',
      'ignoredColumns',
      'additionalSlotColumns',
      'neverWriteColumns',
      'reportOnlyFields',
    ]) {
      assert.ok(Array.isArray(response.body[key].items), `${key} is not truncatable`)
      assert.equal(typeof response.body[key].total, 'number')
      assert.equal(typeof response.body[key].truncated, 'boolean')
    }
  })

  it('rejects a request with no file', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/preview')
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'FILE_REQUIRED')
  })

  it('rejects a file type that is not a workbook', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/preview', multipart(template(), 'notes.pdf'))
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'UNSUPPORTED_FILE_TYPE')
    assert.ok(response.body.error, 'a JSON error message is required')
  })

  it('rejects the wrong form field name with JSON rather than HTML', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/preview', multipart(template(), 'uae.xlsm', 'workbook'))
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'FILE_REQUIRED')
  })

  it('answers 503 when the catalog connection is not configured', async () => {
    catalogDb.isConfigured = () => false
    try {
      const response = await send('POST', '/api/amazon-initial-draft/preview', multipart(template(), 'uae.xlsm'))
      assert.equal(response.status, 503)
      assert.equal(response.body.code, 'CATALOG_DB_NOT_CONFIGURED')
    } finally {
      catalogDb.isConfigured = () => true
    }
  })

  it('reports a file that is not a workbook at all as a bad request', async () => {
    const response = await send(
      'POST',
      '/api/amazon-initial-draft/preview',
      multipart(Buffer.from('this is not a zip'), 'uae.xlsm')
    )
    assert.equal(response.status, 400)
    assert.ok(response.body.error)
  })
})

describe('amazon initial draft API — downloads', () => {
  it('returns the draft as a macro-enabled workbook named after the upload', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/draft', multipart(template(), 'My UAE Template.xlsm'))

    assert.equal(response.status, 200)
    assert.equal(response.headers['content-type'], 'application/vnd.ms-excel.sheet.macroEnabled.12')
    assert.match(response.headers['content-disposition'], /attachment; filename="My-UAE-Template-initial-draft-\d{4}-\d{2}-\d{2}\.xlsm"/)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(Number(response.headers['content-length']), response.buffer.length)
    // A real OPC package starts with the local file header signature.
    assert.equal(response.buffer.subarray(0, 2).toString('latin1'), 'PK')
  })

  it('keeps an .xlsx upload as .xlsx', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/draft', multipart(template(), 'sheet.xlsx'))
    assert.equal(response.status, 200)
    assert.equal(
      response.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    assert.match(response.headers['content-disposition'], /\.xlsx"$/)
  })

  it('returns the report as a separate xlsx workbook', async () => {
    const response = await send('POST', '/api/amazon-initial-draft/report', multipart(template(), 'uae.xlsm'))

    assert.equal(response.status, 200)
    assert.equal(
      response.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    assert.match(response.headers['content-disposition'], /amazon-uae-initial-draft-report-\d{4}-\d{2}-\d{2}\.xlsx/)
    assert.equal(response.buffer.subarray(0, 2).toString('latin1'), 'PK')
    assert.ok(response.buffer.length > 5000, 'the report should have real content')
  })

  it('strips path separators and odd characters out of the download name', () => {
    const { safeBaseName } = require('../src/controllers/amazonInitialDraftController')

    assert.equal(safeBaseName('../../etc/passwd.xlsm'), 'passwd')
    assert.equal(safeBaseName('My Template (v2).xlsm'), 'My-Template-v2')
    assert.equal(safeBaseName('KITCHEN_TOOLS_COOKWARE_SET.xlsm'), 'KITCHEN_TOOLS_COOKWARE_SET')
    assert.equal(safeBaseName(''), 'amazon-template')
    assert.equal(safeBaseName(null), 'amazon-template')

    // Whatever the input, the result must be a safe single filename segment.
    for (const input of ['////.xlsm', '../..', '..', '.', '   ', '\u0000\u0000.xlsm', 'a'.repeat(500)]) {
      const result = safeBaseName(input)
      assert.ok(result.length > 0, `${JSON.stringify(input)} produced an empty name`)
      assert.ok(result.length <= 80, `${JSON.stringify(input)} produced an over-long name`)
      assert.doesNotMatch(result, /[/\\]/, `${JSON.stringify(input)} kept a path separator`)
      assert.doesNotMatch(result, /^[.-]/, `${JSON.stringify(input)} starts with a dot or dash`)
      assert.doesNotMatch(result, /\.\./, `${JSON.stringify(input)} kept a parent-directory hop`)
    }
  })
})

describe('amazon initial draft API — health', () => {
  it('reports catalog state and the upload limits without leaking a DSN', async () => {
    const response = await send('GET', '/api/amazon-initial-draft/health')

    assert.equal(response.status, 200)
    assert.equal(response.body.success, true)
    assert.ok(Array.isArray(response.body.acceptedExtensions))
    assert.deepEqual(response.body.acceptedExtensions.sort(), ['.xlsm', '.xlsx'])
    assert.equal(typeof response.body.uploadLimitBytes, 'number')

    const serialized = JSON.stringify(response.body)
    assert.ok(!/postgres(ql)?:\/\//.test(serialized), 'no connection string may appear')
    assert.ok(!/password/i.test(serialized), 'no password field may appear')
  })
})
