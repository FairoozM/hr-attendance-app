'use strict'

/**
 * Exercises the image endpoints over HTTP through the real router and controller.
 *
 * Auth, the catalog transport and the S3 client are stubbed; nothing else is. No AWS call
 * and no database query leaves the process.
 */

const { after, before, beforeEach, describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const express = require('express')

const catalogDb = require('../src/db/lifesmileWebsiteDb')
const repository = require('../src/services/amazonInitialDraft/websiteCatalogRepository')
const s3 = require('../src/services/amazonInitialDraft/marketplaceImageS3')
const { UAE_HEADERS, UAE_LABELS, buildTemplateWorkbook } = require('./helpers/amazonTemplateFixture')

const SKU = 'NSEL-20'
const ROOT = 'marketplace-originals/amazon-ae/'
const BATCH = `${ROOT}batch-2026-08/`
const PUBLIC_BASE = 'https://images.lifesmile.ae'

const IMAGE_HEADERS = {
  AG: 'other_product_image_locator#1.media_location',
  AH: 'other_product_image_locator#2.media_location',
}

let server
let baseUrl
let currentUser = { id: 1, role: 'admin' }
const originalEnv = {}
const originalIsConfigured = catalogDb.isConfigured
const originalFind = repository.findCatalogItemsBySku
const originalFetch = globalThis.fetch

function template() {
  return buildTemplateWorkbook({
    technicalHeaders: { ...UAE_HEADERS, ...IMAGE_HEADERS },
    displayLabels: { ...UAE_LABELS, AG: 'Other Image URL 1', AH: 'Other Image URL 2' },
    dataRows: { 8: { A: SKU } },
  }).buffer
}

function jpegHeader() {
  const buffer = Buffer.alloc(20, 0)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  buffer[3] = 0xc0
  buffer.writeUInt16BE(17, 4)
  buffer[6] = 8
  buffer.writeUInt16BE(2000, 7)
  buffer.writeUInt16BE(2000, 9)
  return buffer
}

function stubS3({ keys = [], fail = false } = {}) {
  const delivery = new Map()
  const calls = []
  s3.setClientForTests({
    calls,
    async send(command) {
      const name = command.constructor.name
      const input = command.input
      calls.push({ name, input })
      if (fail) throw Object.assign(new Error('denied'), { name: 'AccessDenied' })

      if (name === 'ListObjectsV2Command') {
        const prefix = input.Prefix || ''
        const matching = keys.filter((key) => key.startsWith(prefix))
        const folders = new Set()
        for (const key of matching) {
          const rest = key.slice(prefix.length)
          const cut = rest.indexOf('/')
          if (cut !== -1) folders.add(`${prefix}${rest.slice(0, cut + 1)}`)
        }
        return {
          Contents: matching
            .filter((key) => !key.slice(prefix.length).includes('/'))
            .map((key) => ({ Key: key, Size: 2048, ETag: '"e"', LastModified: new Date('2026-08-01') })),
          CommonPrefixes: [...folders].map((Prefix) => ({ Prefix })),
        }
      }
      if (name === 'HeadObjectCommand') {
        const found = delivery.get(input.Key)
        if (!found) throw Object.assign(new Error('Not Found'), { name: 'NotFound' })
        return { ContentLength: 2048, ETag: '"d"', ContentType: found.contentType, Metadata: found.metadata }
      }
      if (name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => jpegHeader() } }
      if (name === 'CopyObjectCommand') {
        delivery.set(input.Key, { contentType: input.ContentType, metadata: input.Metadata })
        return {}
      }
      throw new Error(`unexpected command ${name}`)
    },
  })
  return calls
}

/** Multipart body carrying the workbook plus optional text fields. */
function multipart(buffer, filename, fields = {}) {
  const boundary = `----test${Date.now()}`
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8')
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      'utf8'
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  )
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

