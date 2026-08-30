'use strict'

/**
 * Turns an approved S3 image batch into per-SKU, per-position delivery URLs the draft
 * generator can write into the workbook.
 *
 * Everything here is advisory by design: a missing, ambiguous or unreachable image gets a
 * status and a warning, and the rest of the draft still generates. AWS being unavailable
 * degrades the image section to an error message rather than failing the request.
 *
 * Nothing is deleted, and no image is decoded, resized or re-encoded — only listed,
 * header-probed and server-side copied.
 */

const { buildImageColumnMap, columnForPosition } = require('./imageColumnMapping')
const { resolveImageKey } = require('./imageFilenameParser')
const s3 = require('./marketplaceImageS3')

const DEFAULT_CONCURRENCY = Number(process.env.AMAZON_IMAGE_CONCURRENCY || 6)
const DEFAULT_TIME_BUDGET_MS = Number(process.env.AMAZON_IMAGE_TIME_BUDGET_MS || 120000)
/** Anonymous HEAD checks are the slowest step, so they are capped per request. */
const DEFAULT_URL_CHECK_LIMIT = Number(process.env.AMAZON_IMAGE_URL_CHECK_LIMIT || 200)

const IMAGE_STATUS = {
  READY: 'ready',
  UNMATCHED: 'unmatched-filename',
  AMBIGUOUS: 'ambiguous-sku',
  DUPLICATE: 'duplicate-position',
  UNSUPPORTED_POSITION: 'unsupported-position',
  UNSUPPORTED_FILE: 'unsupported-file',
  DELIVERY_FAILED: 'delivery-copy-failed',
  URL_UNREACHABLE: 'public-url-unreachable',
}

const RETENTION_NOTE =
  'Amazon normally stores its own copy after successful processing, but retaining the approved AWS ' +
  'originals is recommended for future listing recovery, KSA listings and image replacement.'

function skuKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function runPool(items, limit, worker) {
  const size = Math.max(1, Math.min(limit, items.length || 1))
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function emptyResult(extra = {}) {
  return {
    enabled: false,
    configured: false,
    batchPrefix: '',
    error: null,
    retentionNote: RETENTION_NOTE,
    configuration: null,
    images: [],
    skus: [],
    urlChecksSkipped: 0,
    sourceTruncated: false,
    summary: emptySummary(),
    ...extra,
  }
}

function emptySummary() {
  return {
    sourceFiles: 0,
    matchedFiles: 0,
    matchedSkus: 0,
    skusWithMainImage: 0,
    skusMissingMainImage: 0,
    secondaryImages: 0,
    unmatchedFiles: 0,
    ambiguousFiles: 0,
    duplicatePositions: 0,
    unsupportedPositions: 0,
    unsupportedFiles: 0,
    deliveryFailures: 0,
    brokenUrls: 0,
    workbookSkusWithoutImages: 0,
  }
}

/**
 * @param {object} options
 * @param {string[]} options.workbookSkus seller SKUs read from the uploaded workbook
 * @param {Array<object>} options.columns workbook columns from `openTemplateWorkbook`
 * @param {string} [options.batchPrefix] approved batch folder chosen by the operator
 * @param {object} [options.env]
 */
async function resolveProductImages(options) {
  const { workbookSkus = [], columns = [], batchPrefix = '', env = process.env, fetchImpl = null } = options || {}

  const config = s3.readConfig(env)
  const configuration = s3.describeConfiguration(config)
  const problem = configuration.problem

  if (problem) {
    return emptyResult({ enabled: true, configuration, error: problem })
  }

  const batch = s3.resolveBatchPrefix(batchPrefix, config)
  if (!batch.ok) {
    return emptyResult({ enabled: true, configured: true, configuration, error: batch.reason })
  }
  if (!batch.prefix) {
    return emptyResult({ enabled: true, configured: true, configuration, error: 'batch-prefix-required' })
  }

  let listing
  try {
    listing = await s3.listBatchObjects(batch.prefix, config)
  } catch (err) {
    return emptyResult({
      enabled: true,
      configured: true,
      configuration,
      batchPrefix: batch.prefix,
      error: `source-listing-failed: ${s3.sanitizeAwsError(err)}`,
    })
  }

  const imageColumns = buildImageColumnMap(columns)
  const records = listing.objects.map((object) => buildRecord(object, workbookSkus, imageColumns, config))

  markDuplicatePositions(records)

  const deliverable = records.filter((record) => record.status === IMAGE_STATUS.READY)
  const started = Date.now()
  let urlChecks = 0
  let urlChecksSkipped = 0

  await runPool(deliverable, DEFAULT_CONCURRENCY, async (record) => {
    if (Date.now() - started > DEFAULT_TIME_BUDGET_MS) {
      record.warning = appendWarning(record.warning, 'Image processing time budget reached before this file.')
      urlChecksSkipped += 1
      return
    }

    try {
      const dimensions = await s3.readSourceDimensions(record.sourceKey, config)
      record.width = dimensions.width
      record.height = dimensions.height
      if (!dimensions.valid) {
        record.warning = appendWarning(record.warning, 'Source object does not start with a JPEG header.')
      }
    } catch (err) {
      record.warning = appendWarning(record.warning, `Could not read image header: ${s3.sanitizeAwsError(err)}`)
    }

    try {
      const copy = await s3.ensureDeliveryCopy(
        { sourceKey: record.sourceKey, sourceEtag: record.sourceEtag, deliveryKey: record.deliveryKey },
        config
      )
      record.deliveryAction = copy.action
      record.deliverySize = copy.size
      record.publicUrl = s3.publicUrlFor(record.deliveryKey, config)
    } catch (err) {
      record.status = IMAGE_STATUS.DELIVERY_FAILED
      record.publicUrl = ''
      record.warning = appendWarning(record.warning, `Delivery copy failed: ${s3.sanitizeAwsError(err)}`)
      return
    }

    if (urlChecks >= DEFAULT_URL_CHECK_LIMIT) {
      urlChecksSkipped += 1
      record.urlChecked = false
      return
    }
    urlChecks += 1
    record.urlChecked = true

    const check = await s3.checkPublicUrl(record.publicUrl, { fetchImpl })
    record.httpStatus = check.status
    record.contentType = check.contentType
    if (!check.ok) {
      record.status = IMAGE_STATUS.URL_UNREACHABLE
      record.warning = appendWarning(record.warning, `Public URL check failed (${check.reason || 'unknown'}).`)
    }
  })

  guardDuplicateUrls(records)

  const skus = groupBySku(records, workbookSkus)
  const summary = buildSummary(records, skus, workbookSkus)

  return {
    enabled: true,
    configured: true,
    batchPrefix: batch.prefix,
    error: null,
    retentionNote: RETENTION_NOTE,
    configuration,
    images: records,
    skus,
    urlChecksSkipped,
    sourceTruncated: Boolean(listing.truncated),
    summary,
    imageColumns: {
      mainColumn: imageColumns.main ? imageColumns.main.letters : null,
      secondaryPositions: imageColumns.supportedSecondaryPositions,
      outOfScope: imageColumns.outOfScope.map((entry) => ({
        column: entry.column.letters,
        technicalHeader: entry.column.technicalHeader,
        reason: entry.reason,
      })),
    },
  }
}

function appendWarning(existing, message) {
  const text = String(message || '').trim()
  if (!text) return existing || ''
  return existing ? `${existing} ${text}` : text
}

function buildRecord(object, workbookSkus, imageColumns, config) {
  const resolved = resolveImageKey(object.key, workbookSkus)

  const record = {
    sourceKey: object.key,
    filename: resolved.filename,
    sourceSize: object.size,
    sourceEtag: object.etag,
    sourceLastModified: object.lastModified,
    detectedSku: resolved.sku,
    sku: resolved.sku,
    detectedPosition: resolved.position ? resolved.position.label : '',
    positionSlot: resolved.position ? resolved.position.slot : '',
    positionNumber: resolved.position ? resolved.position.number : null,
    classification: resolved.position ? (resolved.position.kind === 'main' ? 'main' : 'secondary') : '',
    matchStatus: resolved.matchStatus,
    candidates: resolved.candidates || [],
    width: null,
    height: null,
    deliveryKey: '',
    deliverySize: 0,
    deliveryAction: '',
    publicUrl: '',
    httpStatus: null,
    contentType: '',
    urlChecked: false,
    destinationColumn: '',
    destinationHeader: '',
    status: '',
    warning: '',
  }

  if (resolved.matchStatus === 'unsupported-file') {
    record.status = IMAGE_STATUS.UNSUPPORTED_FILE
    record.warning = 'Only .jpg and .jpeg files are used.'
    return record
  }
  if (resolved.matchStatus === 'unsupported-position') {
    record.status = IMAGE_STATUS.UNSUPPORTED_POSITION
    record.warning = resolved.reason === 'position-marker-not-found'
      ? 'Filename does not end with a recognised image position.'
      : 'Image position is outside the supported Amazon positions.'
    return record
  }
  if (resolved.matchStatus === 'ambiguous-sku') {
    record.status = IMAGE_STATUS.AMBIGUOUS
    record.warning = `Filename matches more than one workbook SKU: ${record.candidates.join(', ')}.`
    return record
  }
  if (resolved.matchStatus === 'unmatched-filename') {
    record.status = IMAGE_STATUS.UNMATCHED
    record.warning = 'No exact seller SKU in the uploaded workbook matches this filename.'
    return record
  }

  const destination = columnForPosition(imageColumns, resolved.position)
  if (!destination) {
    record.status = IMAGE_STATUS.UNSUPPORTED_POSITION
    record.warning =
      resolved.position.kind === 'main'
        ? 'The uploaded template has no main image column.'
        : `The uploaded template has no column for secondary image ${resolved.position.number}.`
    return record
  }

  record.destinationColumn = destination.letters
  record.destinationHeader = destination.technicalHeader
  record.deliveryKey = s3.deliveryKeyFor(resolved.sku, resolved.position.slot, config)
  record.status = IMAGE_STATUS.READY
  return record
}

/**
 * Two approved files claiming the same SKU and position is an authoring mistake. Neither
 * is inserted, because picking one would be a guess.
 */
function markDuplicatePositions(records) {
  const groups = new Map()
  for (const record of records) {
    if (record.status !== IMAGE_STATUS.READY) continue
    const key = `${skuKey(record.sku)}::${record.positionSlot}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const names = group.map((record) => record.filename).join(', ')
    for (const record of group) {
      record.status = IMAGE_STATUS.DUPLICATE
      record.deliveryKey = ''
      record.warning = appendWarning(record.warning, `Duplicate files claim this position: ${names}.`)
    }
  }
}

/** Belt and braces: a delivery URL must never end up in two positions for one SKU. */
function guardDuplicateUrls(records) {
  const seen = new Map()
  for (const record of records) {
    if (record.status !== IMAGE_STATUS.READY || !record.publicUrl) continue
    const key = `${skuKey(record.sku)}::${record.publicUrl}`
    const previous = seen.get(key)
    if (previous && previous.positionSlot !== record.positionSlot) {
      record.status = IMAGE_STATUS.DUPLICATE
      record.warning = appendWarning(record.warning, 'Another position for this SKU already uses this URL.')
      continue
    }
    seen.set(key, record)
  }
}

function groupBySku(records, workbookSkus) {
  const groups = new Map()
  for (const sku of workbookSkus) {
    const key = skuKey(sku)
    if (!key || groups.has(key)) continue
    groups.set(key, { sku, main: null, secondary: [], problems: [], hasImages: false })
  }

  for (const record of records) {
    const key = skuKey(record.sku)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { sku: record.sku, main: null, secondary: [], problems: [], hasImages: false })
    const group = groups.get(key)
    group.hasImages = true

    if (record.status !== IMAGE_STATUS.READY) {
      group.problems.push(record)
      continue
    }
    if (record.classification === 'main') group.main = record
    else group.secondary.push(record)
  }

  for (const group of groups.values()) {
    // Numeric order, so a gap stays a gap instead of being closed by sorting on filename.
    group.secondary.sort((a, b) => a.positionNumber - b.positionNumber)
  }

  return [...groups.values()].filter((group) => group.hasImages)
}

function buildSummary(records, skus, workbookSkus) {
  const summary = emptySummary()
  summary.sourceFiles = records.length

  for (const record of records) {
    switch (record.status) {
      case IMAGE_STATUS.READY:
        summary.matchedFiles += 1
        if (record.classification === 'secondary') summary.secondaryImages += 1
        break
      case IMAGE_STATUS.UNMATCHED:
        summary.unmatchedFiles += 1
        break
      case IMAGE_STATUS.AMBIGUOUS:
        summary.ambiguousFiles += 1
        break
      case IMAGE_STATUS.DUPLICATE:
        summary.duplicatePositions += 1
        break
      case IMAGE_STATUS.UNSUPPORTED_POSITION:
        summary.unsupportedPositions += 1
        break
      case IMAGE_STATUS.UNSUPPORTED_FILE:
        summary.unsupportedFiles += 1
        break
      case IMAGE_STATUS.DELIVERY_FAILED:
        summary.deliveryFailures += 1
        break
      case IMAGE_STATUS.URL_UNREACHABLE:
        summary.brokenUrls += 1
        break
      default:
        break
    }
  }

  summary.matchedSkus = skus.length
  for (const group of skus) {
    if (group.main) summary.skusWithMainImage += 1
    else summary.skusMissingMainImage += 1
  }

  const withImages = new Set(skus.map((group) => skuKey(group.sku)))
  const distinctWorkbookSkus = new Set(workbookSkus.map((sku) => skuKey(sku)).filter(Boolean))
  for (const sku of distinctWorkbookSkus) {
    if (!withImages.has(sku)) summary.workbookSkusWithoutImages += 1
  }

  return summary
}

module.exports = {
  IMAGE_STATUS,
  RETENTION_NOTE,
  emptyResult,
  resolveProductImages,
  runPool,
}
