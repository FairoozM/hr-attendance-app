'use strict'

const assert = require('node:assert/strict')
const { beforeEach, describe, it } = require('node:test')

const s3 = require('../src/services/amazonInitialDraft/marketplaceImageS3')
const { resolveProductImages } = require('../src/services/amazonInitialDraft/productImageResolver')

const ENV = {
  AMAZON_IMAGE_SOURCE_BUCKET: 'lifesmile-amazon-images-2026',
  AMAZON_IMAGE_SOURCE_ROOTS: 'marketplace-originals/amazon-ae/',
  AMAZON_IMAGE_DELIVERY_BUCKET: 'lifesmile-amazon-images-2026',
  AMAZON_IMAGE_DELIVERY_PREFIX: 'amazon-public/amazon-ae/',
  AMAZON_IMAGE_PUBLIC_BASE_URL: 'https://images.lifesmile.ae',
}

const ROOT = 'marketplace-originals/amazon-ae/'
const BATCH = `${ROOT}batch-2026-08/`

/** Minimal JPEG: SOI plus a 4000×3000 baseline start-of-frame header. */
function jpegHeader(width = 4000, height = 3000) {
  const buffer = Buffer.alloc(20, 0)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  buffer[3] = 0xc0
  buffer.writeUInt16BE(17, 4)
  buffer[6] = 8
  buffer.writeUInt16BE(height, 7)
  buffer.writeUInt16BE(width, 9)
  return buffer
}

/**
 * Stub S3 that records every command. Object bodies are never rewritten, so a test can
 * assert the delivery copy is a `CopyObject` rather than an upload of new bytes.
 */
function stubS3({ objects = [], existingDelivery = new Map(), failCopy = false } = {}) {
  const calls = []
  const delivery = new Map(existingDelivery)

  const client = {
    calls,
    delivery,
    async send(command) {
      const name = command.constructor.name
      const input = command.input
      calls.push({ name, input })

      if (name === 'ListObjectsV2Command') {
        const prefix = input.Prefix || ''
        const matching = objects.filter((object) => object.key.startsWith(prefix))
        const contents = matching.filter((object) => !object.key.slice(prefix.length).includes('/'))
        const folders = new Set()
        for (const object of matching) {
          const rest = object.key.slice(prefix.length)
          const cut = rest.indexOf('/')
          if (cut !== -1) folders.add(`${prefix}${rest.slice(0, cut + 1)}`)
        }
        return {
          Contents: contents.map((object) => ({
            Key: object.key,
            Size: object.size || 1024,
            ETag: `"${object.etag}"`,
            LastModified: new Date('2026-08-01T00:00:00Z'),
          })),
          CommonPrefixes: [...folders].map((Prefix) => ({ Prefix })),
        }
      }

      if (name === 'HeadObjectCommand') {
        const found = delivery.get(input.Key)
        if (!found) {
          const error = new Error('Not Found')
          error.name = 'NotFound'
          throw error
        }
        return {
          ContentLength: found.size,
          ETag: `"${found.etag}"`,
          ContentType: found.contentType,
          Metadata: found.metadata || {},
        }
      }

      if (name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => jpegHeader() } }
      }

      if (name === 'CopyObjectCommand') {
        if (failCopy) {
          const error = new Error('Access Denied')
          error.name = 'AccessDenied'
          throw error
        }
        delivery.set(input.Key, {
          size: 2048,
          etag: 'delivery-etag',
          contentType: input.ContentType,
          metadata: input.Metadata,
        })
        return {}
      }

      throw new Error(`unexpected command ${name}`)
    },
  }

  s3.setClientForTests(client)
  return client
}

