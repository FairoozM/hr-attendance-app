'use strict'

/**
 * S3 access for approved Amazon marketplace images.
 *
 * Two logical locations, kept separate:
 *
 *   source   — the content team's approved originals, listed and read only
 *   delivery — deterministic public copies Amazon can fetch without credentials
 *
 * The delivery copy is a server-side `CopyObject`: S3 moves the exact bytes, so the JPEG
 * is never decoded, re-encoded, resized or otherwise touched. The source object is never
 * written to or deleted, and nothing here deletes anything at all.
 *
 * A delivery object records the source ETag in its metadata, so an unchanged original
 * reuses the existing copy and a replaced original refreshes it.
 *
 * Credentials come from the ambient AWS provider chain exactly as in `s3Service.js`
 * (instance profile in production). No credential or presigned URL is ever returned.
 */

const {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = require('@aws-sdk/client-s3')

const DEFAULT_SOURCE_BUCKET = 'lifesmile-amazon-images-2026'
const DEFAULT_DELIVERY_BUCKET = 'lifesmile-amazon-images-2026'
const DEFAULT_DELIVERY_PREFIX = 'amazon-public/amazon-ae/'
/**
 * `marketplace-originals/amazon-ae/` is the approved structure. The legacy folder the
 * content team is using today is allowed too so the current batch works unchanged.
 */
const DEFAULT_SOURCE_ROOTS = 'marketplace-originals/amazon-ae/,Amazon_169_Matched_Images/'

/**
 * Probe windows for the JPEG start-of-frame header. The first covers ordinary photos; the
 * second covers approved images whose EXIF/XMP blocks push the frame header further in.
 * Both stay far below a full multi-megabyte download.
 */
const DIMENSION_PROBE_WINDOWS = [96 * 1024, 512 * 1024]
const LIST_PAGE_SIZE = 1000
const MAX_SOURCE_OBJECTS = Number(process.env.AMAZON_IMAGE_MAX_SOURCE_OBJECTS || 5000)
const URL_CHECK_TIMEOUT_MS = Number(process.env.AMAZON_IMAGE_URL_CHECK_TIMEOUT_MS || 8000)

let client = null

/** The region the approved marketplace-image bucket actually lives in. */
const DEFAULT_S3_REGION = 'eu-central-1'

/**
 * The image bucket is region-specific, so the account-wide `AWS_REGION` must not decide
 * for it: production runs with `AWS_REGION=us-east-1` for other services, and using that
 * here made every list fail with `PermanentRedirect`. Only an explicit override wins.
 */
function region() {
  return cleanText(process.env.AMAZON_IMAGE_S3_REGION) || DEFAULT_S3_REGION
}

function getClient() {
  // `followRegionRedirects` is the safety net: if the bucket is ever moved, the SDK
  // re-signs against the right region instead of failing the whole image section.
  if (!client) client = new S3Client({ region: region(), followRegionRedirects: true })
  return client
}

/** Test seam: inject a stub exposing `send(command)`. */
function setClientForTests(stub) {
  client = stub
}

function cleanText(value) {
  return String(value == null ? '' : value).trim()
}

/** Prefixes are stored with exactly one trailing slash and no leading slash. */
function normalizePrefix(value) {
  const text = cleanText(value).replace(/^\/+/, '')
  if (!text) return ''
  return text.endsWith('/') ? text : `${text}/`
}

function readConfig(env = process.env) {
  const roots = cleanText(env.AMAZON_IMAGE_SOURCE_ROOTS || DEFAULT_SOURCE_ROOTS)
    .split(',')
    .map((entry) => normalizePrefix(entry))
    .filter(Boolean)

  const publicBaseUrl = cleanText(env.AMAZON_IMAGE_PUBLIC_BASE_URL).replace(/\/+$/, '')

  return {
    sourceBucket: cleanText(env.AMAZON_IMAGE_SOURCE_BUCKET || DEFAULT_SOURCE_BUCKET),
    sourceRoots: roots,
    deliveryBucket: cleanText(env.AMAZON_IMAGE_DELIVERY_BUCKET || DEFAULT_DELIVERY_BUCKET),
    deliveryPrefix: normalizePrefix(env.AMAZON_IMAGE_DELIVERY_PREFIX || DEFAULT_DELIVERY_PREFIX),
    publicBaseUrl,
  }
}

/**
 * Why the feature cannot run, or null when it can. Only the public base URL has no safe
 * default: guessing it would produce URLs Amazon cannot fetch.
 */
function configurationProblem(config = readConfig()) {
  if (!config.sourceBucket) return 'source-bucket-not-configured'
  if (!config.sourceRoots.length) return 'source-roots-not-configured'
  if (!config.deliveryBucket) return 'delivery-bucket-not-configured'
  if (!config.deliveryPrefix) return 'delivery-prefix-not-configured'
  if (!config.publicBaseUrl) return 'public-base-url-not-configured'
  if (!/^https:\/\//i.test(config.publicBaseUrl)) return 'public-base-url-must-be-https'
  return null
}

function describeConfiguration(config = readConfig()) {
  return {
    sourceBucket: config.sourceBucket,
    sourceRoots: config.sourceRoots,
    deliveryBucket: config.deliveryBucket,
    deliveryPrefix: config.deliveryPrefix,
    publicBaseUrl: config.publicBaseUrl,
    region: region(),
    problem: configurationProblem(config),
  }
}

/**
 * Confines a caller-supplied batch prefix to the approved roots. Rejects traversal,
 * absolute paths, control characters and anything outside the allowed area.
 *
 * @returns {{ ok: true, prefix: string, root: string } | { ok: false, reason: string }}
 */
function resolveBatchPrefix(requested, config = readConfig()) {
  const text = cleanText(requested)
  if (!text) {
    // No batch chosen: the allowed roots themselves are the search area.
    return { ok: true, prefix: '', root: '' }
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, reason: 'batch-prefix-invalid' }
  if (text.startsWith('/')) return { ok: false, reason: 'batch-prefix-absolute' }

  const prefix = normalizePrefix(text)
  const segments = prefix.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { ok: false, reason: 'batch-prefix-traversal' }
  }

  const root = config.sourceRoots.find((candidate) => prefix.startsWith(candidate))
  if (!root) return { ok: false, reason: 'batch-prefix-outside-allowed-root' }

  return { ok: true, prefix, root }
}

async function listCommonPrefixes(bucket, prefix) {
  const response = await getClient().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', MaxKeys: LIST_PAGE_SIZE })
  )
  return (response.CommonPrefixes || []).map((entry) => entry.Prefix).filter(Boolean)
}