function send(method, path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl)
    const request = http.request(
      { method, hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}` },
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
  for (const key of [
    'AMAZON_IMAGE_SOURCE_BUCKET',
    'AMAZON_IMAGE_SOURCE_ROOTS',
    'AMAZON_IMAGE_DELIVERY_BUCKET',
    'AMAZON_IMAGE_DELIVERY_PREFIX',
    'AMAZON_IMAGE_PUBLIC_BASE_URL',
  ]) {
    originalEnv[key] = process.env[key]
  }
  process.env.AMAZON_IMAGE_SOURCE_BUCKET = 'lifesmile-amazon-images-2026'
  process.env.AMAZON_IMAGE_SOURCE_ROOTS = ROOT
  process.env.AMAZON_IMAGE_DELIVERY_BUCKET = 'lifesmile-amazon-images-2026'
  process.env.AMAZON_IMAGE_DELIVERY_PREFIX = 'amazon-public/amazon-ae/'
  process.env.AMAZON_IMAGE_PUBLIC_BASE_URL = PUBLIC_BASE

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (header) => (header.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
  })

  catalogDb.isConfigured = () => true
  repository.findCatalogItemsBySku = async (skus) =>
    new Map(skus.map((sku) => [sku, { status: 'unmatched', item: null, candidates: [], reason: 'not-in-catalog' }]))

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
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  catalogDb.isConfigured = originalIsConfigured
  repository.findCatalogItemsBySku = originalFind
  s3.setClientForTests(null)
  if (server) await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  currentUser = { id: 1, role: 'admin' }
  s3.setClientForTests(null)
})

describe('GET /api/amazon-initial-draft/image-batches', () => {
  it('requires an admin', async () => {
    currentUser = { id: 2, role: 'employee' }
    const response = await send('GET', '/api/amazon-initial-draft/image-batches')
    assert.equal(response.status, 403)
  })

  it('returns only batches inside the approved root, and never a credential', async () => {
    stubS3({ keys: [`${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`] })

    const response = await send('GET', '/api/amazon-initial-draft/image-batches')
    assert.equal(response.status, 200)
    assert.equal(response.body.configuration.problem, null)
    assert.equal(response.body.configuration.publicBaseUrl, PUBLIC_BASE)

    for (const batch of response.body.batches) assert.equal(batch.prefix.startsWith(ROOT), true)
    assert.equal(response.body.batches.some((batch) => batch.prefix === BATCH), true)

    const raw = response.buffer.toString('utf8')
    assert.equal(/aws_access_key|secretaccesskey|x-amz-signature|Signature=/i.test(raw), false)
  })

  it('reports an AWS failure as an unavailable root rather than failing the request', async () => {
    stubS3({ fail: true })
    const response = await send('GET', '/api/amazon-initial-draft/image-batches')

    assert.equal(response.status, 200)
    assert.deepEqual(response.body.batches, [
      {
        prefix: ROOT,
        label: ROOT,
        root: ROOT,
        available: false,
        reason: 'AccessDenied: denied',
      },
    ])
  })
})

describe('POST /api/amazon-initial-draft/preview — images', () => {
  it('returns a grouped image preview for the selected batch', async () => {
    stubS3({
      keys: [
        `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`,
        `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg`,
        `${BATCH}1. LIFESMILE_ZZZ_ZZZ-99_WEBSITE_Main.jpg`,
      ],
    })

    const response = await send(
      'POST',
      '/api/amazon-initial-draft/preview',
      multipart(template(), 'template.xlsm', { imageBatch: BATCH })
    )

    assert.equal(response.status, 200)
    const images = response.body.images
    assert.equal(images.enabled, true)
    assert.equal(images.configured, true)
    assert.equal(images.error, null)
    assert.equal(images.batchPrefix, BATCH)
    assert.equal(images.summary.sourceFiles, 3)
    assert.equal(images.summary.matchedFiles, 2)
    assert.equal(images.summary.unmatchedFiles, 1)
    assert.equal(images.summary.skusWithMainImage, 1)

    assert.equal(images.skus.length, 1)
    assert.equal(images.skus[0].sku, SKU)
    assert.equal(images.skus[0].main.publicUrl, `${PUBLIC_BASE}/amazon-public/amazon-ae/${SKU}/MAIN.jpg`)
    assert.deepEqual(images.skus[0].secondary.map((image) => image.detectedPosition), ['1'])
    assert.match(images.retentionNote, /^Amazon normally stores its own copy/)

    // Statuses the UI filters on are present on every record.
    for (const image of [images.skus[0].main, ...images.skus[0].secondary]) {
      assert.equal(image.status, 'ready')
      assert.equal(image.populationStatus, 'populated')
      assert.equal(image.contentType, 'image/jpeg')
    }
    assert.equal(images.unassigned[0].status, 'unmatched-filename')
  })

  it('rejects a batch outside the approved root instead of reading it', async () => {
    const calls = stubS3({ keys: [] })

    const response = await send(
      'POST',
      '/api/amazon-initial-draft/preview',
      multipart(template(), 'template.xlsm', { imageBatch: '../../etc/' })
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.images.error, 'batch-prefix-traversal')
    assert.equal(calls.length, 0, 'no S3 request may be issued for a rejected prefix')
  })

  it('still previews the draft when no batch is selected', async () => {
    stubS3({ keys: [] })
    const response = await send('POST', '/api/amazon-initial-draft/preview', multipart(template(), 'template.xlsm'))

    assert.equal(response.status, 200)
    assert.equal(response.body.images.enabled, false)
    assert.equal(response.body.summary.imageCellsPopulated, 0)
    assert.match(response.body.notice, /^Initial Draft —/)
  })

  it('reports a partial AWS failure and still returns the rest of the preview', async () => {
    stubS3({ fail: true })

    const response = await send(
      'POST',
      '/api/amazon-initial-draft/preview',
      multipart(template(), 'template.xlsm', { imageBatch: BATCH })
    )

    assert.equal(response.status, 200)
    assert.match(response.body.images.error, /source-listing-failed/)
    assert.ok(response.body.summary.templateColumns > 0, 'the rest of the analysis is unaffected')
  })
})

describe('POST /api/amazon-initial-draft/draft — images', () => {
  it('returns a workbook with the image URLs written in', async () => {
    stubS3({ keys: [`${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`] })

    const response = await send(
      'POST',
      '/api/amazon-initial-draft/draft',
      multipart(template(), 'template.xlsm', { imageBatch: BATCH })
    )

    assert.equal(response.status, 200)
    assert.match(response.headers['content-type'], /macroEnabled/)
    assert.ok(response.buffer.length > 0)
  })

  it('includes the image mapping sheet in the report workbook', async () => {
    stubS3({ keys: [`${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`] })

    const response = await send(
      'POST',
      '/api/amazon-initial-draft/report',
      multipart(template(), 'template.xlsm', { imageBatch: BATCH })
    )

    assert.equal(response.status, 200)
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(response.buffer)

    const sheet = workbook.getWorksheet('Amazon Image Mapping')
    assert.ok(sheet, 'the report must carry an Amazon Image Mapping sheet')

    const headers = sheet.getRow(1).values.filter(Boolean)
    for (const header of ['Seller SKU', 'Original S3 key', 'Permanent CloudFront URL', 'Population status']) {
      assert.equal(headers.includes(header), true, `missing column ${header}`)
    }

    const dataRow = sheet.getRow(2).values
    assert.equal(dataRow.includes(SKU), true)
    assert.equal(
      dataRow.some((value) => typeof value === 'string' && value.startsWith(`${PUBLIC_BASE}/`)),
      true
    )
  })
})