/** Two image columns: the main locator plus secondary slots 1, 2 and 4. */
function imageColumns() {
  return [
    { column: 1, letters: 'A', technicalHeader: 'contribution_sku.value', normalizedKey: 'contribution_sku.value', displayLabel: 'Seller SKU', groupLabel: '' },
    { column: 8, letters: 'H', technicalHeader: 'main_product_image_locator#1.media_location', normalizedKey: 'main_product_image_locator.media_location', displayLabel: 'Main Image URL', groupLabel: 'Images' },
    { column: 9, letters: 'I', technicalHeader: 'other_product_image_locator#1.media_location', normalizedKey: 'other_product_image_locator.media_location', displayLabel: 'Other Image URL 1', groupLabel: 'Images' },
    { column: 10, letters: 'J', technicalHeader: 'other_product_image_locator#2.media_location', normalizedKey: 'other_product_image_locator.media_location', displayLabel: 'Other Image URL 2', groupLabel: 'Images' },
    { column: 11, letters: 'K', technicalHeader: 'other_product_image_locator#4.media_location', normalizedKey: 'other_product_image_locator.media_location', displayLabel: 'Other Image URL 4', groupLabel: 'Images' },
    { column: 12, letters: 'L', technicalHeader: 'swatch_product_image_locator#1.media_location', normalizedKey: 'swatch_product_image_locator.media_location', displayLabel: 'Swatch Image URL', groupLabel: 'Images' },
  ]
}

function okFetch() {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (header) => (header.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
  })
}

function resolve(options = {}) {
  return resolveProductImages({
    workbookSkus: ['NSEL-20'],
    columns: imageColumns(),
    batchPrefix: BATCH,
    env: ENV,
    fetchImpl: okFetch(),
    ...options,
  })
}

beforeEach(() => {
  s3.setClientForTests(null)
})

describe('marketplace image S3 — allowed prefixes', () => {
  it('accepts a batch folder inside an approved root', () => {
    const resolved = s3.resolveBatchPrefix('marketplace-originals/amazon-ae/batch-1', s3.readConfig(ENV))
    assert.equal(resolved.ok, true)
    assert.equal(resolved.prefix, 'marketplace-originals/amazon-ae/batch-1/')
    assert.equal(resolved.root, ROOT)
  })

  it('refuses a prefix outside the approved roots', () => {
    const config = s3.readConfig(ENV)
    assert.equal(s3.resolveBatchPrefix('other-bucket-folder/', config).reason, 'batch-prefix-outside-allowed-root')
    assert.equal(s3.resolveBatchPrefix('', config).prefix, '')
  })

  it('refuses traversal, absolute paths and control characters', () => {
    const config = s3.readConfig(ENV)
    assert.equal(
      s3.resolveBatchPrefix('marketplace-originals/amazon-ae/../../secrets/', config).reason,
      'batch-prefix-traversal'
    )
    assert.equal(s3.resolveBatchPrefix('/marketplace-originals/amazon-ae/', config).reason, 'batch-prefix-absolute')
    assert.equal(s3.resolveBatchPrefix('marketplace-originals\u0000/', config).reason, 'batch-prefix-invalid')
  })

  it('requires an https public base URL before any URL is produced', () => {
    assert.equal(s3.configurationProblem(s3.readConfig({ ...ENV, AMAZON_IMAGE_PUBLIC_BASE_URL: '' })), 'public-base-url-not-configured')
    assert.equal(
      s3.configurationProblem(s3.readConfig({ ...ENV, AMAZON_IMAGE_PUBLIC_BASE_URL: 'http://images.lifesmile.ae' })),
      'public-base-url-must-be-https'
    )
    assert.equal(s3.configurationProblem(s3.readConfig(ENV)), null)
  })
})

describe('marketplace image S3 — keys, URLs and metadata', () => {
  it('builds a deterministic delivery key per SKU and position', () => {
    const config = s3.readConfig(ENV)
    assert.equal(s3.deliveryKeyFor('NSEL-20', 'MAIN', config), 'amazon-public/amazon-ae/NSEL-20/MAIN.jpg')
    assert.equal(s3.deliveryKeyFor('NSEL-20', 'PT04', config), 'amazon-public/amazon-ae/NSEL-20/PT04.jpg')
    assert.equal(s3.deliveryKeyFor('ABC 20/x', 'MAIN', config), 'amazon-public/amazon-ae/ABC-20-x/MAIN.jpg')
  })

  it('encodes each URL segment without encoding the separators', () => {
    const config = s3.readConfig(ENV)
    assert.equal(
      s3.publicUrlFor('amazon-public/amazon-ae/NSEL-20/MAIN.jpg', config),
      'https://images.lifesmile.ae/amazon-public/amazon-ae/NSEL-20/MAIN.jpg'
    )
    assert.match(s3.publicUrlFor('amazon-public/amazon-ae/A B/MAIN.jpg', config), /A%20B\/MAIN\.jpg$/)
  })

  it('reads pixel dimensions from a JPEG header', () => {
    const dimensions = s3.readJpegDimensions(jpegHeader(4000, 3000))
    assert.deepEqual(dimensions, { width: 4000, height: 3000, valid: true })
    assert.equal(s3.readJpegDimensions(Buffer.from('not a jpeg')).valid, false)
  })

  it('keeps AWS errors free of anything credential-shaped', () => {
    const message = s3.sanitizeAwsError(Object.assign(new Error('boom'), { name: 'AccessDenied' }))
    assert.equal(message, 'AccessDenied: boom')
    assert.equal(message.length <= 200, true)
  })
})