/**
 * Batch folders the operator may choose from: each approved root, plus its immediate
 * subfolders. Only prefixes inside the approved roots are ever returned, so the frontend
 * never supplies a bucket name or an arbitrary path.
 */
async function listImageBatches(config = readConfig()) {
  const batches = []
  for (const root of config.sourceRoots) {
    let children = []
    try {
      children = await listCommonPrefixes(config.sourceBucket, root)
    } catch (err) {
      batches.push({ prefix: root, label: root, root, available: false, reason: sanitizeAwsError(err) })
      continue
    }

    batches.push({ prefix: root, label: root, root, available: true, reason: null })
    for (const child of children) {
      batches.push({
        prefix: child,
        label: child.slice(root.length).replace(/\/$/, '') || child,
        root,
        available: true,
        reason: null,
      })
    }
  }
  return batches
}

/**
 * Every object directly inside `prefix`. Sub-prefixes are excluded on purpose: the
 * approved batch is one folder, and the accidental nested copy of a batch folder must not
 * double every image.
 */
async function listBatchObjects(prefix, config = readConfig()) {
  const objects = []
  let continuationToken
  let truncated = false

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: config.sourceBucket,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: LIST_PAGE_SIZE,
        ContinuationToken: continuationToken,
      })
    )

    for (const entry of response.Contents || []) {
      if (!entry.Key || entry.Key.endsWith('/')) continue
      objects.push({
        key: entry.Key,
        size: Number(entry.Size) || 0,
        etag: cleanText(entry.ETag).replace(/"/g, ''),
        lastModified: entry.LastModified ? new Date(entry.LastModified).toISOString() : null,
      })
      if (objects.length >= MAX_SOURCE_OBJECTS) {
        truncated = true
        break
      }
    }

    continuationToken = truncated ? undefined : response.NextContinuationToken
  } while (continuationToken)

  return { objects, truncated }
}

/** Deterministic, URL-safe delivery key: `{prefix}{SKU}/MAIN.jpg`. */
function deliveryKeyFor(sku, slot, config = readConfig()) {
  const safeSku = cleanText(sku).replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${config.deliveryPrefix}${safeSku}/${slot}.jpg`
}

/** Each path segment is encoded; `/` stays a separator. */
function publicUrlFor(deliveryKey, config = readConfig()) {
  const encoded = String(deliveryKey)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${config.publicBaseUrl}/${encoded}`
}

function sanitizeAwsError(err) {
  const name = err && (err.name || err.Code || err.code)
  const message = err && err.message ? String(err.message) : 'aws-request-failed'
  // Never surface anything that could carry a credential or a signed URL.
  return cleanText(`${name || 'AwsError'}: ${message}`).slice(0, 200)
}

async function headObject(bucket, key) {
  try {
    const response = await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      exists: true,
      size: Number(response.ContentLength) || 0,
      etag: cleanText(response.ETag).replace(/"/g, ''),
      contentType: cleanText(response.ContentType),
      metadata: response.Metadata || {},
    }
  } catch (err) {
    const name = err && (err.name || err.Code)
    if (name === 'NotFound' || name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return { exists: false }
    }
    throw err
  }
}

