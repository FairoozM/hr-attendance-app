'use strict'

/**
 * Admin-only endpoints for the Amazon UAE Initial Draft Generator.
 *
 * Stateless: the uploaded workbook lives in memory for the duration of one request and
 * is never written to disk or to a database. The browser keeps the file and re-sends it
 * for preview, draft and report, and because the pipeline is a pure function of the
 * upload all three calls agree.
 */

const multer = require('multer')
const path = require('path')

const lifesmileWebsiteDb = require('../db/lifesmileWebsiteDb')
const { runInitialDraftPipeline } = require('../services/amazonInitialDraft/draftGenerator')
const { buildReportBuffer } = require('../services/amazonInitialDraft/reportWorkbook')
const { findCatalogItemsBySku } = require('../services/amazonInitialDraft/websiteCatalogRepository')
const { lookupZohoBarcodesByExactSkus } = require('../services/amazonInitialDraft/zohoBarcodeLookup')
const marketplaceImageS3 = require('../services/amazonInitialDraft/marketplaceImageS3')
const { resolveProductImages } = require('../services/amazonInitialDraft/productImageResolver')

const UPLOAD_LIMIT_BYTES = Number(process.env.AMAZON_INITIAL_DRAFT_UPLOAD_LIMIT_BYTES || 25 * 1024 * 1024)
const ALLOWED_EXTENSIONS = new Set(['.xlsm', '.xlsx'])

/** How many detail rows the JSON preview carries before it is truncated. */
const PREVIEW_DETAIL_LIMIT = 500

const CONTENT_TYPES = {
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      const error = new Error('Upload an Amazon template in .xlsm or .xlsx format.')
      error.code = 'UNSUPPORTED_FILE_TYPE'
      return cb(error)
    }
    return cb(null, true)
  },
})

function safeBaseName(originalName) {
  const base = path.basename(String(originalName || 'amazon-template'), path.extname(String(originalName || '')))
  return (
    base
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      // Leading dots would produce a hidden file; trailing punctuation just looks broken.
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 80) || 'amazon-template'
  )
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function sendWorkbook(res, { buffer, filename, contentType }) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
  res.setHeader('Content-Length', String(buffer.length))
  res.setHeader('Cache-Control', 'no-store')
  res.send(buffer)
}

function statusForError(err) {
  if (!err || !err.code) return 500
  if (err.code === 'FILE_REQUIRED' || err.code === 'INVALID_TEMPLATE' || err.code === 'UNSUPPORTED_FILE_TYPE') return 400
  if (err.code === 'CATALOG_DB_NOT_CONFIGURED') return 503
  return 500
}

function fail(res, err, context) {
  const status = statusForError(err)
  // Messages from this feature are already credential-free; the DB layer sanitises its own.
  if (status >= 500) console.error(`[amazon-initial-draft] ${context} failed:`, err && err.message)
  return res.status(status).json({
    error: (err && err.message) || 'Initial draft generation failed',
    code: (err && err.code) || 'INITIAL_DRAFT_FAILED',
  })
}

async function runPipeline(req) {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    const error = new Error('Upload an Amazon template workbook (field name: file).')
    error.code = 'FILE_REQUIRED'
    throw error
  }
  if (!lifesmileWebsiteDb.isConfigured()) {
    const error = new Error(
      'The website catalog connection is not configured on this server, so SKUs cannot be matched yet.'
    )
    error.code = 'CATALOG_DB_NOT_CONFIGURED'
    throw error
  }

  // The batch folder is the only image input the browser supplies, and it is confined to
  // the configured bucket and approved root prefixes inside the resolver.
  const imageBatch = String((req.body && req.body.imageBatch) || '').trim()

  return runInitialDraftPipeline({
    buffer: req.file.buffer,
    filename: req.file.originalname,
    resolveCatalog: (skus) => findCatalogItemsBySku(skus),
    resolveZohoBarcodes: (skus) => lookupZohoBarcodesByExactSkus(skus),
    resolveImages: imageBatch
      ? ({ workbookSkus, columns }) => resolveProductImages({ workbookSkus, columns, batchPrefix: imageBatch })
      : undefined,
  })
}

function truncate(list) {
  return {
    items: list.slice(0, PREVIEW_DETAIL_LIMIT),
    total: list.length,
    truncated: list.length > PREVIEW_DETAIL_LIMIT,
  }
}