describe('marketplace image delivery — server-side copy', () => {
  it('copies the approved original without uploading new bytes', async () => {
    const client = stubS3({
      objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'source-1' }],
    })

    const result = await resolve()
    const image = result.images[0]

    assert.equal(image.status, 'ready')
    assert.equal(image.deliveryAction, 'created')
    assert.equal(image.publicUrl, 'https://images.lifesmile.ae/amazon-public/amazon-ae/NSEL-20/MAIN.jpg')
    assert.equal(image.width, 4000)
    assert.equal(image.height, 3000)

    const copies = client.calls.filter((call) => call.name === 'CopyObjectCommand')
    assert.equal(copies.length, 1)
    assert.equal(copies[0].input.ContentType, 'image/jpeg')
    assert.equal(copies[0].input.Metadata['source-etag'], 'source-1')
    assert.match(copies[0].input.CopySource, /^\/lifesmile-amazon-images-2026\//)
    // Spaces in approved filenames must be encoded in the copy source path.
    assert.match(copies[0].input.CopySource, /1\.%20LIFESMILE/)
    assert.equal(
      client.calls.some((call) => call.name === 'PutObjectCommand'),
      false,
      'the JPEG bytes must never be re-uploaded, only copied server-side'
    )
  })

  it('reuses an unchanged delivery object instead of copying again', async () => {
    const client = stubS3({
      objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'source-1' }],
      existingDelivery: new Map([
        [
          'amazon-public/amazon-ae/NSEL-20/MAIN.jpg',
          { size: 2048, etag: 'delivery-etag', contentType: 'image/jpeg', metadata: { 'source-etag': 'source-1' } },
        ],
      ]),
    })

    const result = await resolve()
    assert.equal(result.images[0].deliveryAction, 'reused')
    assert.equal(client.calls.filter((call) => call.name === 'CopyObjectCommand').length, 0)
  })

  it('refreshes the delivery object when the approved original changed', async () => {
    const client = stubS3({
      objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'source-2' }],
      existingDelivery: new Map([
        [
          'amazon-public/amazon-ae/NSEL-20/MAIN.jpg',
          { size: 2048, etag: 'delivery-etag', contentType: 'image/jpeg', metadata: { 'source-etag': 'source-1' } },
        ],
      ]),
    })

    const result = await resolve()
    assert.equal(result.images[0].deliveryAction, 'refreshed')
    assert.equal(client.calls.filter((call) => call.name === 'CopyObjectCommand').length, 1)
  })

  it('reports a failed copy without producing a URL', async () => {
    stubS3({
      objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'source-1' }],
      failCopy: true,
    })

    const result = await resolve()
    assert.equal(result.images[0].status, 'delivery-copy-failed')
    assert.equal(result.images[0].publicUrl, '')
    assert.match(result.images[0].warning, /Delivery copy failed: AccessDenied/)
    assert.equal(result.summary.deliveryFailures, 1)
  })

  it('reports an unreachable or wrongly typed public URL', async () => {
    stubS3({ objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'source-1' }] })

    const result = await resolve({
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' } }),
    })

    assert.equal(result.images[0].status, 'public-url-unreachable')
    assert.equal(result.images[0].contentType, 'text/html')
    assert.equal(result.summary.brokenUrls, 1)
  })

  it('reports a listing failure without throwing', async () => {
    s3.setClientForTests({
      async send() {
        throw Object.assign(new Error('bucket missing'), { name: 'NoSuchBucket' })
      },
    })

    const result = await resolve()
    assert.match(result.error, /^source-listing-failed: NoSuchBucket/)
    assert.deepEqual(result.images, [])
  })

  it('degrades to an error when the public base URL is not configured', async () => {
    stubS3({ objects: [] })
    const result = await resolve({ env: { ...ENV, AMAZON_IMAGE_PUBLIC_BASE_URL: '' } })
    assert.equal(result.error, 'public-base-url-not-configured')
    assert.equal(result.configured, false)
  })
})