/**
 * Reads pixel dimensions from the JPEG header without altering or fully downloading the
 * object. Approved photos carry large EXIF/XMP blocks that can push the frame header past
 * the first window, so the probe widens once before giving up rather than downloading a
 * multi-megabyte body.
 */
async function readSourceDimensions(key, config = readConfig()) {
  let last = { width: null, height: null, valid: false, needsMoreBytes: true }

  for (const window of DIMENSION_PROBE_WINDOWS) {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: config.sourceBucket,
        Key: key,
        Range: `bytes=0-${window - 1}`,
      })
    )
    const bytes = Buffer.from(await response.Body.transformToByteArray())
    last = readJpegDimensions(bytes)

    if (!last.needsMoreBytes) return last
    // A short body means the whole object was already read; a wider range cannot help.
    if (bytes.length < window) return last
  }

  return last
}

/**
 * Minimal JPEG frame-header reader: walks segment markers to the start-of-frame and reads
 * the stored height and width. Purely a read; no decoding of image data.
 */
function readJpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { width: null, height: null, valid: false, needsMoreBytes: false }
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { width: null, height: null, valid: false, needsMoreBytes: false }
  }

  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]

    // Padding and standalone markers carry no length field.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }

    const length = buffer.readUInt16BE(offset + 2)
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isStartOfFrame) {
      // The frame header itself straddles the end of the window.
      if (offset + 9 > buffer.length) return { width: null, height: null, valid: true, needsMoreBytes: true }
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        valid: true,
        needsMoreBytes: false,
      }
    }

    // A declared length below the two length bytes themselves means the stream is corrupt.
    if (length < 2) return { width: null, height: null, valid: true, needsMoreBytes: false }
    offset += 2 + length
  }

  // A valid SOI was present, so this is a JPEG; the frame header is simply further in.
  return { width: null, height: null, valid: true, needsMoreBytes: true }
}

/**
 * Makes sure the delivery object is a byte-identical copy of the current source object.
 *
 * @returns {Promise<{ action: 'created'|'refreshed'|'reused', deliveryKey: string, size: number }>}
 */
async function ensureDeliveryCopy({ sourceKey, sourceEtag, deliveryKey }, config = readConfig()) {
  const existing = await headObject(config.deliveryBucket, deliveryKey)
  const recordedSource = existing.exists ? cleanText(existing.metadata?.['source-etag']) : ''

  if (existing.exists && recordedSource && sourceEtag && recordedSource === sourceEtag) {
    return { action: 'reused', deliveryKey, size: existing.size }
  }

  await getClient().send(
    new CopyObjectCommand({
      Bucket: config.deliveryBucket,
      Key: deliveryKey,
      // Encoded because a copy source is a URL path, and approved filenames contain spaces.
      CopySource: `/${config.sourceBucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
      ContentType: 'image/jpeg',
      // REPLACE applies the metadata below; the object body is still an exact copy.
      MetadataDirective: 'REPLACE',
      Metadata: {
        'source-etag': cleanText(sourceEtag),
        'source-key': cleanText(sourceKey).slice(0, 900),
      },
    })
  )

  const written = await headObject(config.deliveryBucket, deliveryKey)
  return {
    action: existing.exists ? 'refreshed' : 'created',
    deliveryKey,
    size: written.exists ? written.size : 0,
  }
}

/**
 * Confirms Amazon could fetch the URL anonymously. Advisory: a failure is reported, it
 * does not stop the draft.
 */
async function checkPublicUrl(url, { timeoutMs = URL_CHECK_TIMEOUT_MS, fetchImpl = null } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, status: 0, contentType: '', reason: 'fetch-unavailable' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
    const contentType = cleanText(response.headers?.get?.('content-type'))
    const ok = response.ok && /^image\/jpe?g/i.test(contentType)
    return {
      ok,
      status: Number(response.status) || 0,
      contentType,
      reason: ok ? null : response.ok ? 'unexpected-content-type' : 'http-error',
    }
  } catch (err) {
    return { ok: false, status: 0, contentType: '', reason: err?.name === 'AbortError' ? 'timeout' : 'request-failed' }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  DEFAULT_DELIVERY_PREFIX,
  DEFAULT_SOURCE_ROOTS,
  checkPublicUrl,
  configurationProblem,
  deliveryKeyFor,
  describeConfiguration,
  ensureDeliveryCopy,
  headObject,
  listBatchObjects,
  listImageBatches,
  normalizePrefix,
  publicUrlFor,
  readConfig,
  readJpegDimensions,
  imageS3Region: region,
  readSourceDimensions,
  resolveBatchPrefix,
  sanitizeAwsError,
  setClientForTests,
}