/**
 * Turns a rejected upload into the same JSON shape as every other failure here.
 * Registered after the routes, so it only sees errors raised by the upload middleware.
 */
function uploadErrorHandler(err, _req, res, next) {
  if (!err) return next()
  if (err.code === 'LIMIT_FILE_SIZE') {
    const limitMb = Math.round(UPLOAD_LIMIT_BYTES / (1024 * 1024))
    return res.status(413).json({
      error: `That workbook is larger than the ${limitMb} MB upload limit.`,
      code: 'FILE_TOO_LARGE',
    })
  }
  if (err.code === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(400).json({ error: err.message, code: err.code })
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Send the workbook in a field named "file".', code: 'FILE_REQUIRED' })
  }
  return fail(res, err, 'upload')
}

async function getHealth(req, res) {
  try {
    const health = await lifesmileWebsiteDb.checkHealth()
    return res.json({
      success: true,
      catalog: { ...lifesmileWebsiteDb.describeConnection(), ...health },
      uploadLimitBytes: UPLOAD_LIMIT_BYTES,
      acceptedExtensions: [...ALLOWED_EXTENSIONS],
    })
  } catch (err) {
    return fail(res, err, 'health')
  }
}

/**
 * The approved image batches an operator may choose from. Only prefixes inside the
 * configured allowed roots are returned, so the browser never names a bucket or a path.
 */
async function getImageBatches(req, res) {
  try {
    const configuration = marketplaceImageS3.describeConfiguration()
    if (configuration.problem) {
      return res.json({ success: true, configuration, batches: [] })
    }
    const batches = await marketplaceImageS3.listImageBatches()
    return res.json({ success: true, configuration, batches })
  } catch (err) {
    // AWS being unavailable must not take the page down; the section reports it instead.
    return res.json({
      success: true,
      configuration: marketplaceImageS3.describeConfiguration(),
      batches: [],
      error: marketplaceImageS3.sanitizeAwsError(err),
    })
  }
}

async function postPreview(req, res) {
  try {
    const result = await runPipeline(req)
    return res.json({
      success: true,
      notice: result.notice,
      summary: result.summary,
      sheets: result.sheets,
      rows: result.rows,
      populated: truncate(result.populated),
      conflicts: truncate(result.conflicts),
      preservedIdentical: truncate(result.preservedIdentical),
      missingValues: truncate(result.missingValues),
      notApplicable: truncate(result.notApplicable),
      gtinTransformations: truncate(result.gtinTransformations || []),
      surplusListValues: truncate(result.surplusListValues),
      ignoredColumns: truncate(result.ignoredColumns),
      additionalSlotColumns: truncate(result.additionalSlotColumns),
      neverWriteColumns: truncate(result.neverWriteColumns),
      reportOnlyFields: truncate(result.reportOnlyFields),
      images: result.images,
    })
  } catch (err) {
    return fail(res, err, 'preview')
  }
}

async function postDraft(req, res) {
  try {
    const result = await runPipeline(req)
    const extension = path.extname(req.file.originalname || '').toLowerCase()
    return sendWorkbook(res, {
      buffer: result.draftBuffer,
      filename: `${safeBaseName(req.file.originalname)}-initial-draft-${today()}${extension}`,
      contentType: CONTENT_TYPES[extension] || CONTENT_TYPES['.xlsx'],
    })
  } catch (err) {
    return fail(res, err, 'draft')
  }
}

async function postReport(req, res) {
  try {
    const result = await runPipeline(req)
    const buffer = await buildReportBuffer(result, {
      filename: req.file.originalname,
      catalogConnection: lifesmileWebsiteDb.describeConnection(),
    })
    return sendWorkbook(res, {
      buffer,
      filename: `amazon-uae-initial-draft-report-${today()}.xlsx`,
      contentType: CONTENT_TYPES['.xlsx'],
    })
  } catch (err) {
    return fail(res, err, 'report')
  }
}

module.exports = {
  PREVIEW_DETAIL_LIMIT,
  UPLOAD_LIMIT_BYTES,
  getHealth,
  getImageBatches,
  postDraft,
  postPreview,
  postReport,
  safeBaseName,
  statusForError,
  uploadErrorHandler,
  uploadMiddleware: upload.single('file'),
}