describe('marketplace image delivery — matching across a batch', () => {
  it('maps a full SKU set to positions, keeping gaps and reporting the rest', async () => {
    stubS3({
      objects: [
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'a' },
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg`, etag: 'b' },
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_2.jpg`, etag: 'c' },
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_4.jpg`, etag: 'd' },
        // Position 3 exists in S3 but not in this template, so it must be reported.
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_3.jpg`, etag: 'e' },
        { key: `${BATCH}1. LIFESMILE_ZZZ_ZZZ-99_WEBSITE_Main.jpg`, etag: 'f' },
        { key: `${BATCH}readme.txt`, etag: 'g' },
      ],
    })

    const result = await resolve()
    const byPosition = new Map(result.images.map((image) => [image.filename, image]))

    assert.equal(byPosition.get('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg').destinationColumn, 'H')
    assert.equal(byPosition.get('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg').destinationColumn, 'I')
    assert.equal(byPosition.get('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_2.jpg').destinationColumn, 'J')
    assert.equal(byPosition.get('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_4.jpg').destinationColumn, 'K')
    assert.equal(byPosition.get('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_3.jpg').status, 'unsupported-position')
    assert.equal(byPosition.get('1. LIFESMILE_ZZZ_ZZZ-99_WEBSITE_Main.jpg').status, 'unmatched-filename')
    assert.equal(byPosition.get('readme.txt').status, 'unsupported-file')

    assert.equal(result.summary.matchedFiles, 4)
    assert.equal(result.summary.secondaryImages, 3)
    assert.equal(result.summary.skusWithMainImage, 1)
    assert.equal(result.summary.unmatchedFiles, 1)
    assert.equal(result.summary.unsupportedPositions, 1)
    assert.equal(result.summary.unsupportedFiles, 1)

    // Secondary images stay in numeric order with the gap intact.
    assert.deepEqual(result.skus[0].secondary.map((image) => image.positionNumber), [1, 2, 4])
    assert.equal(result.imageColumns.outOfScope[0].technicalHeader, 'swatch_product_image_locator#1.media_location')
  })

  it('inserts neither file when two claim the same SKU and position', async () => {
    stubS3({
      objects: [
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'a' },
        { key: `${BATCH}2. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpeg`, etag: 'b' },
      ],
    })

    const result = await resolve()
    assert.equal(result.summary.duplicatePositions, 2)
    for (const image of result.images) {
      assert.equal(image.status, 'duplicate-position')
      assert.equal(image.publicUrl, '')
      assert.match(image.warning, /Duplicate files claim this position/)
    }
    assert.equal(result.summary.skusWithMainImage, 0)
  })

  it('reports a SKU whose batch has secondary images but no main image', async () => {
    stubS3({ objects: [{ key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg`, etag: 'a' }] })

    const result = await resolve()
    assert.equal(result.summary.skusMissingMainImage, 1)
    assert.equal(result.skus[0].main, null)
  })

  it('ignores a nested folder inside the chosen batch so images are not doubled', async () => {
    stubS3({
      objects: [
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'a' },
        { key: `${BATCH}nested/1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'a' },
      ],
    })

    const result = await resolve()
    assert.equal(result.images.length, 1)
    assert.equal(result.summary.duplicatePositions, 0)
  })

  it('lists only batches inside the approved roots', async () => {
    stubS3({
      objects: [
        { key: `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`, etag: 'a' },
        { key: `${ROOT}batch-2026-09/x_WEBSITE_Main.jpg`, etag: 'b' },
      ],
    })

    const batches = await s3.listImageBatches(s3.readConfig(ENV))
    assert.deepEqual(
      batches.map((batch) => batch.prefix),
      [ROOT, `${ROOT}batch-2026-08/`, `${ROOT}batch-2026-09/`]
    )
    for (const batch of batches) assert.equal(batch.prefix.startsWith(ROOT), true)
  })
})
